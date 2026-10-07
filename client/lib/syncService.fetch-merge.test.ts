// SYNC-1 step 3 (DI-10, 2026-10-07): with backup on, a device fetches the
// server's copy when ESSA opens or comes back into view, and merges it in.
//
// What this layer owns, and why each rule exists:
//   * the pull does NOT record the sync time. The merge still keeps this
//     device's copy of goals, debts, recurring items, assets, cards and
//     settings, so the server's data is not fully taken. Recording it would
//     let this device's next push land without a conflict, and so without
//     the merge notice that names those fields -- a silent overwrite of the
//     other device's edits. Unrecorded, the next push meets the conflict
//     merge exactly as it does today.
//   * the merge runs against the local copy as it is when the pull LANDS, not
//     when it started: Render can take 30 s to wake, and an edit made in that
//     time must survive.
//   * "push needed" counts only what merges. A difference in the fields that
//     keep this device's copy must not push: a device merely opened would
//     overwrite the other device's newer edits to them.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchAndMerge, pullFromServer } from "./syncService";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";

const LAST_SYNC = "essa_last_sync";
const tx = (id: string, description: string, amount: number, date: string): StoredTransaction => ({
  id, description, amount, currency: "USD", bucket: "WANTS", category: "dining", date,
  updatedAt: `${date}T12:00:00.000Z`,
} as StoredTransaction);
const BISTRO = tx("t-bistro", "Bistro Margaux", 46.8, "2026-10-06");
const KETTLE = tx("t-kettle", "Cobalt kettle", 41.6, "2026-10-05");
const on = { syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } };
const laptop = (extra: Partial<LocalFinancials> = {}) =>
  ({ ...DEFAULT_DATA, ...on, income: 3150.75, transactions: [KETTLE], ...extra }) as LocalFinancials;

