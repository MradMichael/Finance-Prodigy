// PWA P3 (owner-approved wording, 2026-11-05): what the home screen says while the device is offline.
// A ("...and back up when you reconnect") only when that is what will happen: backup on and not stopped
// (refused credentials, a newer backup elsewhere, too large to upload all stop the automatic retry that
// app/page.offline-edit-retry.test.tsx proves). Every other case gets B, which promises nothing.
import { it, expect, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import OfflineNotice, { OFFLINE_BACKS_UP, OFFLINE_SAVED_HERE, backupRetriesOnReconnect } from "./OfflineNotice";
import { ThemeProvider } from "../contexts/ThemeContext";

let online = true;
Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
afterEach(() => { cleanup(); online = true; });

it("the two sentences, verbatim", () => {
  expect(OFFLINE_BACKS_UP).toBe("You're offline. Changes are saved on this device and back up when you reconnect.");
  expect(OFFLINE_SAVED_HERE).toBe("You're offline. Changes are saved on this device.");
});

it("promises a backup only when backup is on and nothing has stopped it", () => {
  const on = { backupOn: true, syncRefused: false, newerBackup: false, backupTooLarge: false };
  expect(backupRetriesOnReconnect(on)).toBe(true);
  expect(backupRetriesOnReconnect({ ...on, backupOn: false })).toBe(false);
  expect(backupRetriesOnReconnect({ ...on, syncRefused: true })).toBe(false);
  expect(backupRetriesOnReconnect({ ...on, newerBackup: true })).toBe(false);
  expect(backupRetriesOnReconnect({ ...on, backupTooLarge: true })).toBe(false);
});

const show = (backsUp: boolean) => render(<ThemeProvider><OfflineNotice backsUp={backsUp} /></ThemeProvider>);

it("shows nothing while online", () => {
  show(true);
  expect(screen.queryByText(OFFLINE_BACKS_UP)).toBeNull();
  expect(screen.queryByText(OFFLINE_SAVED_HERE)).toBeNull();
});

it("offline, says the sentence it is given, as a status", () => {
  online = false;
  show(true);
  expect(screen.getByRole("status").textContent).toBe(OFFLINE_BACKS_UP);
  cleanup();
  show(false);
  expect(screen.getByRole("status").textContent).toBe(OFFLINE_SAVED_HERE);
});

it("appears when the connection drops and goes when it returns", () => {
  show(false);
  act(() => { online = false; window.dispatchEvent(new Event("offline")); });
  expect(screen.getByText(OFFLINE_SAVED_HERE)).toBeTruthy();
  act(() => { online = true; window.dispatchEvent(new Event("online")); });
  expect(screen.queryByText(OFFLINE_SAVED_HERE)).toBeNull();
});

it("sits in the page's flow, never over it", () => {
  online = false;
  show(false);
  expect(screen.getByRole("status").className).not.toMatch(/\b(fixed|absolute|sticky)\b/);
});
