import { Router } from "express";
import { createHash } from "crypto";
import { z } from "zod";
import { Prisma, PrismaClient } from "@prisma/client";
import { normalizeToTables, deleteAllDataForEmail } from "../lib/normalizeSync";

const router = Router();
const prisma = new PrismaClient();

// `data` is the client's LocalFinancials blob — its exact shape is
// intentionally NOT modeled here (that would couple this route to every
// field the client ever adds/changes, for a JSON store that's supposed to
// stay flexible). Just bound what a request handler actually needs to be
// safe from: a real email, a real token, and a payload that can't be used
// to exhaust the database with an arbitrarily large row.
const MAX_DATA_JSON_BYTES = 2_000_000; // 2MB — generous for a personal-finance data blob
const emailSchema = z.string().trim().toLowerCase().email().max(320);
const tokenSchema = z.string().min(1).max(2000);

const pushSchema = z.object({
  email: emailSchema,
  token: tokenSchema,
  // Registered passively on every push once the client has one to send
  // (see client/lib/auth.ts) — this is what /relink checks against later,
  // so a password reset can prove ownership without ever sending the
  // password or recovery code itself. Optional so older clients (or a
  // client mid-upgrade) can still push without it.
  recoveryToken: tokenSchema.optional(),
  data: z.record(z.unknown()).refine(
    (d) => JSON.stringify(d).length <= MAX_DATA_JSON_BYTES,
    { message: `data exceeds the ${MAX_DATA_JSON_BYTES}-byte limit` },
  ),
});

const pullQuerySchema = z.object({
  email: emailSchema,
  token: tokenSchema,
});

const relinkSchema = z.object({
  email: emailSchema,
  token: tokenSchema,             // new sync token, derived from the new password
  recoveryToken: tokenSchema,     // new recovery token, derived from the newly-issued recovery code
  oldRecoveryToken: tokenSchema.optional(), // proof of the previous recovery token — required whenever one was already registered
});

const deleteSchema = z.object({
  email: emailSchema,
  token: tokenSchema,
});

// Server never sees the password or the raw token — only its hash, the
// same way a password hash works. The token itself is derived client-side
// from the account password (see client/lib/crypto.ts: deriveSyncToken),
// so only someone who knows the password can push/pull that email's data.
const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

class SyncAuthError extends Error {}

