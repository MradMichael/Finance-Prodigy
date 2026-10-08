// DI-13 follow-up (session 4): Delete on My Finances soft-deletes through
// softDelete, which stamps the restore generation the deletion was made in.
// Without it, a restore's revival of that transaction (same generation)
// would beat a deletion made after the restore, and it could never be
// deleted again on another device.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, todayISO, type LocalFinancials, type StoredTransaction } from "../lib/localData";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("Delete stamps the current restore generation on the transaction", () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const t: StoredTransaction = { id: "t1", amount: 12.5, currency: "USD", bucket: "WANTS", description: "Kahwet Leila", date: todayISO() };
  const data = { ...DEFAULT_DATA, income: 3000, transactions: [t], revivedKeys: { transactions: { t1: 2 } } } as LocalFinancials;
  const onChange = vi.fn();
  render(<InputPanel financials={data} dashData={computeDashboard(data)} onChange={onChange} onEdit={vi.fn()} onPay={vi.fn()} />);
  fireEvent.click(screen.getAllByRole("button", { name: "Delete transaction" })[0]);
  const written = (onChange.mock.calls.at(-1)![0] as LocalFinancials).transactions.find((x) => x.id === "t1")!;
  expect(written.deletedAt).toBeTruthy();
  expect(written.deletedGen).toBe(2);
});