let serverData: LocalFinancials;
let respond: () => Response;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(LAST_SYNC, "2026-10-05T08:00:00.000Z");
  sessionStorage.setItem("essa_st_v1", "tok");
  serverData = laptop({ transactions: [KETTLE, BISTRO] });
  respond = () => new Response(JSON.stringify({ ok: true, data: serverData, syncedAt: "2026-10-06T19:02:11.000Z", hasRecoveryCode: true }), { status: 200 });
  vi.stubGlobal("fetch", vi.fn(async () => respond()));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("fetchAndMerge", () => {
  it("an expense logged on the other device arrives, and nothing here needs pushing", async () => {
    const r = await fetchAndMerge("u1@example.com", () => laptop());
    if (!r.ok || r.skipped) throw new Error("expected a merge");
    expect(r.mergedData.transactions.map((t) => t.id).sort()).toEqual(["t-bistro", "t-kettle"]);
    expect(r.localChanged).toBe(true);
    expect(r.serverBehind).toBe(false);
    expect(r.addedFromServer).toBe(1);
  });

  it("asks with the sync token and the address in the body, like every pull", async () => {
    await fetchAndMerge("u1@example.com", () => laptop());
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/sync/pull");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({ email: "u1@example.com" });
  });

  it("does not record the sync time: the server's copy of the fields that don't merge was not taken", async () => {
    await fetchAndMerge("u1@example.com", () => laptop());
    expect(localStorage.getItem(LAST_SYNC)).toBe("2026-10-05T08:00:00.000Z");
  });

  it("a plain pull still records it (Restore, the first-load pull, the conflict merge)", async () => {
    await pullFromServer("u1@example.com");
    expect(localStorage.getItem(LAST_SYNC)).toBe("2026-10-06T19:02:11.000Z");
  });

  it("merges against the local copy as it is when the pull lands, not when it started", async () => {
    let release!: () => void;
    const landed = new Promise<void>((r) => { release = r; });
    vi.stubGlobal("fetch", vi.fn(async () => { await landed; return respond(); }));
    let local = laptop();
    const pending = fetchAndMerge("u1@example.com", () => local);
    // Typed while the server was waking up.
    const STOOL = tx("t-stool", "Amber stool", 22.15, "2026-10-07");
    local = laptop({ transactions: [KETTLE, STOOL] });
    release();
    const r = await pending;
    if (!r.ok || r.skipped) throw new Error("expected a merge");
    expect(r.mergedData.transactions.map((t) => t.id).sort()).toEqual(["t-bistro", "t-kettle", "t-stool"]);
    expect(r.serverBehind).toBe(true);
  });

  it("goals and settings that differ keep this device's copy, and do not call for a push", async () => {
    serverData = laptop({ income: 3420.4, lbpRate: 89_700, transactions: [KETTLE, BISTRO], goals: [{ id: "g1", name: "Lisbon trip", emoji: "✈️", targetAmount: 1800, currentAmount: 0, currency: "USD" }] as unknown as LocalFinancials["goals"] });
    const r = await fetchAndMerge("u1@example.com", () => laptop({ transactions: [KETTLE, BISTRO] }));
    if (!r.ok || r.skipped) throw new Error("expected a merge");
    expect(r.mergedData.income).toBe(3150.75);
    expect(r.mergedData.goals).toEqual([]);
    expect(r.localChanged).toBe(false);
    expect(r.serverBehind).toBe(false);
  });

  // The merge's union can come back in a different order from either copy.
  // Order alone is not a change: counted as one, every fetch would rewrite
  // this device's storage, and push.
  it("the same records in a different order are no change, either way", async () => {
    const lamp = { id: "w1", name: "Quartz lamp", emoji: "✨", price: 64.2, currency: "USD" as const, priority: "medium" as const, createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z" };
    const easel = { ...lamp, id: "w2", name: "Velvet easel", price: 118.75 };
    serverData = laptop({ transactions: [BISTRO, KETTLE], wishlist: [easel, lamp] });
    const r = await fetchAndMerge("u1@example.com", () => laptop({ transactions: [KETTLE, BISTRO], wishlist: [lamp, easel] }));
    if (!r.ok || r.skipped) throw new Error("expected a merge");
    expect(r.localChanged).toBe(false);
    expect(r.serverBehind).toBe(false);
  });

  it("something only this device has calls for a push", async () => {
    serverData = laptop({ transactions: [BISTRO] });
    const r = await fetchAndMerge("u1@example.com", () => laptop({ transactions: [KETTLE, BISTRO] }));
    if (!r.ok || r.skipped) throw new Error("expected a merge");
    expect(r.localChanged).toBe(false);
    expect(r.serverBehind).toBe(true);
  });

  it("a deletion made here and not yet pushed calls for a push", async () => {
    serverData = laptop({ wishlist: [{ id: "w1", name: "Quartz lamp", emoji: "✨", price: 64.2, currency: "USD", priority: "medium", createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z" }] });
    const local = laptop({ wishlist: [], deletedKeys: { wishlist: [{ key: "w1", deletedAt: "2026-10-07T08:00:00.000Z" }] } });
    const r = await fetchAndMerge("u1@example.com", () => local);
    if (!r.ok || r.skipped) throw new Error("expected a merge");
    expect(r.mergedData.wishlist).toEqual([]);
    expect(r.serverBehind).toBe(true);
  });

  it("no server copy: says so, separately from a failure", async () => {
    respond = () => new Response(JSON.stringify({ error: "No data for this account." }), { status: 404 });
    const r = await fetchAndMerge("u1@example.com", () => laptop());
    expect(r).toMatchObject({ ok: false, notFound: true });
  });

  it("server unreachable: a failure, and the sync time untouched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const r = await fetchAndMerge("u1@example.com", () => laptop());
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("notFound");
    expect(localStorage.getItem(LAST_SYNC)).toBe("2026-10-05T08:00:00.000Z");
  });

  // The page labels both of these "Couldn't reach backup" (unless the device
  // is offline): neither may come back looking like "no copy".
  it("a server error: a failure, not 'no copy'", async () => {
    respond = () => new Response("<html>Bad gateway</html>", { status: 502 });
    const r = await fetchAndMerge("u1@example.com", () => laptop());
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("notFound");
  });

  it("the 45 s wait running out: a failure, not 'no copy'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }));
    const r = await fetchAndMerge("u1@example.com", () => laptop());
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("notFound");
  });

  it("nothing local any more when the pull lands (signed out meanwhile): skipped", async () => {
    const r = await fetchAndMerge("u1@example.com", () => null);
    expect(r).toEqual({ ok: true, skipped: true });
  });

  // Render's free tier can take 30 s or more to wake. The background fetch
  // waits longer than an upload's 15 s, so the first open after a quiet spell
  // isn't a guaranteed failure.
  it("waits up to 45 s for a sleeping server", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await fetchAndMerge("u1@example.com", () => laptop());
    expect(timeout).toHaveBeenCalledWith(45_000);
  });

  it("a close replaced by the other device's earlier one is reported", async () => {
    const close = (closedAt: string) => ({
      cycleKey: "2026-08", rangeStart: "2026-08-27", rangeEnd: "2026-09-26", startDayAtClose: 27, closedAt, accounts: [],
    }) as unknown as NonNullable<LocalFinancials["periodCloses"]>[number];
    serverData = laptop({ cycleStartDay: 27, periodCloses: [close("2026-09-27T08:00:00.000Z")] });
    const r = await fetchAndMerge("u1@example.com", () => laptop({ cycleStartDay: 27, periodCloses: [close("2026-09-28T10:30:00.000Z")] }));
    if (!r.ok || r.skipped) throw new Error("expected a merge");
    expect(r.replacedCloses).toEqual([{ cycleLabel: "27 Aug – 26 Sep 2026", standingClosedAt: "2026-09-27T08:00:00.000Z" }]);
    expect(r.localChanged).toBe(true);
  });
});