// POST /api/sync/push  — body: { email, data, token }
router.post("/push", async (req, res, next) => {
  try {
    const { email: normalizedEmail, data, token, recoveryToken } = pushSchema.parse(req.body);
    const tokenHash = hashToken(token);
    const recoveryTokenHash = recoveryToken ? hashToken(recoveryToken) : undefined;

    // The token check-then-write must be one atomic unit: with two plain
    // await calls, two concurrent pushes to the same not-yet-registered
    // email could both read "no hash yet" before either write lands,
    // letting the second one silently steal the TOFU registration and the
    // first pusher's data. Serializable isolation makes Postgres abort
    // one of two conflicting transactions instead.
    let syncedAt: Date;
    try {
      syncedAt = await prisma.$transaction(async (tx) => {
        const existing = await tx.userSync.findUnique({ where: { email: normalizedEmail } });
        if (existing?.authTokenHash && existing.authTokenHash !== tokenHash) {
          throw new SyncAuthError();
        }
        const now = new Date();
        // Preserve the existing recoveryTokenHash when this push doesn't carry
        // one (an older client, or one that predates having a recovery code
        // at all) rather than clobbering a previously-registered value with null.
        await tx.userSync.upsert({
          where:  { email: normalizedEmail },
          create: { email: normalizedEmail, dataJson: JSON.stringify(data), authTokenHash: tokenHash, recoveryTokenHash },
          update: { dataJson: JSON.stringify(data), syncedAt: now, authTokenHash: tokenHash, ...(recoveryTokenHash ? { recoveryTokenHash } : {}) },
        });
        return now;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      if (err instanceof SyncAuthError) {
        return res.status(401).json({ error: "Invalid sync credentials for this account." });
      }
      // P2034 = write conflict / deadlock from the isolation level above —
      // the losing side of a genuine race. Safe to ask the client to retry.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
        return res.status(409).json({ error: "Sync is busy — please try again." });
      }
      throw err;
    }

    // Normalize into all structured tables — fire & forget so client is never blocked
    normalizeToTables(normalizedEmail, data).catch((err: Error) =>
      console.error("[normalize] failed:", err.message)
    );

    res.json({ ok: true, syncedAt: syncedAt.toISOString() });
  } catch (err) {
    next(err);
  }
});

// GET /api/sync/pull?email=xxx&token=yyy — returns latest saved data
router.get("/pull", async (req, res, next) => {
  try {
    const { email, token } = pullQuerySchema.parse(req.query);

    const record = await prisma.userSync.findUnique({ where: { email } });
    if (!record) return res.status(404).json({ error: "No sync data found for this account." });
    if (!record.authTokenHash) {
      return res.status(401).json({ error: "This account has no sync credentials registered yet — push from an updated client first." });
    }
    if (record.authTokenHash !== hashToken(token)) {
      return res.status(401).json({ error: "Invalid sync credentials for this account." });
    }

    res.json({ ok: true, data: JSON.parse(record.dataJson), syncedAt: record.syncedAt });
  } catch (err) {
    next(err);
  }
});

// POST /api/sync/relink — body: { email, token, recoveryToken, oldRecoveryToken? }
// Called after a password reset (client/lib/auth.ts recoverAccount), which
// changes the sync token push/pull check against. Proves ownership via the
// PREVIOUS recovery token instead — the old recovery code is exactly what
// recoverAccount already required the user to type in, so this lets a
// legitimate password reset keep working without ever sending the password
// or recovery code itself to the server.
router.post("/relink", async (req, res, next) => {
  try {
    const { email, token, recoveryToken, oldRecoveryToken } = relinkSchema.parse(req.body);
    const tokenHash = hashToken(token);
    const recoveryTokenHash = hashToken(recoveryToken);

    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.userSync.findUnique({ where: { email } });

        if (!existing || (!existing.authTokenHash && !existing.recoveryTokenHash)) {
          // Nothing registered yet (this account has never actually synced) —
          // safe to register fresh, the same trust-on-first-use logic push uses.
          await tx.userSync.upsert({
            where: { email },
            create: { email, dataJson: existing?.dataJson ?? "{}", authTokenHash: tokenHash, recoveryTokenHash },
            update: { authTokenHash: tokenHash, recoveryTokenHash },
          });
          return;
        }

        if (!existing.recoveryTokenHash) {
          // Synced before this feature existed — no recovery proof on file to
          // check against. Refuse rather than let anyone who merely knows *a*
          // recovery code silently take over an already-claimed sync slot.
          throw new SyncAuthError();
        }

        if (!oldRecoveryToken || hashToken(oldRecoveryToken) !== existing.recoveryTokenHash) {
          throw new SyncAuthError();
        }

        await tx.userSync.update({
          where: { email },
          data: { authTokenHash: tokenHash, recoveryTokenHash },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      if (err instanceof SyncAuthError) {
        return res.status(401).json({ error: "Could not verify ownership of this account's sync data." });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
        return res.status(409).json({ error: "Sync is busy — please try again." });
      }
      throw err;
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/sync — body: { email, token }
// Called when a user deletes their account (client/lib/auth.ts deleteAccount)
// so a synced backup doesn't outlive the account that created it. Removes
// the user_sync row plus everything normalizeToTables ever wrote into the
// analytics warehouse for that email. A no-op (still 200) if this account
// never actually synced — nothing to delete either way.
router.delete("/", async (req, res, next) => {
  try {
    const { email, token } = deleteSchema.parse(req.body);
    const tokenHash = hashToken(token);

    const record = await prisma.userSync.findUnique({ where: { email } });
    if (record) {
      if (record.authTokenHash && record.authTokenHash !== tokenHash) {
        return res.status(401).json({ error: "Invalid sync credentials for this account." });
      }
      await prisma.userSync.delete({ where: { email } });
    }

    await deleteAllDataForEmail(email);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
