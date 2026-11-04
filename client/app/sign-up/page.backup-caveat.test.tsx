// Session 41 (owner-approved item C). Sign-up said "Your records are private
// to you." and Recover said the data is "encrypted only you can unlock". Both
// are true of this browser's copy only: with backup on, the server copy is not
// end-to-end encrypted and the server can read it (Trust & Security). Each
// sentence now says so.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ReactElement } from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }) }));
vi.mock("../../lib/auth", () => ({
  getSession: () => null,
  signUp: vi.fn(),
  signIn: vi.fn(),
  recoverAccount: vi.fn(),
}));
vi.mock("../../lib/syncService", () => ({ checkEmailExists: vi.fn(async () => false), markAutoPulled: vi.fn() }));

import SignUpPage from "./page";
import RecoverPage from "../recover/page";
import { ThemeProvider } from "../../contexts/ThemeContext";

afterEach(cleanup);

const textOf = (el: ReactElement) => {
  render(<ThemeProvider>{el}</ThemeProvider>);
  return (document.body.textContent ?? "").replace(/\s+/g, " ");
};

describe("the backup-on caveat", () => {
  it("sign-up no longer calls records private without the backup caveat", () => {
    const text = textOf(<SignUpPage />);
    expect(text).not.toContain("Your records are private to you.");
    expect(text).toMatch(/if you turn on backup, .*the server can read it/i);
  });

  it("recover says only this browser's copy is encrypted so only you can unlock it", () => {
    const text = textOf(<RecoverPage />);
    expect(text).not.toContain("it being encrypted only you can unlock.");
    expect(text).toMatch(/this browser.s copy/i);
    expect(text).toMatch(/if backup is on, .*the server can read it/i);
  });
});
