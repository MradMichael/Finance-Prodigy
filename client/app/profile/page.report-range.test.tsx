// The report tab's date range on Profile (shown with "Detailed PDF").
// Session 20, item 2: measured live at 390px, the two fields and "to" didn't
// fit their row and the second was cut off; the row now wraps.
// Session 21, item 2 (owner): it used the browser's own date input, which
// shows mm/dd/yyyy in a US-English browser. It's now the app's own date field
// (DD / MM / YYYY), as every other date field is. Blank still means all time:
// a date typed and then cleared leaves that end of the range open.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" };
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("../../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
vi.mock("../../lib/syncService", () => ({
  pushToServer: vi.fn(), pullFromServer: vi.fn(), getLastSyncTime: () => null,
  confirmOverwriteIfNeeded: vi.fn(async () => true), mergeAndPush: vi.fn(), buildMergeNoticeText: () => ({ text: "" }),
  applyBackupChoice: vi.fn(),
}));
vi.mock("../../lib/analytics", () => ({ isAnalyticsOptedIn: () => false, setAnalyticsOptIn: vi.fn() }));
vi.mock("../../lib/printReport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/printReport")>()),
  buildReportHtml: vi.fn(() => "<html><body>report</body></html>"),
}));

import ProfilePage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, saveData, type LocalFinancials } from "../../lib/localData";
import { activateSessionKey } from "../../lib/crypto";
import { buildReportHtml } from "../../lib/printReport";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); activateSessionKey(new Uint8Array(32).fill(7)); vi.mocked(buildReportHtml).mockClear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openDetailed() {
  await saveData({ ...DEFAULT_DATA, income: 3000 } as LocalFinancials, "u1");
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Detailed PDF" }));
  const all = (p: string) => screen.getAllByPlaceholderText(p) as HTMLInputElement[];
  return { dd: all("DD"), mm: all("MM"), yyyy: all("YYYY") };
}
// The report opens in a window the page writes into; here, a stand-in.
function stubReportWindow() {
  const win = { document: { write: vi.fn(), close: vi.fn() }, onload: null as null | (() => void), print: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
  return win;
}
const reportOptions = () => vi.mocked(buildReportHtml).mock.calls.at(-1)?.[3];

it("the range is the app's own date field, DD / MM / YYYY, not the browser's", async () => {
  const { dd, mm, yyyy } = await openDetailed();
  expect([dd.length, mm.length, yyyy.length]).toEqual([2, 2, 2]);
  // The only native date inputs left are the fields' hidden calendar pickers.
  for (const el of document.querySelectorAll('input[type="date"]')) expect(el.getAttribute("aria-hidden")).toBe("true");
});

it("wraps on a narrow screen instead of cutting off its second field, each field only as wide as its boxes", async () => {
  const { dd } = await openDetailed();
  const [from, to] = dd.map((el) => el.parentElement!);
  const row = from.parentElement!;
  expect(to.parentElement).toBe(row);
  expect(row.classList.contains("flex-wrap")).toBe(true);
  for (const field of [from, to]) expect(field.style.width).toBe("auto");
});

it("the Detailed report is built for the range typed: 01/10/2026 to 12/10/2026", async () => {
  const user = userEvent.setup();
  const { dd } = await openDetailed();
  stubReportWindow();
  await user.click(dd[0]); await user.keyboard("01102026");
  await user.click(dd[1]); await user.keyboard("12102026");
  await user.click(screen.getByRole("button", { name: /Download as PDF/ }));
  await waitFor(() => expect(buildReportHtml).toHaveBeenCalled());
  expect(reportOptions()).toEqual({ detailed: true, dateFrom: "2026-10-01", dateTo: "2026-10-12" });
});

it("a date typed and then cleared leaves that end open: blank is all time", async () => {
  const user = userEvent.setup();
  const { dd, mm, yyyy } = await openDetailed();
  stubReportWindow();
  await user.click(dd[0]); await user.keyboard("01102026");
  for (const box of [dd[0], mm[0], yyyy[0]]) await user.clear(box);
  await user.click(screen.getByRole("button", { name: /Download as PDF/ }));
  await waitFor(() => expect(buildReportHtml).toHaveBeenCalled());
  expect(reportOptions()).toEqual({ detailed: true, dateFrom: undefined, dateTo: undefined });
});
