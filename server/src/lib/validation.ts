import { z } from "zod";

// Shared between routes/sync.ts and routes/auth.ts — was previously defined
// independently in each, which meant the validation contract (format,
// length, normalization) could silently drift between routes that both
// gate the same user_sync table.
export const emailSchema = z.string().trim().toLowerCase().email().max(320);
export const tokenSchema = z.string().min(1).max(2000);
