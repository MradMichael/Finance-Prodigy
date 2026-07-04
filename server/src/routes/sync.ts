import { Router } from "express";
import { createHash } from "crypto";
import { PrismaClient } from "@prisma/client";
import { normalizeToTables } from "../lib/normalizeSync";

const router = Router();
const prisma = new PrismaClient();

// Server never sees the password or the raw token — only its hash, the
// same way a password hash works. The token itself is derived client-side
// from the account password (see client/lib/crypto.ts: deriveSyncToken),
// so only someone who knows the password can push/pull that email's data.
const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

// POST /api/sync/push  — body: { email, data, token }
router.post("/push", async (req, res, next) => {
  try {
    const { email, data, token } = req.body;
    if (!email || !data || !token) return res.status(400).json({ error: "email, data, and token are required." });

    const normalizedEmail = String(email).toLowerCase().trim();
    const tokenHash = hashToken(token);

    const existing = await prisma.userSync.findUnique({ where: { email: normalizedEmail } });
    // Legacy rows (pre-auth) have no hash yet — first authenticated push registers it (TOFU).
    if (existing?.authTokenHash && existing.authTokenHash !== tokenHash) {
      return res.status(401).json({ error: "Invalid sync credentials for this account." });
    }

    const syncedAt = new Date();
    await prisma.userSync.upsert({
      where:  { email: normalizedEmail },
      create: { email: normalizedEmail, dataJson: JSON.stringify(data), authTokenHash: tokenHash },
      update: { dataJson: JSON.stringify(data), syncedAt, authTokenHash: tokenHash },
    });

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
