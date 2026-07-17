import { PrismaClient } from "@prisma/client";

// Single shared instance — routes/sync.ts, routes/auth.ts, and
// lib/normalizeSync.ts each used to create their own `new PrismaClient()`,
// which means their own independent connection pool. For a small Express
// process that's needless connection overhead against Neon's connection
// cap, not a real isolation need (nothing here requires separate pools).
export const prisma = new PrismaClient();
