// FB-1c (SEC-03): the privacy line for the security-policy report endpoint,
// shipped in the same merge as the endpoint (owner, 2026-10-06). What the
// server logs per report is exactly the page's path and what was blocked,
// reduced to its origin or a keyword (server/src/routes/cspReport.ts, and its
// test). The sentence says no more and no less than that.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));

import PrivacyPage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";

afterEach(cleanup);

describe("security-policy reports", () => {
  it("are disclosed: what the browser may send, and exactly what is logged", () => {
    render(<ThemeProvider><PrivacyPage /></ThemeProvider>);
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("Security reports");
    expect(text).toContain(
      "If ESSA's security policy blocks something on a page, your browser may send a short report to our own server. " +
      "We log only which ESSA page it was and what was blocked, reduced to the site it came from or a word such as \"inline\": " +
      "nothing that identifies you, and never your financial data.",
    );
  });
});
