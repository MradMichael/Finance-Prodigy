// Item 3c (owner, session 25): the shared Field's <label> wasn't tied to its
// input (noticed in session 24, item 5), so a screen reader announced each
// field with no name (WCAG 2.2 AA 1.3.1 and 4.1.2), and clicking a label
// didn't focus its field. Every Field on sign-in, sign-up, recovery and
// Profile is found here by its accessible name, and is the input typed into.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
let session: null | { userId: string; email: string; name: string } = null;
vi.mock("../../lib/auth", () => ({
  getSession: () => session, hasValidSession: () => !!session, signIn: vi.fn(), signUp: vi.fn(), recoverAccount: vi.fn(),
  signOut: vi.fn(), updateProfile: vi.fn(), deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
vi.mock("../../lib/syncService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/syncService")>();
  return { ...real, checkEmailExists: vi.fn(async () => false), markAutoPulled: vi.fn(), pushToServer: vi.fn(), pullFromServer: vi.fn(), getLastSyncTime: () => null };
});
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));

import SignInPage from "../../app/sign-in/page";
import SignUpPage from "../../app/sign-up/page";
import RecoverPage from "../../app/recover/page";
import ProfilePage from "../../app/profile/page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, saveData } from "../../lib/localData";
import { activateSessionKey } from "../../lib/crypto";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); session = null; });
afterEach(cleanup);

/** A text field by its name (role textbox), or a password field by its label (password inputs have no role). */
function field(name: string, kind: "text" | "password" = "text"): HTMLInputElement {
  const el = (kind === "text" ? screen.getByRole("textbox", { name }) : screen.getByLabelText(name, { exact: true, selector: "input" })) as HTMLInputElement;
  expect(el.tagName).toBe("INPUT");
  if (kind === "password") expect(el.type).toBe("password");
  fireEvent.change(el, { target: { value: "typed" } });
  expect(el.value).toBe("typed");
  return el;
}

it("sign-in: Email and Password", () => {
  render(<ThemeProvider><SignInPage /></ThemeProvider>);
  field("Email"); field("Password", "password");
});

it("sign-up: Full name, Email, Password and Confirm password", () => {
  render(<ThemeProvider><SignUpPage /></ThemeProvider>);
  field("Full name"); field("Email"); field("Password", "password"); field("Confirm password", "password");
});

it("recovery: Email, Recovery code, New password and Confirm new password", () => {
  render(<ThemeProvider><RecoverPage /></ThemeProvider>);
  field("Email"); field("Recovery code"); field("New password", "password"); field("Confirm new password", "password");
});

it("Profile: Display name, and Type delete to confirm", async () => {
  session = { userId: "u1", email: "u1@example.test", name: "Quartz Lantern" };
  activateSessionKey(new Uint8Array(32).fill(7));
  await saveData({ ...DEFAULT_DATA, income: 3000 }, "u1");
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  await screen.findByRole("button", { name: /Download my data/ });
  field("Display name");
  fireEvent.click(screen.getByRole("button", { name: "Delete account & all data" }));
  field("Type delete to confirm");
});

it("each label and its input are one pair: the ids differ between fields", () => {
  render(<ThemeProvider><SignUpPage /></ThemeProvider>);
  const ids = ["Full name", "Email"].map((n) => screen.getByRole("textbox", { name: n }).id)
    .concat(["Password", "Confirm password"].map((n) => (screen.getByLabelText(n, { exact: true, selector: "input" }) as HTMLInputElement).id));
  expect(new Set(ids).size).toBe(4);
  expect(ids.every(Boolean)).toBe(true);
});
