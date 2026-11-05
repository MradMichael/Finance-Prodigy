// Rate staleness, phase 3 commit 3 (owner-approved 2026-11-05): the entry
// form says the rate's age when a lira amount is being entered, and only
// then. One line beside the currency toggle; the split-entry legs are left
// alone (another branch works there), so split mode shows nothing.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, recordRateEdit, type LocalFinancials } from "../lib/localData";

const NOW = new Date(2026, 10, 5, 10);
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

let latest: LocalFinancials;
function Harness({ initial }: { initial: LocalFinancials }) {
  const [d, setD] = useState(initial);
  latest = d;
  return <InputPanel financials={d} dashData={computeDashboard(d)} onChange={setD} onEdit={vi.fn()} onPay={vi.fn()} />;
}
const checkedDaysAgo = (n: number) =>
  ({ ...recordRateEdit({ ...DEFAULT_DATA, income: 3000, lbpRate: 80_000 } as LocalFinancials, 89_500, new Date(2026, 10, 5 - n, 9)), cards: [], transactions: [] }) as LocalFinancials;
const toggle = (text: string) => fireEvent.click(screen.getAllByRole("button").find((b) => b.getAttribute("aria-pressed") !== null && b.textContent?.includes(text))!);
const line = () => screen.queryAllByText(/^Rate L£89,500 per \$1, last checked \d+ days ago\.$/);

it("dollars selected: nothing about the rate", () => {
  render(<Harness initial={checkedDaysAgo(20)} />);
  toggle("$ USD");
  expect(line()).toHaveLength(0);
});

it("lira selected, rate 20 days old: the line, once", () => {
  render(<Harness initial={checkedDaysAgo(20)} />);
  toggle("L£ LBP");
  expect(line()).toHaveLength(1);
  expect(line()[0].textContent).toContain("20 days ago");
});

it("lira selected, rate checked yesterday: nothing", () => {
  render(<Harness initial={checkedDaysAgo(1)} />);
  toggle("L£ LBP");
  expect(line()).toHaveLength(0);
});

it("split mode: nothing (the split legs are not touched by this change)", () => {
  render(<Harness initial={checkedDaysAgo(20)} />);
  toggle("L£ LBP");
  fireEvent.click(screen.getByRole("button", { name: /Split across USD and LBP\?/ }));
  expect(line()).toHaveLength(0);
});

it("a label only: entering a lira amount still stores it as before", () => {
  render(<Harness initial={checkedDaysAgo(20)} />);
  toggle("L£ LBP");
  fireEvent.change(document.getElementById("tx-amount")!, { target: { value: "895000" } });
  fireEvent.click(screen.getByRole("button", { name: /\+ Add entry/ }));
  expect(latest.transactions[0]).toMatchObject({ amount: 895_000, currency: "LBP", lbpRateAtEntry: 89_500 });
  expect(latest.lbpRateUpdatedAt).toBe(new Date(2026, 10, 5 - 20, 9).toISOString());
});
