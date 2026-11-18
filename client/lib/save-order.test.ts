// Item 8a (owner, session 56): saves are written in the order they were asked for. Each save encrypts the whole
// copy with Web Crypto, which runs each call "in parallel" and promises no order between two, and then writes it.
// Two saves in flight wrote whichever finished last: if the newer one's encryption finished first, the older copy
// landed last and stayed on disk. (Edge kept the order in 30 of 30 tries, session 56's live check; the code relied
// on it without the spec promising it.) Now one write at a time per account: a save asked for while another runs
// waits, only the latest waiting copy is written, and the saves it replaced settle with its outcome.
// Here the real AES-GCM runs with a real session key, and each call's answer is held back and released by hand,
// newest first: the order that broke it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { saveData, DEFAULT_DATA, type LocalFinancials } from "./localData";
import { activateSessionKey, decryptJSON } from "./crypto";

type Held = { income: number; release: () => void; fail: (e: unknown) => void };
const held: Held[] = [];
const realEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);

beforeEach(() => {
  held.length = 0;
  localStorage.clear(); sessionStorage.clear();
  activateSessionKey(new Uint8Array(32).fill(7));
  vi.spyOn(crypto.subtle, "encrypt").mockImplementation((alg, key, data) => {
    const income = (JSON.parse(new TextDecoder().decode(data as Uint8Array)) as LocalFinancials).income;
    return new Promise<ArrayBuffer>((resolve, reject) => {
      held.push({ income, release: () => { void realEncrypt(alg, key, data).then(resolve, reject); }, fail: reject });
    });
  });
});
afterEach(() => { vi.restoreAllMocks(); });

const copy = (income: number) => ({ ...DEFAULT_DATA, income }) as LocalFinancials;
async function stored(user = "u1"): Promise<number | null> {
  const raw = localStorage.getItem(`essa_data_${user}`);
  return raw ? (JSON.parse(await decryptJSON(raw)) as LocalFinancials).income : null;
}
const wait = async (ms = 20) => { await new Promise((r) => setTimeout(r, ms)); };
/** Releases every held encryption, the newest first, until nothing more is asked for. */
async function releaseNewestFirst() {
  for (let guard = 0; guard < 20; guard++) {
    await wait();
    if (!held.length) return;
    while (held.length) { held.pop()!.release(); await wait(); }
  }
}
/** Its outcome as text, the handler attached at once (a failure is never left unhandled). */
const settled = (p: Promise<unknown>) => p.then(() => "ok", (e) => `failed: ${(e as Error).message}`);
const incomes = () => held.map((h) => h.income);

describe("saves are written in the order asked", () => {
  it("two quick saves, the newer one's encryption finishing first: the newer copy is what stays", async () => {
    const a = settled(saveData(copy(1), "u1"));
    const b = settled(saveData(copy(2), "u1"));
    await releaseNewestFirst();
    expect(await Promise.all([a, b])).toEqual(["ok", "ok"]);
    expect(await stored()).toBe(2);
  });

  it("three quick saves while the first is encrypting: the middle one is never written, and every caller settles", async () => {
    const a = settled(saveData(copy(1), "u1"));
    await wait();
    const b = settled(saveData(copy(2), "u1"));
    const c = settled(saveData(copy(3), "u1"));
    await wait();
    expect(incomes()).toEqual([1]); // one at a time
    held.shift()!.release();
    await wait(50);
    expect(incomes()).toEqual([3]); // the latest waiting copy, not 2
    held.shift()!.release();
    expect(await Promise.all([a, b, c])).toEqual(["ok", "ok", "ok"]);
    expect(await stored()).toBe(3);
  });

  it("a replaced save doesn't report success before the copy that replaced it is stored", async () => {
    const a = saveData(copy(1), "u1");
    await wait();
    let bDone = false;
    const b = saveData(copy(2), "u1").then(() => { bDone = true; });
    const c = saveData(copy(3), "u1");
    held.shift()!.release();
    await a;
    await wait(50);
    expect(bDone).toBe(false);
    await releaseNewestFirst();
    await Promise.all([b, c]);
    expect(bDone).toBe(true);
  });

  it("a failure reaches every save it covered, and the copy before it stays", async () => {
    const a = settled(saveData(copy(1), "u1"));
    await wait();
    const b = settled(saveData(copy(2), "u1"));
    const c = settled(saveData(copy(3), "u1"));
    held.shift()!.release();
    await wait(50);
    held.shift()!.fail(new Error("refused")); // the next encryption asked for
    await releaseNewestFirst(); // anything still held finishes (none should be)
    expect(await Promise.all([a, b, c])).toEqual(["ok", "failed: refused", "failed: refused"]);
    expect(await stored()).toBe(1);
  });

  it("after a failure the next save is written as usual", async () => {
    const a = settled(saveData(copy(1), "u1"));
    await wait();
    held.shift()!.fail(new Error("refused"));
    expect(await a).toBe("failed: refused");
    const b = settled(saveData(copy(2), "u1"));
    await releaseNewestFirst();
    expect(await b).toBe("ok");
    expect(await stored()).toBe(2);
  });

  it("two accounts don't wait on each other", async () => {
    const a = settled(saveData(copy(1), "u1"));
    const b = settled(saveData(copy(7), "u2"));
    await wait();
    expect(incomes().sort()).toEqual([1, 7]);
    await releaseNewestFirst();
    expect(await Promise.all([a, b])).toEqual(["ok", "ok"]);
    expect([await stored("u1"), await stored("u2")]).toEqual([1, 7]);
  });
});
