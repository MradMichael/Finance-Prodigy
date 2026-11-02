// Owner, session 34 (decision 26; the sentence and "Reload" approved): when a new build's worker is waiting and
// this page is controlled by the old one, the app says so. Reload asks the waiting worker to take over, and the
// page reloads once it has. A first install (no controller yet) shows nothing, and never reloads the page.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import UpdateNotice from "./UpdateNotice";
import { ThemeProvider } from "../contexts/ThemeContext";

const SENTENCE = "A new version of ESSA is ready. Reload to use it.";
let swListeners: Record<string, (() => void)[]>;
let reload: ReturnType<typeof vi.fn>;

function fakeWorker({ waiting, controller }: { waiting: boolean; controller: boolean }) {
  swListeners = {};
  const waitingWorker = waiting ? { postMessage: vi.fn(), state: "installed" } : null;
  const reg = { waiting: waitingWorker, installing: null, addEventListener: vi.fn(), update: vi.fn(async () => {}) };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      controller: controller ? {} : null,
      ready: Promise.resolve(reg),
      getRegistration: vi.fn(async () => reg),
      addEventListener: (t: string, fn: () => void) => { (swListeners[t] ??= []).push(fn); },
      removeEventListener: vi.fn(),
    },
  });
  return { reg, waitingWorker };
}

beforeEach(() => {
  reload = vi.fn();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const show = async () => { render(<ThemeProvider><UpdateNotice /></ThemeProvider>); await act(async () => {}); };

it("a waiting worker on a controlled page: the sentence and Reload", async () => {
  fakeWorker({ waiting: true, controller: true });
  await show();
  expect(screen.getByText(SENTENCE)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
});

it("Reload asks the waiting worker to take over, then reloads once it has", async () => {
  const { waitingWorker } = fakeWorker({ waiting: true, controller: true });
  await show();
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(waitingWorker!.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  expect(reload).not.toHaveBeenCalled();
  act(() => { for (const fn of swListeners.controllerchange ?? []) fn(); });
  expect(reload).toHaveBeenCalledTimes(1);
});

it("a first install (no controller yet) shows nothing, and taking control doesn't reload the page", async () => {
  fakeWorker({ waiting: true, controller: false });
  await show();
  expect(screen.queryByText(SENTENCE)).toBeNull();
  act(() => { for (const fn of swListeners.controllerchange ?? []) fn(); });
  expect(reload).not.toHaveBeenCalled();
});

it("nothing waiting: nothing shown", async () => {
  fakeWorker({ waiting: false, controller: true });
  await show();
  expect(screen.queryByText(SENTENCE)).toBeNull();
});
