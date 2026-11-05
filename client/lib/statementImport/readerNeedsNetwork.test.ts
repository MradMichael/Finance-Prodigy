// PWA P3 (owner-approved, 2026-11-05): reading a statement needs pdf.js's worker, which the service worker saves
// only on its first use and drops at every update (sw-template.js: each build has its own runtime cache).
// Found in the browser: offline with the worker not saved, the import blamed the file. "Needs the network" is
// exactly: the browser says it's offline AND the worker isn't in this site's caches.
import { it, expect, afterEach, vi } from "vitest";
import { readerNeedsNetwork, PDF_WORKER_URL } from "./pdfText";

let online = true;
Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
afterEach(() => { online = true; vi.unstubAllGlobals(); });
const cachesHolding = (hit: boolean) => vi.stubGlobal("caches", { match: vi.fn(async (u: string) => (hit && u === PDF_WORKER_URL ? new Response("") : undefined)) });

it("the worker's address is the one pdf.js is pointed at", () => {
  expect(PDF_WORKER_URL).toBe("/pdf.worker.min.mjs");
});

it("online: never, whatever is saved", async () => {
  cachesHolding(false);
  expect(await readerNeedsNetwork()).toBe(false);
});

it("offline with the worker saved: no, it can read offline", async () => {
  online = false;
  cachesHolding(true);
  expect(await readerNeedsNetwork()).toBe(false);
});

it("offline without the worker saved: yes", async () => {
  online = false;
  cachesHolding(false);
  expect(await readerNeedsNetwork()).toBe(true);
});

it("offline in a browser without Cache Storage, or one that refuses it: yes", async () => {
  online = false;
  vi.stubGlobal("caches", undefined);
  expect(await readerNeedsNetwork()).toBe(true);
  vi.stubGlobal("caches", { match: vi.fn(async () => { throw new Error("SecurityError"); }) });
  expect(await readerNeedsNetwork()).toBe(true);
});
