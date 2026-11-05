// PWA P5 (owner-approved wording, 2026-11-05): Profile shows which version this device is running (asked of
// the active service worker: commit and build) and checks for a newer one on request. "You have the latest
// version" only when the browser fetched the worker and found nothing new; a new one found says where the
// Reload prompt is (UpdateNotice); offline says so without trying.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import VersionCheck, { versionLine, VERSION_UNAVAILABLE, CHECK_FOR_UPDATES, CHECKING, UP_TO_DATE, DOWNLOADING, READY, CHECK_OFFLINE, CHECK_FAILED } from "./VersionCheck";
import { ThemeProvider } from "../contexts/ThemeContext";

let online = true;
Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
const original = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
afterEach(() => {
  cleanup(); online = true;
  if (original) Object.defineProperty(navigator, "serviceWorker", original); else delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

type Reg = { active: { postMessage: (m: unknown, ports: MessagePort[]) => void } | null; waiting: object | null; installing: object | null; update: () => Promise<unknown> };
function worker(reply: { build: string; commit: string | null } | null, over: Partial<Reg> = {}) {
  const reg: Reg = {
    active: { postMessage: (m, ports) => { if (reply && (m as { type?: string }).type === "VERSION") ports[0].postMessage(reply); } },
    waiting: null, installing: null, update: vi.fn(async () => reg), ...over,
  };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve(reg) } });
  return reg;
}
const show = () => render(<ThemeProvider><VersionCheck /></ThemeProvider>);

it("the wording, verbatim", () => {
  expect(versionLine({ build: "KfybncMpfAH02yqFTO_v6", commit: "2448033" })).toBe("Version 2448033 (build KfybncMp)");
  expect(versionLine({ build: "KfybncMpfAH02yqFTO_v6", commit: null })).toBe("Version: build KfybncMp");
  expect(VERSION_UNAVAILABLE).toBe("Version not available in this browser.");
  expect(CHECK_FOR_UPDATES).toBe("Check for updates");
  expect(CHECKING).toBe("Checking…");
  expect(UP_TO_DATE).toBe("You have the latest version.");
  expect(DOWNLOADING).toBe("A new version is downloading. You'll see a Reload prompt when it's ready.");
  expect(READY).toBe("A new version is ready. Use Reload at the bottom of the screen.");
  expect(CHECK_OFFLINE).toBe("Couldn't check for updates: you're offline.");
  expect(CHECK_FAILED).toBe("Couldn't check for updates. Try again in a minute.");
});

it("shows the running worker's commit and build", async () => {
  worker({ build: "KfybncMpfAH02yqFTO_v6", commit: "2448033" });
  show();
  expect(await screen.findByText("Version 2448033 (build KfybncMp)")).toBeTruthy();
});

it("no service worker: says the version isn't available, and offers no check", async () => {
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  show();
  expect(await screen.findByText(VERSION_UNAVAILABLE)).toBeTruthy();
  expect(screen.queryByRole("button", { name: CHECK_FOR_UPDATES })).toBeNull();
});

it("a worker that doesn't answer (an older build) reads as unavailable, but can still check", async () => {
  worker(null);
  show();
  expect(await screen.findByText(VERSION_UNAVAILABLE, {}, { timeout: 4000 })).toBeTruthy();
  expect(screen.getByRole("button", { name: CHECK_FOR_UPDATES })).toBeTruthy();
});

it("nothing new: the latest version", async () => {
  const reg = worker({ build: "b1", commit: null });
  show();
  fireEvent.click(await screen.findByRole("button", { name: CHECK_FOR_UPDATES }));
  expect(await screen.findByText(UP_TO_DATE)).toBeTruthy();
  expect(reg.update).toHaveBeenCalledTimes(1);
});

it("says Checking… while the browser fetches", async () => {
  let finish!: () => void;
  worker({ build: "b1", commit: null }, { update: () => new Promise((r) => { finish = () => r(undefined); }) });
  show();
  fireEvent.click(await screen.findByRole("button", { name: CHECK_FOR_UPDATES }));
  expect(await screen.findByText(CHECKING)).toBeTruthy();
  finish();
  expect(await screen.findByText(UP_TO_DATE)).toBeTruthy();
});

it("a new version found: downloading, or ready with the Reload prompt", async () => {
  const reg = worker({ build: "b1", commit: null });
  reg.update = vi.fn(async () => { reg.installing = {}; return reg; });
  show();
  fireEvent.click(await screen.findByRole("button", { name: CHECK_FOR_UPDATES }));
  expect(await screen.findByText(DOWNLOADING)).toBeTruthy();
  cleanup();
  const reg2 = worker({ build: "b1", commit: null });
  reg2.update = vi.fn(async () => { reg2.waiting = {}; return reg2; });
  show();
  fireEvent.click(await screen.findByRole("button", { name: CHECK_FOR_UPDATES }));
  expect(await screen.findByText(READY)).toBeTruthy();
});

it("offline: says so, without asking the browser", async () => {
  const reg = worker({ build: "b1", commit: null });
  show();
  const button = await screen.findByRole("button", { name: CHECK_FOR_UPDATES });
  online = false;
  fireEvent.click(button);
  expect(await screen.findByText(CHECK_OFFLINE)).toBeTruthy();
  expect(reg.update).not.toHaveBeenCalled();
});

it("a check that fails: offline if the connection went, otherwise try again", async () => {
  const reg = worker({ build: "b1", commit: null }, { update: vi.fn(async () => { throw new TypeError("Failed to update"); }) });
  show();
  fireEvent.click(await screen.findByRole("button", { name: CHECK_FOR_UPDATES }));
  expect(await screen.findByText(CHECK_FAILED)).toBeTruthy();
  reg.update = vi.fn(async () => { online = false; throw new TypeError("Failed to update"); });
  fireEvent.click(screen.getByRole("button", { name: CHECK_FOR_UPDATES }));
  expect(await screen.findByText(CHECK_OFFLINE)).toBeTruthy();
});
