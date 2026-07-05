import { Router } from "express";
import { createHash } from "crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { normalizeToTables } from "../lib/normalizeSync";

const router = Router();
const prisma = new PrismaClient();

// Server never sees the password or the raw token — only its hash, the
// same way a password hash works. The token itself is derived client-side
// from the account password (see client/lib/crypto.ts: deriveSyncToken),
// so only someone who knows the password can push/pull that email's data.
const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

class SyncAuthError extends Error {}

// POST /api/sync/push  — body: { email, data, token }
router.post("/push", async (req, res, next) => {
  try {
    const { email, data, token } = req.body;
    if (!email || !data || !token) return res.status(400).json({ error: "email, data, and token are required." });

    const normalizedEmail = String(email).toLowerCase().trim();
    const tokenHash = hashToken(token);

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
        await tx.userSync.upsert({
          where:  { email: normalizedEmail },
          create: { email: normalizedEmail, dataJson: JSON.stringify(data), authTokenHash: tokenHash },
          update: { dataJson: JSON.stringify(data), syncedAt: now, authTokenHash: tokenHash },
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
    const email = String(req.query.email ?? "").toLowerCase().trim();
    const token = String(req.query.token ?? "");
    if (!email || !token) return res.status(400).json({ error: "email and token query params are required." });

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

export default router;
