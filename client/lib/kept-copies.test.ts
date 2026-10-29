// Session 28, item 3 (owner; wording approved, merged in session 29): opening a kept copy.
// Kept copies (essa_unreadable_<id>_<time>) hold this account's data that
// this browser couldn't open, or that a device kept before starting from the
// backup or being recovered (sessions 27-28, with their old key envelopes).
// - listKeptCopies: how many and when, nothing of the contents;
// - openKeptCopy: the password it was locked with, tried against the copy's
//   own envelopes, the account's current password envelope (an ERR-04 copy),
//   and the pre-envelope legacy key; a wrong password opens nothing;
// - mergeCopyIntoLocal: merged as a fetched copy is (the fingerprint rule,
//   deletion records), described for the usual notice.
import { it, expect, beforeEach, vi } from "vitest";
import { listKeptCopies, removeKeptCopy, DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";
import { openKeptCopy } from "./auth";
import { createEnvelopes, sealWithDek, legacyKey } from "./crypto";
import { mergeCopyIntoLocal } from "./syncService";
import { recordDeletion } from "./localData";

vi.mock("./syncSeen", async (orig) => ({ ...(await orig<typeof import("./syncSeen")>()), loadSeen: vi.fn(async () => null) }));

const ID = "u1", USERS = "essa_users_v1";
const OLD = "old-password-123", CURRENT = "current-password-456";
const tx = (id: string, description: string) => ({ id, amount: 12, currency: "USD", bucket: "WANTS", description, date: "2026-10-18", createdAt: "2026-10-18T08:00:00.000Z" }) as StoredTransaction;
const DATA = { ...DEFAULT_DATA, income: 3000, transactions: [tx("t1", "Lunch"), tx("t2", "Copper kettle")] } as LocalFinancials;

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

/** A user record whose password envelope opens with `password`; returns its key. */
async function account(password: string) {
  const env = await createEnvelopes(password, ID);
  localStorage.setItem(USERS, JSON.stringify([{ id: ID, email: "quartz@test.com", name: "Quartz Lantern", pwHash: "pbkdf2:x", createdAt: "2026-10-01T00:00:00.000Z", isAdmin: true, wrappedDekPassword: env.wrappedPassword, wrappedDekRecovery: env.wrappedRecovery }]));
  return env;
}

it("lists this account's copies, oldest first, by date only; not their envelopes, not another account's", () => {
  localStorage.setItem("essa_unreadable_u1_2026-10-20T09:00:00.000Z", "x");
  localStorage.setItem("essa_unreadable_u1_2026-10-20T09:00:00.000Z_envelopes", "{}");
  localStorage.setItem("essa_unreadable_u1_2026-10-15T08:30:00.000Z", "x");
  localStorage.setItem("essa_unreadable_u10_2026-10-16T08:30:00.000Z", "x");
  expect(listKeptCopies(ID)).toEqual([
    { key: "essa_unreadable_u1_2026-10-15T08:30:00.000Z", keptAt: "2026-10-15T08:30:00.000Z" },
    { key: "essa_unreadable_u1_2026-10-20T09:00:00.000Z", keptAt: "2026-10-20T09:00:00.000Z" },
  ]);
});

it("a copy with its own envelopes (starting from the backup, or recovery) opens with the old password", async () => {
  await account(CURRENT);
  const old = await createEnvelopes(OLD, ID);
  const key = "essa_unreadable_u1_2026-10-20T09:00:00.000Z";
  localStorage.setItem(key, await sealWithDek(old.dek, JSON.stringify(DATA)));
  localStorage.setItem(`${key}_envelopes`, JSON.stringify({ wrappedDekPassword: old.wrappedPassword, wrappedDekRecovery: old.wrappedRecovery }));
  expect(JSON.parse((await openKeptCopy(ID, key, OLD))!)).toMatchObject({ income: 3000 });
  expect(await openKeptCopy(ID, key, CURRENT)).toBeNull();
  expect(await openKeptCopy(ID, key, "neither-of-them-9")).toBeNull();
});

it("an ERR-04 copy (no envelopes of its own) opens with the account's current password", async () => {
  const env = await account(CURRENT);
  const key = "essa_unreadable_u1_2026-10-15T08:30:00.000Z";
  localStorage.setItem(key, await sealWithDek(env.dek, JSON.stringify(DATA)));
  expect(JSON.parse((await openKeptCopy(ID, key, CURRENT))!)).toMatchObject({ income: 3000 });
  expect(await openKeptCopy(ID, key, OLD)).toBeNull();
});

it("a copy written under the pre-envelope legacy key opens with that password", async () => {
  await account(CURRENT);
  const key = "essa_unreadable_u1_2026-09-01T08:30:00.000Z";
  localStorage.setItem(key, await sealWithDek(await legacyKey(OLD, ID), JSON.stringify(DATA)));
  expect(JSON.parse((await openKeptCopy(ID, key, OLD))!)).toMatchObject({ income: 3000 });
});

it("opening reads only: the copy, its envelopes and the user record are unchanged", async () => {
  await account(CURRENT);
  const old = await createEnvelopes(OLD, ID);
  const key = "essa_unreadable_u1_2026-10-20T09:00:00.000Z";
  localStorage.setItem(key, await sealWithDek(old.dek, JSON.stringify(DATA)));
  localStorage.setItem(`${key}_envelopes`, JSON.stringify({ wrappedDekPassword: old.wrappedPassword }));
  const before = JSON.stringify(Object.entries(localStorage));
  await openKeptCopy(ID, key, OLD);
  await openKeptCopy(ID, key, "wrong-password-1");
  expect(JSON.stringify(Object.entries(localStorage))).toBe(before);
});

it("removeKeptCopy removes the copy and its envelopes, nothing else", () => {
  localStorage.setItem("essa_unreadable_u1_A", "x"); localStorage.setItem("essa_unreadable_u1_A_envelopes", "{}"); localStorage.setItem("essa_unreadable_u1_B", "y");
  removeKeptCopy("essa_unreadable_u1_A");
  expect(Object.keys(localStorage).sort()).toEqual(["essa_unreadable_u1_B"]);
});

it("merging adds what only the copy holds and respects this device's deletions", async () => {
  const base = { ...DEFAULT_DATA, income: 3000, transactions: [tx("t1", "Lunch")] } as LocalFinancials;
  const current = { ...base, deletedKeys: recordDeletion(base, "transactions", "t3", new Date("2026-10-19T08:00:00.000Z")) } as LocalFinancials;
  const copy = { ...DATA, transactions: [...DATA.transactions, tx("t3", "Deleted here since")] } as LocalFinancials;
  const r = await mergeCopyIntoLocal(current, copy);
  if (r.newerVersion) throw new Error("not merged");
  expect(r.mergedData.transactions.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  expect(r.addedFromServer).toBe(1);
});

it("a copy written by newer code isn't merged", async () => {
  const copy = { ...DATA, schemaVersion: 999 } as LocalFinancials;
  expect(await mergeCopyIntoLocal({ ...DEFAULT_DATA } as LocalFinancials, copy)).toEqual({ newerVersion: true });
});
