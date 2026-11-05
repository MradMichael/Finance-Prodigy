// PWA P5 (owner-approved, 2026-11-05): the version a phone is running, so the owner can match it to the branch on
// GitHub. The build puts the deploy's commit (Vercel's VERCEL_GIT_COMMIT_SHA, shortened to 7) beside the build ID
// in the worker; the worker answers {type: "VERSION"} on the port it's given with both. A local build has no
// commit: null, never a guess. Anything that isn't a hex commit is dropped, so nothing else lands in the worker.
import { it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import vm from "vm";
import { buildManifest, renderWorker, shortCommit } from "./build-sw.mjs";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "essa-sw-v-"));
  fs.mkdirSync(path.join(root, ".next", "static"), { recursive: true });
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  fs.writeFileSync(path.join(root, ".next", "BUILD_ID"), "KfybncMpfAH02yqFTO_v6\n");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const dirs = () => ({ nextDir: path.join(root, ".next"), publicDir: path.join(root, "public") });

it("shortens a real commit to 7, and drops anything that isn't one", () => {
  expect(shortCommit("2448033a1b2c3d4e5f60718293a4b5c6d7e8f901")).toBe("2448033");
  expect(shortCommit(undefined)).toBeNull();
  expect(shortCommit("")).toBeNull();
  expect(shortCommit("main")).toBeNull();
  expect(shortCommit("abc")).toBeNull();
  expect(shortCommit('"});alert(1)//')).toBeNull();
});

it("the manifest carries the commit it's given, or null", () => {
  expect(buildManifest({ ...dirs(), commit: "2448033a1b2c3d4e5f60718293a4b5c6d7e8f901" }).commit).toBe("2448033");
  expect(buildManifest(dirs()).commit).toBeNull();
});

it("the build script reads Vercel's commit variable, and .env.example says so", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "sw", "build-sw.mjs"), "utf8");
  expect(src).toMatch(/commit: process\.env\.VERCEL_GIT_COMMIT_SHA/);
  expect(fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8")).toMatch(/^# ?VERCEL_GIT_COMMIT_SHA=/m);
});

function workerReplies(manifest: object, data: unknown) {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const self = { location: { origin: "https://essa.test" }, addEventListener: (t: string, fn: (e: unknown) => void) => { (listeners[t] ??= []).push(fn); }, skipWaiting: vi.fn() };
  vm.runInNewContext(renderWorker({ manifest: manifest as never, kill: false, templateDir: path.join(process.cwd(), "sw") }), { self, caches: {}, fetch: vi.fn(), Request: class {}, Response, URL, Promise });
  const port = { postMessage: vi.fn() };
  for (const fn of listeners.message ?? []) fn({ data, ports: [port] });
  return { port, self };
}

it("the worker answers VERSION on the port it's given, with its build and commit", () => {
  const { port, self } = workerReplies({ build: "b1", commit: "2448033", pages: [], files: [] }, { type: "VERSION" });
  expect(port.postMessage).toHaveBeenCalledWith({ build: "b1", commit: "2448033" });
  expect(self.skipWaiting).not.toHaveBeenCalled();
});

it("a worker built without a commit says null", () => {
  expect(workerReplies({ build: "b1", pages: [], files: [] }, { type: "VERSION" }).port.postMessage).toHaveBeenCalledWith({ build: "b1", commit: null });
});

it("other messages get no version reply", () => {
  expect(workerReplies({ build: "b1", commit: null, pages: [], files: [] }, { type: "SKIP_WAITING" }).port.postMessage).not.toHaveBeenCalled();
});
