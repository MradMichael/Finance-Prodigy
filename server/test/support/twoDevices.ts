/**
 * Session 38 (owner, "sync proof"): two devices of one account, each with its
 * own browser storage, running the CLIENT's own sync code (client/lib) against
 * the REAL server app (createApp: every route, check and limiter as deployed)
 * on this suite's in-memory store (fakePrisma, behind setup.ts's isolation).
 *
 * The client code reads `localStorage` and `sessionStorage` when it runs, so a
 * device puts its own two stores in place before each step it takes; steps
 * never overlap. Relative `/api/...` requests go to the app on a local port,
 * a fresh app per request, so no rate limiter carries from one step to the
 * next (the same reason test/support/http.ts makes one per request).
 *
 * `sync()` and `open()` are the app's own two sequences, step for step, from
 * client/app/page.tsx: `autoSync` after an edit, and `runFetch` when ESSA
 * opens or comes back into view. Each returns the notice text that sequence
 * builds (empty when there's nothing to say), which is how a device is "told".
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../../src/app";
import { signUp, signIn, getSession } from "../../../client/lib/auth";
import { loadData, saveData, syncAllowed, type LocalFinancials } from "../../../client/lib/localData";
import {
  applyBackupChoice, pushToServer, pullFromServer, mergeAndPush, recordMergeStored, fetchAndMerge, buildMergeNoticeText,
} from "../../../client/lib/syncService";
import { saveSeen } from "../../../client/lib/syncSeen";
import { takeUnseenClashes } from "../../../client/lib/clashNotice";

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

/** Starts the real app on a local port and points the client's relative requests at it. */
export async function startServer(): Promise<{ stop: () => Promise<void> }> {
  const server = http.createServer((req, res) => createApp()(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(typeof input === "string" && input.startsWith("/") ? base + input : input, init)) as typeof fetch;
  const g = globalThis as Record<string, unknown>;
  const hadWindow = "window" in g;
  if (!hadWindow) g.window = globalThis; // the client checks `typeof window` before touching storage
  return {
    stop: async () => {
      globalThis.fetch = realFetch;
      if (!hadWindow) delete g.window;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export class Device {
  readonly local = new MemoryStorage();
  readonly session = new MemoryStorage();
  /** Every confirm() the client asked on this device (none is expected in these flows). */
  readonly prompts: string[] = [];
  userId = "";

  constructor(readonly name: string, readonly email: string) {}

  private use() {
    const g = globalThis as Record<string, unknown>;
    g.localStorage = this.local;
    g.sessionStorage = this.session;
    g.confirm = (msg: string) => { this.prompts.push(msg); return false; };
  }

  /**
   * The sign-up page: create the account, sign in, make the person's first
   * entries (`first`), then turn backup on (its first upload).
   */
  async signUpAndBackUp(password: string, first: (d: LocalFinancials) => LocalFinancials = (d) => d): Promise<void> {
    this.use();
    const reg = await signUp(this.email, this.name, password);
    if (!reg.ok) throw new Error(`${this.name}: sign-up refused: ${reg.error}`);
    const login = await signIn(this.email, password);
    if (!login.ok) throw new Error(`${this.name}: sign-in refused: ${login.error}`);
    this.userId = login.session.userId;
    const { data, result } = await applyBackupChoice(this.email, first(await loadData(this.userId)), "on");
    if (!result?.ok) throw new Error(`${this.name}: first backup refused: ${result?.error}`);
    await saveData(data, this.userId);
  }

  /** A second device: sign in with the same password; it takes the account's copy from the server. */
  async signInElsewhere(password: string): Promise<void> {
    this.use();
    const login = await signIn(this.email, password);
    if (!login.ok) throw new Error(`${this.name}: sign-in refused: ${login.error}`);
    this.userId = login.session.userId;
  }

  async data(): Promise<LocalFinancials> {
    this.use();
    return loadData(this.userId);
  }

  /** The account's copy on the server, as this device would pull it. */
  async serverCopy(): Promise<LocalFinancials> {
    this.use();
    const r = await pullFromServer(getSession()!.email);
    if (!r.ok) throw new Error(`${this.name}: pull failed: ${r.error}`);
    return r.data;
  }

  /** A person's change on this device, stored the way the app stores it. Not synced until sync(). */
  async edit(change: (d: LocalFinancials) => LocalFinancials): Promise<void> {
    this.use();
    await saveData(change(await loadData(this.userId)), this.userId);
  }

  /** page.tsx's autoSync, after an edit: push this device's copy. */
  async sync(): Promise<string> {
    this.use();
    return this.autoSync(await loadData(this.userId));
  }

  /** autoSync(data): push; when the server has moved on, merge, store, record the sync, and tell. */
  private async autoSync(data: LocalFinancials): Promise<string> {
    const email = getSession()!.email;
    if (!syncAllowed(data)) throw new Error(`${this.name}: backup is off`);
    const result = await pushToServer(email, data);
    if (result.ok) return "";
    if (!result.conflict) throw new Error(`${this.name}: push failed: ${result.error}`);
    const merged = await mergeAndPush(email, data);
    if (!merged.ok) throw new Error(`${this.name}: merge failed: ${merged.error}`);
    await saveData(merged.mergedData, this.userId);
    await recordMergeStored(this.userId, merged);
    const named = await takeUnseenClashes(this.userId, merged.mergedData, undefined, { firstSync: merged.firstSync });
    return buildMergeNoticeText(merged.addedFromServer, merged.conflictDetails, named, merged.replacedCloses, merged.nonTransactionDivergence ?? [], merged.closedEdits ?? [], merged.resetElsewhere).text;
  }

  /**
   * page.tsx's runFetch, when ESSA opens or comes back into view: fetch and
   * merge, store when it brought something, record the fetched copy, push when
   * the server is behind, then tell what this device hasn't shown.
   */
  async open(): Promise<string> {
    this.use();
    const email = getSession()!.email;
    const current = await loadData(this.userId); // financialsRef.current: nothing is edited while the pull is out
    const r = await fetchAndMerge(email, () => current);
    if (!r.ok) throw new Error(`${this.name}: fetch failed: ${r.error ?? "newer version"}`);
    if (r.skipped) return "";
    if (r.localChanged) await saveData(r.mergedData, this.userId);
    await saveSeen(this.userId, r.serverCopy);
    const pushed = r.serverBehind ? await this.autoSync(r.mergedData) : "";
    const named = await takeUnseenClashes(this.userId, r.mergedData, undefined, { firstSync: r.firstSync });
    const told = buildMergeNoticeText(r.addedFromServer, r.conflictDetails, named, r.replacedCloses, r.nonTransactionDivergence ?? [], r.closedEdits ?? [], r.resetElsewhere).text;
    return [pushed, told].filter(Boolean).join("\n");
  }
}
