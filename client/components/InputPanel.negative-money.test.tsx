// CODE-01 / Q26 (owner, session 22: English, comma thousands): My Finances
// formatted its "this month" tiles as "$" + the number, so a negative figure
// read "$-105" where every other screen says "-$105". Wants can be negative
// since session 19 (a change-back nets against it in its own month and is
// shown as it is).
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, todayISO, type LocalFinancials } from "../lib/localData";
import { buildChangeBack } from "../lib/foreignCash";

afterEach(cleanup);

it("a negative Wants this month reads -$105, the sign before the dollar", () => {
  const back = buildChangeBack({ date: todayISO(), code: "EUR", given: 100, received: 105, receivedCurrency: "USD", to: { paymentMethod: "cash" }, description: "Changed back from EUR" }, 89_500);
  const data = { ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, transactions: [back] } as LocalFinancials;
  render(<InputPanel financials={data} dashData={computeDashboard(data)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} />);
  // The tile: its figure, then its label ("Wants" is also a bucket button in the entry form).
  const tile = screen.getAllByText("Wants").find((el) => el.previousElementSibling?.classList.contains("tabular-nums"))!.parentElement!;
  expect(tile.textContent).toContain("-$105");
  expect(tile.textContent).not.toContain("$-");
});
