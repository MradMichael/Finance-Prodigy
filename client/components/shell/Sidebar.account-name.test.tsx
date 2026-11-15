// Session 53 (owner): the sidebar's account button. Collapsed, it shows only the initials, and its name
// ("{name}: account settings") didn't hold them: WCAG 2.5.3, found by axe at 1280. Collapsed it is now named
// "{initials}, account settings"; expanded, where the name is on the button, it keeps "{name}: account settings".
// Session 54 (owner): expanded, it is named "{initials}, {name}: account settings", and the email (or the sync
// status) line sits under the button instead of inside it. The checker (axe 4.14, label-content-name-mismatch)
// compares the name with every visible word inside the button, in order, so the email inside it kept the
// expanded button flagged; and the initials and the name need a space between them, or it reads one word.
import { it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import Sidebar from "./Sidebar";
import { ThemeProvider } from "../../contexts/ThemeContext";
import type { Session } from "../../lib/auth";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const SESSION = { userId: "u1", email: "u1@example.com", name: "Quartz Lantern" } as Session;
const show = (session: Session = SESSION) =>
  render(<ThemeProvider><Sidebar screen="overview" setScreen={vi.fn()} session={session} onProfile={vi.fn()} syncStatus="idle" /></ThemeProvider>);
const accountButton = () => document.querySelector("button[data-sync-status]") as HTMLButtonElement;
/** The checker's test: the button's visible words, in order, are a run of the name's words. */
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
const nameHoldsVisibleText = (b: HTMLElement) => {
  const name = words(b.getAttribute("aria-label")!), shown = words(b.textContent!);
  return shown.length > 0 && name.some((_, i) => shown.every((w, j) => name[i + j] === w));
};

it("collapsed, it shows the initials and is named \"{initials}, account settings\"", () => {
  show();
  const b = accountButton();
  expect(b.textContent).toBe("QL");
  expect(b.getAttribute("aria-label")).toBe("QL, account settings");
  expect(b.getAttribute("aria-label")!.startsWith(b.textContent!)).toBe(true);
});

it("expanded (pinned, or with focus inside), it is named \"{initials}, {name}: account settings\"", () => {
  localStorage.setItem("essa_sidebar_pinned", "1");
  show();
  expect(accountButton().getAttribute("aria-label")).toBe("QL, Quartz Lantern: account settings");
  cleanup(); localStorage.clear();
  show();
  fireEvent.focus(accountButton());
  expect(accountButton().getAttribute("aria-label")).toBe("QL, Quartz Lantern: account settings");
  expect(screen.getByText("Quartz Lantern")).toBeTruthy();
});

it("expanded, the button shows the initials and the name only, and its name holds them word for word", () => {
  localStorage.setItem("essa_sidebar_pinned", "1");
  show();
  const b = accountButton();
  expect(words(b.textContent!)).toEqual(["ql", "quartz", "lantern"]);
  expect(nameHoldsVisibleText(b)).toBe(true);
});

it("expanded, the email sits under the button, outside it; while syncing, the sync status does", () => {
  localStorage.setItem("essa_sidebar_pinned", "1");
  show();
  const email = screen.getByText("u1@example.com");
  expect(accountButton().contains(email)).toBe(false);
  expect(accountButton().compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  cleanup();
  render(<ThemeProvider><Sidebar screen="overview" setScreen={vi.fn()} session={SESSION} onProfile={vi.fn()} syncStatus="syncing" /></ThemeProvider>);
  expect(screen.queryByText("u1@example.com")).toBeNull();
  expect(accountButton().textContent).not.toMatch(/sync/i);
  expect(nameHoldsVisibleText(accountButton())).toBe(true);
});

it("collapsed, the email isn't shown at all", () => {
  show();
  expect(screen.queryByText("u1@example.com")).toBeNull();
});

it("expanded with no initials to show, it keeps the name form", () => {
  localStorage.setItem("essa_sidebar_pinned", "1");
  show({ ...SESSION, name: "" } as Session);
  expect(accountButton().getAttribute("aria-label")).toBe(": account settings");
});

it("collapsed with no initials to show, it keeps the name form", () => {
  show({ ...SESSION, name: "" } as Session);
  expect(accountButton().getAttribute("aria-label")).toBe(": account settings");
});
