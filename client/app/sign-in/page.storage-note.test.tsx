// A1 (app readiness; wording approved by the owner, 2026-11-05). The sign-in page's small print said
// "Your data is stored privately in your browser. Connect a database to sync across devices." The second
// sentence was addressed to a developer, and neither said that backup is opt-in or that the server copy
// can be read by the server (the Privacy page says both). It now says both, in the owner's words, with a
// link to the Privacy page.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("../../lib/auth", () => ({
  getSession: () => null,
  signIn: vi.fn(),
  updateDevicePassword: vi.fn(),
  restartDeviceFromServer: vi.fn(),
}));

import SignInPage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";

afterEach(cleanup);

const APPROVED =
  "Your data is encrypted and stored in this browser. It's copied to our server only if you turn on backup, and that copy isn't end-to-end encrypted: the server can read it.";

const text = () => {
  render(<ThemeProvider><SignInPage /></ThemeProvider>);
  return (document.body.textContent ?? "").replace(/\s+/g, " ");
};

it("says where the data is stored, in the approved words", () => {
  expect(text()).toContain(APPROVED);
});

it("no longer tells the user to connect a database", () => {
  expect(text()).not.toMatch(/connect a database/i);
});

it("links to the Privacy page as 'How your data is stored'", () => {
  render(<ThemeProvider><SignInPage /></ThemeProvider>);
  expect(screen.getByRole("link", { name: "How your data is stored" }).getAttribute("href")).toBe("/privacy");
});
