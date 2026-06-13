import { Router } from "express";
import { ah } from "../lib/core";

const router = Router();

// Dashboard is computed client-side from synced data.
// This endpoint is a placeholder for a future server-side implementation.
router.get("/", ah(async (_req, res) => {
  res.status(501).json({ error: "Dashboard is computed client-side. Use /api/sync/pull to get data." });
}));

export default router;
