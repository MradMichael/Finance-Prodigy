// COPY-11 (owner, 2026-09-30 and 2026-10-07): a brand-new sign-up skips the
// first-load restore, so a new account doesn't send its address to the server
// a second time before any backup choice -- EXCEPT when the address already
// has a copy. Sign-up's own duplicate check (check-email) has just found that
// out; then the restore is kept, so someone who signed up again with the same
// password gets their data back instead of an empty account (which "Keep
// backing up" could push over the backup; see the backstop in syncService).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("../../lib/auth", () => ({
  getSession: () => null,
  signUp: vi.fn(async () => ({ ok: true, recoveryCode: "ABCD-EFGH-JKLM-NPQR" })),
  signIn: vi.fn(async () => ({ ok: true, session: { userId: "u-new", email: "kayan@example.com", name: "Kayan Haddad" } })),
}));
let hasCopy = false;
const markAutoPulled = vi.fn();
vi.mock("../../lib/syncService", () => ({
  checkEmailExists: vi.fn(async () => hasCopy),
  markAutoPulled: (id: string) => markAutoPulled(id),
}));

import SignUpPage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";

beforeEach(() => { markAutoPulled.mockClear(); ROUTER.push.mockClear(); });
afterEach(cleanup);

async function signUp() {
  render(<ThemeProvider><SignUpPage /></ThemeProvider>);
  fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Kayan Haddad" } });
  fireEvent.change(screen.getByPlaceholderText("you@email.com"), { target: { value: "kayan@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Min. 10 characters"), { target: { value: "Harbor-Lantern-4471" } });
  fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "Harbor-Lantern-4471" } });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  const box = await screen.findByRole("checkbox", undefined, { timeout: 3000 });
  fireEvent.click(box);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(ROUTER.push).toHaveBeenCalledWith("/"));
}

describe("COPY-11: the first-load restore at sign-up", () => {
  it("an address with no server copy: skipped", async () => {
    hasCopy = false;
    await signUp();
    expect(markAutoPulled).toHaveBeenCalledWith("u-new");
  });

  it("an address that already has a copy: kept, so the data comes back", async () => {
    hasCopy = true;
    await signUp();
    expect(markAutoPulled).not.toHaveBeenCalled();
  });
});
