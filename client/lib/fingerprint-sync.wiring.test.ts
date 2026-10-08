// Plan H, part 5b: when this device records "what the server held at my last
// sync", and that the record never leaves the device.
//
// The record is only safe once this device HOLDS the server's copy (or a
// merge of it). Recorded for a copy that was never applied, this device's
// older records would look like fresh edits, and the next merge would undo
// the other device's changes. So: a successful push records what it pushed;
// a pull alone, a failed push, and the fetch on open record nothing here (the
// dashboard records the fetched copy once it has stored it: page tests).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("./auth", () => ({ getRecoveryTokenForSync: vi.fn(async () => undefined), getSession: () => SESSION }));

import { pushToServer, pullFromServer, mergeAndPush, fetchAndMerge } from "./syncService";
import { loadSeen, saveSeen, seenOf } from "./syncSeen";
import { mergeFinancials } from "./syncMerge";
import { activateSessionKey } from "./crypto";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal } from "./localData";

const SEEN = "essa_seen_u1";
const goal = (o: Partial<StoredGoal> = {}): StoredGoal => ({
  id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 100, currency: "USD", targetDate: "2027-03-01",
  createdAt: "2026-05-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z", ...o,
});
const on = { syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } };
const data = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, ...on, income: 3150.75, goals: [goal()], ...o }) as LocalFinancials;

