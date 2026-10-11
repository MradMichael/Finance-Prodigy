// Session 11, item 7 (HELD: wording awaits the owner): the plain address
// check, disclosed. What it is, verified in the code:
//   - The client sends the address, and nothing else, in the body of
//     POST /api/auth/check-email (lib/syncService.ts serverCopyExists). The
//     callers: the sign-up page as the address is typed (once it holds an
//     "@", after a 600 ms pause), the end of sign-up, the backup question for
//     an undecided account (app/page.tsx), and the Overview when this device
//     has no sync time and backup is on or undecided (FinancialDashboard).
//   - The server (server/src/routes/auth.ts) trims and lower-cases it, looks
//     for a backup row with that address, and answers { exists } only. It
//     writes nothing. The route logs nothing; an unexpected error logs only
//     the method and path, and the logger replaces any address-shaped text
//     with its keyed reference (server/src/lib/logger.ts, emailRef.ts). The
//     rate limit counts requests per IP, not per address. No request logging
//     middleware; Prisma query logging is off.
// The sentence says only that. Its place: Account info.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));

import PrivacyPage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";

afterEach(cleanup);

describe("the plain address check (HELD draft)", () => {
  it("is disclosed: when the address is sent, and what the server does with it", () => {
    render(<ThemeProvider><PrivacyPage /></ThemeProvider>);
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain(
      "To tell you whether an address already has a backup on our server, ESSA sends that address, and nothing else, to our server: " +
      "on the sign-up page as you type it, when you finish signing up, when ESSA asks you about backup, and on your overview when " +
      "this device has no record of a backup; our server only checks whether a backup exists for it and answers yes or no, " +
      "without storing the address or writing it to its logs.",
    );
  });

  it("moves the date at the top", () => {
    render(<ThemeProvider><PrivacyPage /></ThemeProvider>);
    expect(document.body.textContent).toContain("Last updated: 11 October 2026");
  });
});
