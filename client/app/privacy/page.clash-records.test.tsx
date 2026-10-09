// Plan H 5d's clash records, disclosed (owner-approved wording, session 7).
// A merge that settles a change both devices made keeps a note of what was
// kept and what the other device had (LocalFinancials.clashRecords), in the
// copy that syncs, pruned 30 days after that merge (CLASH_RECORD_DAYS), so
// each device can say it once (lib/clashNotice.ts).
import { it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));

import PrivacyPage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { CLASH_RECORD_DAYS } from "../../lib/syncMerge";

afterEach(cleanup);

it("says what a change both devices made leaves in the copy, and for how long, beside the combining", () => {
  render(<ThemeProvider><PrivacyPage /></ThemeProvider>);
  const section = screen.getByRole("heading", { name: "What we collect" }).closest("section")!;
  expect((section.textContent ?? "").replace(/\s+/g, " ")).toContain(
    "With backup on, each of your devices also fetches the copy when you open or return to ESSA, and combines it with what it already has. " +
    "When both of your devices change the same thing before they sync, ESSA keeps a short note of what was kept and what the other device had, " +
    "for 30 days, in the server copy too if backup is on, so each device can tell you once.",
  );
});

it("the 30 days is the records' own pruning age", () => {
  expect(CLASH_RECORD_DAYS).toBe(30);
});
