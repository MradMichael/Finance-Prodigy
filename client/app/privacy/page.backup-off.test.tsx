// The privacy page's backup-off sentence (owner, 2026-10-06).
//
// It said, unconditionally, that with backup off "you can't sign in on
// another device, and your recovery code only works on this device". Both are
// untrue when the owner turned backup off but KEPT the server copy: the copy
// stays, and the password still opens it from another device. It also said
// "nothing is uploaded", while Profile's "Push to database" uploads on request
// whatever the backup choice.
//
// The new sentence deliberately makes NO promise that the recovery code works
// with a kept copy. SEC-09 and SEC-11 say it sometimes doesn't; that clause
// comes back when FB-1d ships.
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

describe("the backup-off sentence", () => {
  it("is the owner's wording, word for word", () => {
    expect(text()).toContain(
      "With backup off, nothing is uploaded automatically. Turning backup off lets you delete the server copy or keep it. " +
      "If you delete it, or never had one, you can't sign in on another device, and your recovery code only works on this device. " +
      "If you keep it, it stays on our server, this device stops updating it automatically, and you can still sign in on another device with your password.",
    );
  });

  it("no longer makes the unconditional claims", () => {
    const t = text();
    expect(t).not.toContain("With backup off, nothing is uploaded;");
    expect(t).not.toMatch(/nothing is uploaded; you can't sign in on another device/);
  });

  it("promises nothing about the recovery code and a kept copy (SEC-09, SEC-11)", () => {
    const t = text();
    const kept = t.slice(t.indexOf("If you keep it,"), t.indexOf("with your password.") + "with your password.".length);
    expect(kept.length).toBeGreaterThan(20);
    expect(kept).not.toMatch(/recovery code/i);
  });

  it("is dated the day it changed", () => {
    expect(text()).toContain("Last updated: 6 October 2026");
  });
});

// FB-1b2 (SEC-09): regenerating a recovery code always asks the server
// first, even with backup off (owner, 2026-10-06). Confirmed from the code
// before writing this: the check is POST /api/sync/pull carrying the address
// (body) and the password-derived sync token (Authorization), and nothing
// else. The replacement, only when a copy holds a code, is POST
// /api/sync/relink carrying the address, that token, and tokens derived from
// the current and new codes. Never data, never the codes themselves.
describe("the recovery-code check, disclosed with the change that makes it", () => {
  it("says what the check sends, even with backup off", () => {
    expect(text()).toContain(
      "Generating a new recovery code always checks with our server first, even with backup off: " +
      "that check sends your email address and your password-derived sync token, and uploads no data. " +
      "Replacing a server copy's recovery code also sends tokens derived from your current and new recovery codes, never the codes themselves.",
    );
  });
});
