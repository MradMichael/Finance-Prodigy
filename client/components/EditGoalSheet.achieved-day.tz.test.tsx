// Review fix 2 (owner, 2026-11-10): the goal edit sheet stamps an achievement
// with the LOCAL day (todayISO()), as a contribution does (TIME-02,
// applyGoalContribution). It used to stamp new Date().toISOString(), a UTC
// instant, and the screens show a stamp's first ten characters (fmtDate): a
// goal marked achieved between midnight and 3 am in Beirut showed the day
// before. Beirut is UTC+3 until late October and UTC+2 after.
//
// Its own file with the zone set at module load, before any Date exists, as
// lib/debtEngine.tz.test.ts and lib/computeDashboard.tz.test.ts are (Node
// caches the resolved zone; set later, it leaks or isn't honoured).
process.env.TZ = "Asia/Beirut";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import EditGoalSheet from "./EditGoalSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, applyGoalContribution, fmtDate, type LocalFinancials, type StoredGoal } from "../lib/localData";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const goal = (o: Partial<StoredGoal> = {}): StoredGoal =>
  ({ id: "g1", name: "Car", emoji: "🚗", targetAmount: 1000, currentAmount: 0, openingAmount: 400, currency: "USD", targetDate: "2027-06-01", ...o }) as StoredGoal;
const data = (g: StoredGoal) => ({ ...DEFAULT_DATA, goals: [g], transactions: [] }) as LocalFinancials;

/** Sets "Saved" to the target at this instant and saves; the goal as written. */
function achieveAt(instant: string, g: StoredGoal = goal()) {
  vi.useFakeTimers({ now: new Date(instant), toFake: ["Date"] });
  const onChange = vi.fn<(f: LocalFinancials) => void>();
  render(<ThemeProvider><EditGoalSheet goal={g} financials={data(g)} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
  fireEvent.change(document.getElementById("edit-goal-saved")!, { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  return onChange.mock.calls[0][0].goals[0];
}

describe("the edit sheet stamps the local day", () => {
  beforeEach(() => { expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Asia/Beirut"); }); // fails closed if the zone isn't honoured

  it.each([
    ["00:30 on 3 October (summer, UTC+3): still 2 October in UTC", "2026-10-02T21:30:00.000Z", "2026-10-03", "03/10/2026"],
    ["01:30 on 3 October", "2026-10-02T22:30:00.000Z", "2026-10-03", "03/10/2026"],
    ["02:59 on 3 October", "2026-10-02T23:59:00.000Z", "2026-10-03", "03/10/2026"],
    ["00:30 on 1 January (winter, UTC+2): still 31 December in UTC", "2026-12-31T22:30:00.000Z", "2027-01-01", "01/01/2027"],
    ["01:59 on 1 January", "2026-12-31T23:59:00.000Z", "2027-01-01", "01/01/2027"],
  ])("%s", (_when, instant, day, shown) => {
    const g = achieveAt(instant);
    expect(g.achievedAt).toBe(day);
    expect(fmtDate(g.achievedAt)).toBe(shown); // what "Achieved dd/mm/yyyy" shows (InputPanel)
  });

  it("at noon too: a day, never an instant", () => {
    expect(achieveAt("2026-10-03T09:00:00.000Z").achievedAt).toBe("2026-10-03");
  });

  it("the same shape a contribution stamps: a day, not an instant", () => {
    const viaSheet = achieveAt("2026-10-02T22:30:00.000Z").achievedAt;
    const viaContribution = applyGoalContribution([goal()], "g1", 600, 89_500, {}, [])!.goals[0].achievedAt; // same faked instant
    expect(viaSheet).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(viaSheet).toBe(viaContribution);
  });

  it("a stamp the goal already has is kept, not restamped (a pin)", () => {
    const g = achieveAt("2026-10-02T22:30:00.000Z", goal({ openingAmount: 1000, achievedAt: "2026-05-01" }));
    expect(g.achievedAt).toBe("2026-05-01");
  });
});
