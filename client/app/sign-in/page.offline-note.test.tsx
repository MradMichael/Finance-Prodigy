// docs/plans/pwa.md, item 4: the sign-in offline note. Signing in works offline on a device that already has the
// account (the password unlocks it here); a new device needs a connection. While the browser says it's offline,
// the sign-in page says so above the form. It blocks nothing. Its wording (pwa.md) was approved by the owner
// (session 52).
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

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
import { ThemeProvider } from "../../contexts/ThemeContext";

const NOTE = "You're offline. On a device you've signed in on before, your password works without a connection. Signing in on a new device needs one.";
let online = true;
Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
afterEach(() => { cleanup(); online = true; });

const show = () => render(<ThemeProvider><SignInPage /></ThemeProvider>);

it("offline: the note, above the form, and the form still there", () => {
  online = false;
  show();
  const note = screen.getByText(NOTE);
  const email = screen.getByLabelText("Email");
  expect(note.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Sign in/ })).toBeTruthy();
});

it("online: no note", () => {
  show();
  expect(screen.queryByText(NOTE)).toBeNull();
});

it("follows the connection while the page is open", () => {
  show();
  expect(screen.queryByText(NOTE)).toBeNull();
  act(() => { online = false; window.dispatchEvent(new Event("offline")); });
  expect(screen.getByText(NOTE)).toBeTruthy();
  act(() => { online = true; window.dispatchEvent(new Event("online")); });
  expect(screen.queryByText(NOTE)).toBeNull();
});