let serverData: LocalFinancials;
let pushStatus: number;
const bodies: { url: string; body: string }[] = [];
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  sessionStorage.setItem("essa_st_v1", "tok");
  activateSessionKey(new Uint8Array(32).fill(7));
  serverData = data();
  pushStatus = 200;
  bodies.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    bodies.push({ url, body: String(init.body) });
    if (url === "/api/sync/pull") return new Response(JSON.stringify({ ok: true, data: serverData, syncedAt: "2026-10-08T09:00:00.000Z" }), { status: 200 });
    if (pushStatus === 409) return new Response(JSON.stringify({ code: "stale_push", error: "moved on" }), { status: 409 });
    if (pushStatus !== 200) return new Response("down", { status: pushStatus });
    return new Response(JSON.stringify({ ok: true, syncedAt: "2026-10-08T09:01:00.000Z" }), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("recorded only once this device holds the server's copy", () => {
  it("a successful push records exactly what it pushed", async () => {
    const mine = data({ goals: [goal({ name: "MacBook" })] });
    expect((await pushToServer("u1@example.com", mine)).ok).toBe(true);
    expect(await loadSeen("u1")).toEqual(seenOf(mine));
  });

  it("a failed push records nothing", async () => {
    pushStatus = 500;
    expect((await pushToServer("u1@example.com", data())).ok).toBe(false);
    expect(localStorage.getItem(SEEN)).toBeNull();
  });

  it("a pull alone records nothing: its copy may never be applied (the empty-account check, a declined restore)", async () => {
    expect((await pullFromServer("u1@example.com")).ok).toBe(true);
    expect(localStorage.getItem(SEEN)).toBeNull();
  });

  it("a merge whose push fails leaves the previous record as it was", async () => {
    const before = data();
    await saveSeen("u1", before);
    serverData = data({ goals: [goal({ name: "MacBook", updatedAt: "2026-10-07T09:00:00.000Z" })] });
    pushStatus = 409;
    expect((await mergeAndPush("u1@example.com", data())).ok).toBe(false);
    expect(await loadSeen("u1")).toEqual(seenOf(before));
  });

  it("the fetch on open records nothing itself, and hands the dashboard the server's copy to record once stored", async () => {
    serverData = data({ goals: [goal({ name: "MacBook" })] });
    const r = await fetchAndMerge("u1@example.com", () => data());
    if (!r.ok || r.skipped) throw new Error("expected a merge");
    expect(r.serverCopy).toEqual(serverData);
    expect(localStorage.getItem(SEEN)).toBeNull();
  });
});

describe("the fetch on open, under the rule", () => {
  it("a goal changed only on the other device is a change here (stored), not left behind", async () => {
    await saveSeen("u1", data());
    serverData = data({ goals: [goal({ name: "MacBook" })] });
    const r = await fetchAndMerge("u1@example.com", () => data());
    if (!r.ok || r.skipped) throw new Error("expected a merge");
    expect(r.mergedData.goals[0].name).toBe("MacBook");
    expect(r.localChanged).toBe(true);
    expect(r.serverBehind).toBe(false);
  });

  it("a setting changed only here is something the server lacks (pushed)", async () => {
    await saveSeen("u1", data());
    const r = await fetchAndMerge("u1@example.com", () => data({ income: 3400, settingsUpdatedAt: { income: "2026-10-08T08:00:00.000Z" } }));
    if (!r.ok || r.skipped) throw new Error("expected a merge");
    expect(r.mergedData.income).toBe(3400);
    expect(r.serverBehind).toBe(true);
    expect(r.localChanged).toBe(false);
  });

  it("a card added only on the other device arrives (plan H 5c: cards merge under the rule)", async () => {
    await saveSeen("u1", data());
    serverData = data({ cards: [{ id: "c1", type: "Visa", last4: "4242", label: "Visa •••• 4242" }] });
    const r = await fetchAndMerge("u1@example.com", () => data());
    if (!r.ok || r.skipped) throw new Error("expected a merge");
    expect(r.mergedData.cards.map((c) => c.id)).toEqual(["c1"]);
    expect(r.localChanged).toBe(true);
  });

  it("with no record yet, a goal-only difference is today's: this device's copy, nothing stored, nothing pushed", async () => {
    serverData = data({ goals: [goal({ name: "MacBook" })] });
    const r = await fetchAndMerge("u1@example.com", () => data());
    if (!r.ok || r.skipped) throw new Error("expected a merge");
    expect(r.mergedData.goals[0].name).toBe("Laptop");
    expect([r.localChanged, r.serverBehind]).toEqual([false, false]);
  });
});

describe("what both devices changed reaches the notice (plan H 5d)", () => {
  const both = () => ({ local: data({ goals: [goal({ name: "Laptop Pro", updatedAt: "2026-10-05T00:00:00.000Z" })] }), server: data({ goals: [goal({ name: "MacBook", updatedAt: "2026-10-06T00:00:00.000Z" })] }) });
  it("from the conflict merge", async () => {
    await saveSeen("u1", data());
    const { local, server } = both(); serverData = server;
    const r = await mergeAndPush("u1@example.com", local);
    if (!r.ok) throw new Error(r.error);
    expect(r.clashes).toEqual([{ kind: "goal", name: "MacBook", later: true }]);
  });
  it("from the fetch on open", async () => {
    await saveSeen("u1", data());
    const { local, server } = both(); serverData = server;
    const r = await fetchAndMerge("u1@example.com", () => local);
    if (!r.ok || r.skipped) throw new Error("expected a merge");
    expect(r.clashes).toEqual([{ kind: "goal", name: "MacBook", later: true }]);
  });
});

describe("the first merge after the update", () => {
  it("with no record, the conflict merge pushes exactly today's merge", async () => {
    const local = data({ goals: [goal({ name: "Laptop Pro" })], income: 3200 });
    serverData = data({ goals: [goal({ name: "MacBook" }), goal({ id: "g9", name: "Trip" })], income: 3400 });
    const r = await mergeAndPush("u1@example.com", local);
    if (!r.ok) throw new Error("expected a merge");
    expect(r.mergedData).toEqual(mergeFinancials(local, serverData, new Date()).data);
  });
});

describe("the record never leaves this device", () => {
  it("is stored encrypted, under its own key, outside the account's data", async () => {
    await saveSeen("u1", data());
    const raw = localStorage.getItem(SEEN)!;
    expect(raw).toBeTruthy();
    expect(raw).not.toContain("goals");
    expect(raw).not.toContain(Object.values(seenOf(data()).kinds.goals!)[0]);
    expect(localStorage.getItem("essa_data_u1")).toBeNull(); // not written into the data
  });

  it("is not in the upload", async () => {
    await saveSeen("u1", data());
    const prints = Object.values(seenOf(data()).kinds).flatMap((k) => Object.values(k ?? {}));
    await pushToServer("u1@example.com", data());
    const upload = bodies.find((b) => b.url === "/api/sync/push")!.body;
    expect(upload).not.toContain("essa_seen");
    expect(upload).not.toContain('"kinds"');
    for (const p of prints) expect(upload).not.toContain(p);
  });
});
