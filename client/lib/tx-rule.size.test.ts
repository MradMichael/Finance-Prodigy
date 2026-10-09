// Item 7 (owner, session 8): fingerprint ALL transactions, and report the
// record's measured size at 15,000. The record (lib/syncSeen.ts) is one
// 16-hex-digit fingerprint per transaction, keyed by id, encrypted, stored
// beside the account's data. The bound below is the measurement plus
// headroom; the measured figures are in the session log.
import { it, expect } from "vitest";
import { seenOf } from "./syncSeen";
import { encryptJSON, activateSessionKey } from "./crypto";
import { uid, DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";

it("at 15,000 transactions the encrypted record stays under 1.2 MB", async () => {
  activateSessionKey(new Uint8Array(32).fill(7));
  const transactions = Array.from({ length: 15_000 }, (_, i) => ({
    id: uid(), amount: 1 + (i % 97), currency: "USD", bucket: "WANTS", description: `row-${i}`, date: "2026-10-01", updatedAt: "2026-10-01T09:00:00.000Z",
  }) as StoredTransaction);
  const data = { ...DEFAULT_DATA, income: 3000, transactions } as LocalFinancials;
  const record = seenOf(data);
  expect(Object.keys(record.kinds.transactions ?? {})).toHaveLength(15_000);
  const plain = JSON.stringify(record);
  const sealed = await encryptJSON(plain);
  expect(plain.length).toBeLessThan(900_000);
  expect(sealed.length).toBeLessThan(1_200_000);
}, 60_000);
