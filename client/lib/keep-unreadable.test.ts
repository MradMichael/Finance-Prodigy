// Session 23, item 4 (owner): before a restore replaces a record that can't be
// opened, the stored encrypted value is kept as it is, under its own key: not
// deleted, not synced, not exported, not counted as an account's data. Only
// Delete account removes it (the privacy page: Delete account "removes your
// account and financial data from your browser").
import { it, expect, beforeEach } from "vitest";
import { keepUnreadableRecord, removeUnreadableCopies, saveData, loadData, DEFAULT_DATA, type LocalFinancials } from "./localData";
import { activateSessionKey } from "./crypto";
import { hasAnyLocalData } from "./syncService";
import { deleteAccount } from "./auth";

const AT = new Date("2026-10-15T09:00:00.000Z");
beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  activateSessionKey(new Uint8Array(32).fill(7));
  await saveData({ ...DEFAULT_DATA, income: 3000 } as LocalFinancials, "u1");
});

it("an unreadable record is copied byte for byte to its own key; the active record is left for the caller", async () => {
  const blob = localStorage.getItem("essa_data_u1");
  activateSessionKey(new Uint8Array(32).fill(9));
  const key = await keepUnreadableRecord("u1", AT);
  expect(key).toBe("essa_unreadable_u1_2026-10-15T09:00:00.000Z");
  expect(localStorage.getItem(key!)).toBe(blob);
  expect(localStorage.getItem("essa_data_u1")).toBe(blob);
});

it("a record that opens, or none at all, isn't copied", async () => {
  expect(await keepUnreadableRecord("u1", AT)).toBeNull();
  expect(await keepUnreadableRecord("nobody", AT)).toBeNull();
  expect(Object.keys(localStorage).filter((k) => k.startsWith("essa_unreadable_"))).toEqual([]);
});

it("a second copy never replaces the first", async () => {
  activateSessionKey(new Uint8Array(32).fill(9));
  const first = await keepUnreadableRecord("u1", AT);
  const second = await keepUnreadableRecord("u1", new Date("2026-10-15T09:05:00.000Z"));
  expect(first).not.toBe(second);
  expect(Object.keys(localStorage).filter((k) => k.startsWith("essa_unreadable_u1_"))).toHaveLength(2);
});

it("a kept copy isn't an account's data: not counted, and not what the account loads", async () => {
  const blob = localStorage.getItem("essa_data_u1")!;
  localStorage.clear();
  localStorage.setItem("essa_unreadable_u1_2026-10-15T09:00:00.000Z", blob);
  expect(hasAnyLocalData()).toBe(false);
  expect((await loadData("u1")).income).toBe(DEFAULT_DATA.income);
});

it("Delete account removes the kept copies too", async () => {
  localStorage.setItem("essa_unreadable_u1_2026-10-15T09:00:00.000Z", "x");
  localStorage.setItem("essa_unreadable_u2_2026-10-15T09:00:00.000Z", "y");
  await deleteAccount("u1");
  expect(localStorage.getItem("essa_unreadable_u1_2026-10-15T09:00:00.000Z")).toBeNull();
  expect(localStorage.getItem("essa_unreadable_u2_2026-10-15T09:00:00.000Z")).toBe("y");
});

// Session 24, item 1: Erase all data removes them too, through the same helper as Delete account.
it("removeUnreadableCopies removes one account's kept copies and no one else's", () => {
  localStorage.setItem("essa_unreadable_u1_2026-10-15T09:00:00.000Z", "x");
  localStorage.setItem("essa_unreadable_u10_2026-10-15T09:00:00.000Z", "z");
  localStorage.setItem("essa_unreadable_u2_2026-10-15T09:00:00.000Z", "y");
  removeUnreadableCopies("u1");
  expect(localStorage.getItem("essa_unreadable_u1_2026-10-15T09:00:00.000Z")).toBeNull();
  expect(localStorage.getItem("essa_unreadable_u10_2026-10-15T09:00:00.000Z")).toBe("z");
  expect(localStorage.getItem("essa_unreadable_u2_2026-10-15T09:00:00.000Z")).toBe("y");
  expect(localStorage.getItem("essa_data_u1")).not.toBeNull();
});
