// The payday setting and its confirm.
//
// Setup had zero test coverage after the LBP rate field moved to
// CurrencyScreen (its whole test file went with the field). This restores
// coverage for the one control on the screen that can move numbers the user
// has already seen -- deliberately the riskiest thing Setup now does.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SetupScreen from "./SetupScreen";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, cycleStartDayOf, type LocalFinancials } from "../../lib/localData";

afterEach(() => { cleanup(); });

function renderSetup(overrides: Partial<LocalFinancials> = {}) {
  const data = { ...DEFAULT_DATA, income: 3000, ...overrides } as LocalFinancials;
  const onChange = vi.fn();
  render(<SetupScreen financials={data} dashData={computeDashboard(data)} onChange={onChange} />);
  return { onChange, data };
}

const field = () => screen.getByLabelText(/Payday \(day of month\)/i) as HTMLInputElement;
const lastCall = (onChange: ReturnType<typeof vi.fn>) =>
  onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as LocalFinancials | undefined;

describe("the payday field", () => {
  it("defaults to 1 for an account that has never set one", () => {
    renderSetup();
    expect(field().value).toBe("1");
    // And the model agrees: absent means 1, so deploying changes nothing.
    expect(cycleStartDayOf({})).toBe(1);
  });

  it("declares its bounds on the element -- 28, not 31", () => {
    renderSetup();
    expect(field()).toHaveAttribute("min", "1");
    // A 29th-31st payday would clamp to the last day in short months, making
    // a "31st" payday silently the 28th every February.
    expect(field()).toHaveAttribute("max", "28");
  });

  it("typing does NOT save -- the change is confirmed, not committed on a keystroke", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSetup();
    await user.clear(field());
    await user.type(field(), "27");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("states what will move before it moves, then saves both the day and the stamp", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSetup();
    await user.clear(field());
    await user.type(field(), "27");
    // Premise: the confirm actually appeared, so the click below is not a
    // no-op against a button that was always there.
    expect(screen.getByText(/re-slices every period/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Move payday/i }));
    const saved = lastCall(onChange)!;
    expect(saved.cycleStartDay).toBe(27);
    // The stamp is what expires the Overview banner; without it the banner
    // could never show.
    expect(Math.abs(Date.now() - new Date(saved.cycleStartDayChangedAt!).getTime())).toBeLessThan(5_000);
  });

  it("cancelling saves nothing and puts the field back", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSetup();
    await user.clear(field());
    await user.type(field(), "27");
    await user.click(screen.getByRole("button", { name: /Keep the 1st/i }));
    expect(onChange).not.toHaveBeenCalled();
    expect(field().value).toBe("1");
  });

  it("re-entering the day already in force is not a change, so nothing is stamped", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSetup({ cycleStartDay: 27 });
    await user.clear(field());
    await user.type(field(), "27");
    expect(screen.queryByText(/re-slices every period/i)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("names the current range once a payday is set, so the setting is legible", () => {
    renderSetup({ cycleStartDay: 27 });
    expect(screen.getByText(/\d+ \w+ – \d+ \w+/)).toBeTruthy();
  });
});
