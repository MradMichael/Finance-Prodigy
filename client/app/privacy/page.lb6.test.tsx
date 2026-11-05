// LB6 (caveat approved in session 42; stands until 2.4.132 steps 2-3 ship).
// The deletion promises carry the owner-approved caveat, and the way to have
// the remaining copies removed. Pins the caveat's wording.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));

import PrivacyPage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";

afterEach(cleanup);

const text = () => {
  render(<ThemeProvider><PrivacyPage /></ThemeProvider>);
  return (document.body.textContent ?? "").replace(/\s+/g, " ");
};

describe("LB6: the analytics-copy exception is stated", () => {
  it("no longer promises account deletion always removes the analytics copies", () => {
    expect(text()).not.toContain("and deleting your account removes them along with the sync backup itself.");
  });

  it("names the exception, that the app can't remove those, and the email route", () => {
    const t = text();
    expect(t).toContain(
      "One known exception: for some accounts whose backup copy was already gone, some of these older copies were left behind, and deleting the account in the app can't reach them.",
    );
    expect(t).toContain("Until we've removed them, email us and we'll delete them by hand.");
  });

  it("the deletion section points to the exception instead of an unqualified promise", () => {
    expect(text()).toContain("(and anything derived from it, apart from the exception under Internal analytics)");
  });
});
