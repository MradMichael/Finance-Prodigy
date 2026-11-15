// Session 53 (owner): the sidebar's account button. Collapsed, it shows only the initials, and its name
// ("{name}: account settings") didn't hold them: WCAG 2.5.3, found by axe at 1280. Collapsed it is now named
// "{initials}, account settings"; expanded, where the name is on the button, it keeps "{name}: account settings".
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

it("collapsed, it shows the initials and is named \"{initials}, account settings\"", () => {
  show();
  const b = accountButton();
  expect(b.textContent).toBe("QL");
  expect(b.getAttribute("aria-label")).toBe("QL, account settings");
  expect(b.getAttribute("aria-label")!.startsWith(b.textContent!)).toBe(true);
});

it("expanded (pinned, or with focus inside), it shows the name and keeps \"{name}: account settings\"", () => {
  localStorage.setItem("essa_sidebar_pinned", "1");
  show();
  expect(accountButton().textContent).toContain("Quartz Lantern");
  expect(accountButton().getAttribute("aria-label")).toBe("Quartz Lantern: account settings");
  cleanup(); localStorage.clear();
  show();
  fireEvent.focus(accountButton());
  expect(accountButton().getAttribute("aria-label")).toBe("Quartz Lantern: account settings");
  expect(screen.getByText("Quartz Lantern")).toBeTruthy();
});

it("collapsed with no initials to show, it keeps the name form", () => {
  show({ ...SESSION, name: "" } as Session);
  expect(accountButton().getAttribute("aria-label")).toBe(": account settings");
});
