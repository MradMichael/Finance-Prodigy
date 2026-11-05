// A1 (app readiness; wording approved by the owner, 2026-11-05). The sign-in page's small print said
// "Your data is stored privately in your browser. Connect a database to sync across devices." The second
// sentence was addressed to a developer, and neither said that backup is opt-in or that the server copy
// can be read by the server (the Privacy page says both). It now says both, in the owner's words, with a
// link to the Privacy page.
//
// Owner's decisions (2026-11-05, later round): the note matches the sign-up page's caveat, at the same
// size (text-xs) in the main text colour, not muted; and the link is a block on its own line with a tap
// area at least 44 px tall. Compared against the rendered sign-up caveat, not a copy of its classes, so
// the two can't drift apart. Measured live at 375 px too: jsdom does no layout.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("../../lib/auth", () => ({
  getSession: () => null,
  signIn: vi.fn(),
  updateDevicePassword: vi.fn(),
  restartDeviceFromServer: vi.fn(),
  signUp: vi.fn(),
}));
vi.mock("../../lib/syncService", () => ({ checkEmailExists: vi.fn(async () => false), markAutoPulled: vi.fn() }));

import SignInPage from "./page";
import SignUpPage from "../sign-up/page";
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

/** The <p> whose text includes `fragment`, after rendering `page`. */
function paragraphWith(page: React.ReactElement, fragment: string): HTMLParagraphElement {
  const { container } = render(<ThemeProvider>{page}</ThemeProvider>);
  const p = [...container.querySelectorAll("p")].find((el) => (el.textContent ?? "").replace(/\s+/g, " ").includes(fragment));
  if (!p) throw new Error(`no paragraph with "${fragment}"`);
  return p as HTMLParagraphElement;
}

it("is the same size and colour as the sign-up page's caveat, not muted small print", () => {
  const signUp = paragraphWith(<SignUpPage />, "the server can read it");
  const signUpColour = signUp.style.color;
  const signUpMuted = paragraphWith(<SignUpPage />, "By creating an account").style.color;
  cleanup();
  const signIn = paragraphWith(<SignInPage />, "the server can read it");
  expect(signIn.className).toContain("text-xs");
  expect(signIn.className).not.toContain("text-[10px]");
  expect(signIn.style.color).toBe(signUpColour);
  expect(signIn.style.color).not.toBe(signUpMuted);
});

it("puts 'How your data is stored' on its own line, at least 44 px tall to tap", () => {
  const caveat = paragraphWith(<SignInPage />, "the server can read it");
  const link = screen.getByRole("link", { name: "How your data is stored" });
  expect(caveat.contains(link)).toBe(false);
  expect(link.className).toMatch(/(^|\s)(block|flex)(\s|$)/);
  expect(parseFloat(link.style.minHeight)).toBeGreaterThanOrEqual(44);
});
