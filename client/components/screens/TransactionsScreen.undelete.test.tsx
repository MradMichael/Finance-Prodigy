// DI-14 (session 5): "Recently deleted → Restore" was undone by the next merge
// when another device still held the deleted copy. The restore cleared
// deletedAt and nothing else, and the merge ranks a deleted copy above a live
// one, so the other device's deleted copy won and deleted it again on both.
//
// Fix: an un-delete is a revival at a new generation (DI-13's mechanism): it
// writes revivedKeys.transactions[id] and drops the copy's deletedGen. A
// revival beats a deletion made at an earlier generation; deleting it again
// is made at the revival's generation, and at the same generation a deletion
// wins.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import TransactionsScreen from "./TransactionsScreen";
import { DEFAULT_DATA, softDelete, type LocalFinancials, type StoredTransaction } from "../../lib/localData";
import { mergeFinancials } from "../../lib/syncMerge";

afterEach(cleanup);

const T0 = new Date("2026-10-08T12:00:00.000Z");
const live: StoredTransaction = { id: "t-kebab", amount: 14, currency: "USD", bucket: "WANTS", description: "Kebab", date: "2026-10-05", updatedAt: "2026-10-05T12:00:00.000Z" };
const deleted = { ...live, deletedAt: "2026-10-06T09:00:00.000Z", updatedAt: "2026-10-06T09:00:00.000Z" } as StoredTransaction;
const ON = { syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } };
// Both devices hold the deletion: it was made on the phone and reached the laptop.
const PHONE = { ...DEFAULT_DATA, ...ON, transactions: [deleted] } as LocalFinancials;
const LAPTOP = { ...DEFAULT_DATA, ...ON, transactions: [deleted] } as LocalFinancials;
const merge = (a: LocalFinancials, b: LocalFinancials) => mergeFinancials(a, b, T0).data;
const kebab = (d: LocalFinancials) => d.transactions.find((t) => t.id === "t-kebab")!;

/** The phone restores the transaction through the screen's own button. */
function restoreOnPhone(): LocalFinancials {
  const onChange = vi.fn();
  render(<TransactionsScreen financials={PHONE} onChange={onChange} onEdit={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Recently deleted/ }));
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  return onChange.mock.calls.at(-1)![0] as LocalFinancials;
}

it("a restored transaction stays restored after merging with a device that still holds it deleted", () => {
  const phone = restoreOnPhone();
  expect(kebab(phone).deletedAt).toBeUndefined(); // premise: restored on this device
  expect(kebab(merge(phone, LAPTOP)).deletedAt).toBeUndefined();
  expect(kebab(merge(LAPTOP, phone)).deletedAt).toBeUndefined();
});

it("the restored copy carries no deletion marks, and the revival is one generation on", () => {
  // A deletion already made after an earlier restore (generation 1).
  const phone = { ...PHONE, transactions: [{ ...deleted, deletedGen: 1 }], revivedKeys: { transactions: { "t-other": 1 } } } as LocalFinancials;
  const onChange = vi.fn();
  render(<TransactionsScreen financials={phone} onChange={onChange} onEdit={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Recently deleted/ }));
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  const out = onChange.mock.calls.at(-1)![0] as LocalFinancials;
  expect(kebab(out)).not.toHaveProperty("deletedAt");
  expect(kebab(out)).not.toHaveProperty("deletedGen");
  expect(out.revivedKeys?.transactions).toEqual({ "t-other": 1, "t-kebab": 2 });
});

it("deleting it again after the restore wins, from either device", () => {
  const phone = restoreOnPhone();
  const laptop = merge(LAPTOP, phone); // the laptop has seen the restore
  const at = "2026-10-08T15:00:00.000Z";
  const phoneAgain = { ...phone, transactions: phone.transactions.map((t) => (t.id === "t-kebab" ? softDelete(phone, t, at) : t)) };
  for (const d of [merge(phoneAgain, laptop), merge(laptop, phoneAgain)]) expect(kebab(d).deletedAt).toBe(at);
  const laptopAgain = { ...laptop, transactions: laptop.transactions.map((t) => (t.id === "t-kebab" ? softDelete(laptop, t, at) : t)) };
  for (const d of [merge(laptopAgain, phone), merge(phone, laptopAgain)]) expect(kebab(d).deletedAt).toBe(at);
});
