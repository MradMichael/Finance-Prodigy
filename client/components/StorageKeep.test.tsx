// PWA P3 (owner-approved wording and design, 2026-11-05): Profile says what this browser reports about keeping
// ESSA's data when space runs low (navigator.storage.persisted()), and asks it to keep it (persist()) only when
// the person presses the button -- never on its own, since Firefox answers persist() with a permission prompt.
// Each line reports the browser's own answer; none promises more.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import StorageKeep, { STORAGE_HEADING, STORAGE_KEPT, STORAGE_NOT_YET, STORAGE_DECLINED, STORAGE_UNSUPPORTED, STORAGE_ASK } from "./StorageKeep";
import { ThemeProvider } from "../contexts/ThemeContext";

const original = Object.getOwnPropertyDescriptor(navigator, "storage");
function browserStorage(s: unknown) { Object.defineProperty(navigator, "storage", { configurable: true, value: s }); }
afterEach(() => {
  cleanup();
  if (original) Object.defineProperty(navigator, "storage", original); else delete (navigator as { storage?: unknown }).storage;
});
const show = () => render(<ThemeProvider><StorageKeep /></ThemeProvider>);

it("the wording, verbatim", () => {
  expect(STORAGE_HEADING).toBe("Storage on this device");
  expect(STORAGE_KEPT).toBe("Your browser has agreed to keep ESSA's data on this device even when space runs low. Clearing site data or uninstalling still removes it.");
  expect(STORAGE_NOT_YET).toBe("This browser may clear ESSA's data from this device if it runs low on space. Keeping backup on, or downloading your data, is what protects it.");
  expect(STORAGE_DECLINED).toBe("This browser said no. It may still clear ESSA's data if it runs low on space. Keeping backup on, or downloading your data, is what protects it.");
  expect(STORAGE_UNSUPPORTED).toBe("This browser doesn't say whether it keeps ESSA's data. Keeping backup on, or downloading your data, is what protects it.");
  expect(STORAGE_ASK).toBe("Ask this browser to keep it");
});

it("already kept: says so, with no button", async () => {
  const persist = vi.fn();
  browserStorage({ persisted: vi.fn(async () => true), persist });
  show();
  expect(await screen.findByText(STORAGE_KEPT)).toBeTruthy();
  expect(screen.queryByRole("button", { name: STORAGE_ASK })).toBeNull();
  expect(persist).not.toHaveBeenCalled();
});

it("not kept: says so and offers the button, without asking on its own", async () => {
  const persist = vi.fn(async () => true);
  browserStorage({ persisted: vi.fn(async () => false), persist });
  show();
  expect(await screen.findByText(STORAGE_NOT_YET)).toBeTruthy();
  await new Promise((r) => setTimeout(r, 50));
  expect(persist).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: STORAGE_ASK })).toBeTruthy();
});

it("the button asks once; a yes reads as kept", async () => {
  const persist = vi.fn(async () => true);
  browserStorage({ persisted: vi.fn(async () => false), persist });
  show();
  fireEvent.click(await screen.findByRole("button", { name: STORAGE_ASK }));
  expect(await screen.findByText(STORAGE_KEPT)).toBeTruthy();
  expect(persist).toHaveBeenCalledTimes(1);
});

it("the button asks; a no reads as declined, with no button", async () => {
  browserStorage({ persisted: vi.fn(async () => false), persist: vi.fn(async () => false) });
  show();
  fireEvent.click(await screen.findByRole("button", { name: STORAGE_ASK }));
  expect(await screen.findByText(STORAGE_DECLINED)).toBeTruthy();
  expect(screen.queryByRole("button", { name: STORAGE_ASK })).toBeNull();
});

it("a browser without the API, or one that fails to answer, reads as unsupported", async () => {
  browserStorage(undefined);
  show();
  expect(await screen.findByText(STORAGE_UNSUPPORTED)).toBeTruthy();
  cleanup();
  browserStorage({ persisted: vi.fn(async () => { throw new Error("no"); }), persist: vi.fn() });
  show();
  expect(await screen.findByText(STORAGE_UNSUPPORTED)).toBeTruthy();
  cleanup();
  browserStorage({ persisted: vi.fn(async () => false), persist: vi.fn(async () => { throw new Error("no"); }) });
  show();
  fireEvent.click(await screen.findByRole("button", { name: STORAGE_ASK }));
  expect(await screen.findByText(STORAGE_UNSUPPORTED)).toBeTruthy();
});
