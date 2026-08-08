import { Router } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { normalizeToTables, deleteAllDataForEmail } from "../lib/normalizeSync";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { emailSchema, tokenSchema } from "../lib/validation";

const router = Router();

/**
 * Neon's pooled connection can intermittently fail to establish the
 * dedicated backend an interactive transaction needs — observed directly
 * against this project's own pooler in two different shapes: a connection-
 * level PrismaClientInitializationError ("Can't reach database server"),
 * and P2028 ("Transaction API error: Unable to start a transaction in the
 * given time") once the pooler is under real load. Both are infrastructure
 * flakiness, separate from and far more often than a genuine P2034 write
 * conflict (which already has its own 409 contract below and is
 * deliberately NOT retried here, since that's a real conflict the client
 * should decide whether to retry). A short bounded retry keeps a routine
 * push/relink from failing outright on a blip that a fraction of a second
 * would have resolved on its own.
 */
function isRetryableTransactionError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") return true;
  return false;
}

async function withTransactionRetry<T>(fn: () => Promise<T>): Promise<T> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isRetryableTransactionError(err) && attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 250 * attempt));
        continue;
      }
      throw err;
    }
  }
}

// `data` is the client's LocalFinancials blob — its exact shape is
// intentionally NOT modeled here (that would couple this route to every
// field the client ever adds/changes, for a JSON store that's supposed to
// stay flexible). Just bound what a request handler actually needs to be
// safe from: a real email, a real token, and a payload that can't be used
// to exhaust the database with an arbitrarily large row.
const MAX_DATA_JSON_BYTES = 2_000_000; // 2MB — generous for a personal-finance data blob

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
    // .length counts UTF-16 code units, not bytes — a payload heavy in
    // multi-byte UTF-8 characters (e.g. Arabic text in transaction notes,
    // a real scenario for this app's target audience) could sail past the
    // intended 2MB cap while still passing a code-unit-based check.
    (d) => Buffer.byteLength(JSON.stringify(d), "utf8") <= MAX_DATA_JSON_BYTES,
    { message: `data exceeds the ${MAX_DATA_JSON_BYTES}-byte limit` },
  ),
});

