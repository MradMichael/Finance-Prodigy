// TODO 134 (owner, session 67; AUDIT 2.4.182): My Finances' recurring rows. At 390 px the name's badges ("overdue", the
// currency) sat 8-55 px past the name's column, the currency badge over the edit button. The name and its badges had no
// break opportunity between them (the JSX left no space), so "subscription", "OVERDUE" and "USD" wrapped as one word in
// a 108 px column. Each badge now follows a <wbr> (a line break opportunity, invisible when the line fits), and the line
// breaks a single over-long name rather than letting it overflow. jsdom does no layout, so this checks the markup; the
// live check (session 67's rows-67.js) measures the rows.
import { it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import InputPanel from "../InputPanel";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring } from "../../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }) }));
beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 9, 15, 10, 0), toFake: ["Date"] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

// Due on 5 October and unpaid on the 15th: overdue once ("overdue", no "×N", whose space would already let it wrap),
// so the line carries both badges.
const GEN: StoredRecurring = { id: "r-gen", name: "Generator subscription", emoji: "•", amount: 85, currency: "USD", frequency: "monthly", bucket: "NEEDS",
  startDate: "2026-10-05", endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z" };
const DATA = { ...DEFAULT_DATA, income: 3000, recurring: [GEN], transactions: [] } as LocalFinancials;

it("each badge on a recurring row's name line can wrap to the next line (a <wbr> before it), and a long name breaks", () => {
  render(<InputPanel financials={DATA} dashData={computeDashboard(DATA)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} onConfirmRecurring={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
  fireEvent.click(screen.getByRole("button", { name: /Recurring Payments/ }));
  const line = screen.getByText((_, el) => el?.tagName === "P" && /Generator subscription/.test(el.textContent ?? "") && !!el.querySelector("span"));
  const badges = Array.from(line.querySelectorAll(":scope > span"));
  // The premise: overdue and the currency, both shown.
  expect(badges.map((b) => b.textContent)).toEqual(["overdue", "USD"]);
  for (const b of badges) expect(b.previousSibling?.nodeName, `before "${b.textContent}"`).toBe("WBR");
  expect(line.classList.contains("break-words")).toBe(true);
});
