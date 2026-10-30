// INF-02 (owner, session 30): the app's error reports to our own server are
// disclosed beside the security reports, saying exactly what is logged
// (server/src/routes/clientErrors.ts and its test). Approved in session 31
// with the IP sentence added; the page's date moved to the merge day.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));

import PrivacyPage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";

afterEach(cleanup);

describe("error reports", () => {
  it("are disclosed: what the browser may send, and exactly what is logged", () => {
    render(<ThemeProvider><PrivacyPage /></ThemeProvider>);
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("Error reports");
    expect(text).toContain(
      "If something goes wrong in ESSA on your device, your browser may send a short report to our own server so we can fix it. " +
      "It carries nothing that identifies you and never your financial data or your email address: we log only which ESSA page it was, " +
      "the kind of error, and where in ESSA's code it happened, with numbers and addresses removed from its message. ESSA doesn't record your IP address with it.",
    );
  });

  it("the page's date moved with it", () => {
    render(<ThemeProvider><PrivacyPage /></ThemeProvider>);
    expect(document.body.textContent).toContain("Last updated: 30 October 2026");
  });
});