// Only `email` travels in the query string; the token comes from the
// Authorization header instead (see the route handler below) — push/relink/
// delete already send their token in a POST body, so pull was the one
// exception putting a bearer secret somewhere as log/history-prone as a URL.
const pullQuerySchema = z.object({
  email: emailSchema,
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

// Plain `!==` on hex digests is a textbook timing-side-channel smell — low
// real-world exploitability here (SHA-256 preimage resistance means timing
// your way to the stored hash still doesn't hand over a token that hashes
// to it), but a constant-time compare is cheap and removes the smell
// entirely. Both inputs are always same-length hex digests from hashToken,
// but guard the length anyway since timingSafeEqual throws on a mismatch
// rather than returning false.
const hashesEqual = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

class SyncAuthError extends Error {}

// POST /api/sync/push  — body: { email, data, token }
router.post("/push", async (req, res, next) => {
  try {
    const { email: normalizedEmail, data, token, recoveryToken } = pushSchema.parse(req.body);
    const tokenHash = hashToken(token);
    const recoveryTokenHash = recoveryToken ? hashToken(recoveryToken) : undefined;
    // Computed once and reused in both the create and update branches below —
    // this payload can be up to ~2MB, no reason to re-serialize it twice more.
    const dataJson = JSON.stringify(data);

    // The token check-then-write must be one atomic unit: with two plain
    // await calls, two concurrent pushes to the same not-yet-registered
    // email could both read "no hash yet" before either write lands,
    // letting the second one silently steal the TOFU registration and the
    // first pusher's data. Serializable isolation makes Postgres abort
    // one of two conflicting transactions instead.
    let syncedAt: Date;
    try {
      syncedAt = await withTransactionRetry(() => prisma.$transaction(async (tx) => {
        const existing = await tx.userSync.findUnique({ where: { email: normalizedEmail } });
        if (existing?.authTokenHash && !hashesEqual(existing.authTokenHash, tokenHash)) {
          throw new SyncAuthError();
        }
        const now = new Date();
        // Preserve the existing recoveryTokenHash when this push doesn't carry
        // one (an older client, or one that predates having a recovery code
        // at all) rather than clobbering a previously-registered value with null.
        await tx.userSync.upsert({
          where:  { email: normalizedEmail },
          create: { email: normalizedEmail, dataJson, authTokenHash: tokenHash, recoveryTokenHash },
          update: { dataJson, syncedAt: now, authTokenHash: tokenHash, ...(recoveryTokenHash ? { recoveryTokenHash } : {}) },
        });
        return now;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    } catch (err) {
      if (err instanceof SyncAuthError) {
        return res.status(401).json({ error: "Invalid sync credentials for this account." });
      }
      // P2034 = write conflict / deadlock from the isolation level above —
      // the losing side of a genuine race. Safe to ask the client to retry.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
        return res.status(409).json({ error: "Sync is busy. Please try again." });
      }
      throw err;
    }

    // Normalize into all structured tables — fire & forget so client is never blocked
    normalizeToTables(normalizedEmail, data).catch((err: Error) =>
      logger.error("normalize_failed", err, { email: normalizedEmail })
    );

    res.json({ ok: true, syncedAt: syncedAt.toISOString() });
  } catch (err) {
    next(err);
  }
});

// GET /api/sync/pull?email=xxx&token=yyy — returns latest saved data
router.get("/pull", async (req, res, next) => {
  try {
    const { email } = pullQuerySchema.parse(req.query);
    const auth = req.header("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    tokenSchema.parse(token);
    // Metadata only — never the token/password or anything derived from
    // them. This is currently the ONLY place a failed sign-in-on-new-device
    // attempt leaves any trace at all; without it, diagnosing a real report
    // of "wrong password" from a specific device is pure guesswork.
    const meta = { email, userAgent: req.header("user-agent") ?? null };

    const record = await prisma.userSync.findUnique({ where: { email } });
    if (!record) {
      logger.warn("pull_denied_no_record", meta);
      return res.status(404).json({ error: "No sync data found for this account." });
    }
    if (!record.authTokenHash) {
      logger.warn("pull_denied_no_token_registered", meta);
      return res.status(401).json({ error: "This account has no sync credentials registered yet. Push from an updated client first." });
    }
    if (!hashesEqual(record.authTokenHash, hashToken(token))) {
      logger.warn("pull_denied_token_mismatch", { ...meta, tokenLength: token.length, lastSyncedAt: record.syncedAt });
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
      await withTransactionRetry(() => prisma.$transaction(async (tx) => {
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

        if (!oldRecoveryToken || !hashesEqual(hashToken(oldRecoveryToken), existing.recoveryTokenHash)) {
          throw new SyncAuthError();
        }

        await tx.userSync.update({
          where: { email },
          data: { authTokenHash: tokenHash, recoveryTokenHash },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    } catch (err) {
      if (err instanceof SyncAuthError) {
        return res.status(401).json({ error: "Could not verify ownership of this account's sync data." });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
        return res.status(409).json({ error: "Sync is busy. Please try again." });
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
    if (!record) {
      // Nothing to verify a token against — treat as the documented no-op
      // rather than deleting any warehouse data. normalizeToTables can, in
      // a narrow race, finish creating warehouse rows for an email whose
      // UserSync row is already gone (see its own stillSynced comment) —
      // wiping that orphan here with zero proof of ownership would let
      // anyone delete another account's warehouse data just by submitting
      // their email with any token at all.
      return res.json({ ok: true });
    }
    // Mirror /pull's check exactly: a falsy authTokenHash must REFUSE the
    // request, not skip it. `record.authTokenHash && ...` short-circuits
    // to false (allowing the delete through with zero proof of ownership)
    // whenever authTokenHash is null — the opposite of what's intended.
    if (!record.authTokenHash) {
      return res.status(401).json({ error: "This account has no sync credentials registered yet. Nothing to verify against." });
    }
    if (!hashesEqual(record.authTokenHash, tokenHash)) {
      return res.status(401).json({ error: "Invalid sync credentials for this account." });
    }

    try {
      await prisma.userSync.delete({ where: { email } });
    } catch (err) {
      // P2025 = "record to delete does not exist" — a concurrent duplicate
      // delete request (double-click, client retry after a slow response)
      // already removed it between the findUnique above and this call. The
      // end state either request wanted is already true, so this is a
      // success, not an error.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")) throw err;
    }

    await deleteAllDataForEmail(email);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
