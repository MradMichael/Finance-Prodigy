// F4 (owner, session 56; held for the owner's look): the Monthly report screen. Every sentence is the owner's,
// verbatim. Sharing: "Share this report" first shows the confirmation; the image is drawn only after "Share", on
// this device, and handed to the phone's share sheet (or downloaded where there is none). Cancel draws nothing and
// nothing leaves. Nothing is sent to the server at any point.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import MonthlyReportScreen from "./MonthlyReportScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { reportImageLines } from "../../lib/reportImage";
import { buildMonthlyReport } from "../../lib/monthlyReport";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction, type StoredGoal } from "../../lib/localData";
import type { CycleKey } from "../../lib/period";

let n = 0;
const tx = (o: Partial<StoredTransaction>): StoredTransaction =>
  ({ id: `t${n++}`, amount: 10, currency: "USD", bucket: "WANTS", description: "x", date: "2026-10-03", paymentMethod: "cash", createdAt: "2026-10-03T10:00:00.000Z", ...o }) as StoredTransaction;
const LAPTOP: StoredGoal = { id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1500, currentAmount: 0, openingAmount: 100, currency: "USD", targetDate: "2027-06-30", createdAt: "2026-01-01T00:00:00.000Z" };
const DATA = {
  ...DEFAULT_DATA, income: 3000, goals: [LAPTOP],
  transactions: [
    tx({ category: "groceries", amount: 300, bucket: "NEEDS", date: "2026-10-04" }),
    tx({ category: "dining", amount: 120, date: "2026-10-06" }),
    tx({ bucket: "SAVINGS", amount: 200, goalId: "g1", description: "Goal: Laptop", date: "2026-10-16" }),
    tx({ category: "groceries", amount: 150, bucket: "NEEDS", date: "2026-09-04" }),
    tx({ category: "dining", amount: 110, date: "2026-09-06" }),
    tx({ category: "travel", amount: 40, date: "2026-08-06" }),
  ],
} as LocalFinancials;

let fetchSpy: ReturnType<typeof vi.fn>;
let getContext: ReturnType<typeof vi.spyOn>;
const ctx = {
  fillStyle: "", font: "", textAlign: "left", textBaseline: "alphabetic",
  fillRect: vi.fn(), fillText: vi.fn(), measureText: (s: string) => ({ width: s.length * 14 }),
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T12:00:00"));
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(new Blob(["png"], { type: "image/png" })); };
  ctx.fillText.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { canShare?: unknown }).canShare;
});

const show = (data: LocalFinancials = DATA) => render(<ThemeProvider><MonthlyReportScreen financials={data} /></ThemeProvider>);
const text = () => document.body.textContent ?? "";

describe("the screen", () => {
  it("its title, and the period picker labelled Period, this period first", () => {
    show();
    expect(screen.getByRole("heading", { level: 1, name: "Monthly report" })).toBeTruthy();
    const picker = screen.getByLabelText("Period", { exact: true }) as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Oct 2026", "Sep 2026", "Aug 2026"]);
    expect(picker.value).toBe("2026-10");
  });

  it("the section headings, as approved", () => {
    show();
    for (const h of ["Money in", "Bills and debt payments", "Where it went", "Saved", "Goals", "Compared with Sep 2026"]) {
      expect(screen.getByRole("heading", { level: 2, name: h })).toBeTruthy();
    }
  });

  it("the goal line and the comparison line, verbatim", () => {
    show();
    expect(text()).toContain("Laptop: $300.00 of $1,500.00 (20%), $200.00 added this month.");
    expect(text()).toContain("Groceries was 100% higher than Sep 2026 ($150.00 more).");
  });

  it("a period with nothing that moved enough: \"No large changes from …\"", () => {
    show();
    fireEvent.change(screen.getByLabelText("Period", { exact: true }), { target: { value: "2026-09" } });
    expect(screen.getByRole("heading", { level: 2, name: "Compared with Aug 2026" })).toBeTruthy();
    expect(text()).toContain("No large changes from Aug 2026.");
  });

  it("the first period: \"Nothing to compare yet: this is your first month.\"", () => {
    show();
    fireEvent.change(screen.getByLabelText("Period", { exact: true }), { target: { value: "2026-08" } });
    expect(text()).toContain("Nothing to compare yet: this is your first month.");
  });

  it("a period with no entries says so, and offers no image", () => {
    show({ ...DEFAULT_DATA, transactions: [] } as LocalFinancials);
    expect(text()).toContain("No entries in this month.");
    expect(screen.queryByRole("button", { name: "Share this report" })).toBeNull();
  });
});

describe("sharing", () => {
  it("\"Share this report\" shows the confirmation first, and nothing is drawn or shared yet", () => {
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Share this report" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("This image shows this month's figures. Anyone you send it to will see them.")).toBeTruthy();
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual(["Share", "Cancel"]);
    expect(getContext).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });

  it("Cancel closes it: nothing drawn, nothing shared", () => {
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Share this report" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(getContext).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });

  it("Share draws the image on this device and hands it to the share sheet as a PNG; nothing goes to the server", async () => {
    const share = vi.fn(async (_d: ShareData) => {});
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Share this report" }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const files = share.mock.calls[0][0].files!;
    expect(files).toHaveLength(1);
    expect(files[0].type).toBe("image/png");
    expect(files[0].name).toBe("essa-report-2026-10.png");
    expect(getContext).toHaveBeenCalled();
    expect(ctx.fillText.mock.calls.map((c) => c[0])).toContain("From ESSA. US dollars; lira at each day's rate.");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("with no share sheet, Share downloads the image instead", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => "blob:report");
    URL.revokeObjectURL = vi.fn();
    show();
    fireEvent.click(screen.getByRole("button", { name: "Share this report" }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const a = click.mock.contexts[0] as HTMLAnchorElement;
    expect(a.download).toBe("essa-report-2026-10.png");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the image says what the screen says", () => {
  it("its lines: the title, the period, each section, the sentences, then the footer", () => {
    const r = buildMonthlyReport(DATA, "2026-10" as CycleKey, new Date("2026-10-20T12:00:00"));
    const lines = reportImageLines(r).map((l) => (l.right ? `${l.text} | ${l.right}` : l.text));
    expect(lines[0]).toBe("Monthly report");
    expect(lines[1]).toBe("Oct 2026");
    expect(lines).toContain("Where it went | $420.00");
    expect(lines).toContain("Groceries | $300.00");
    expect(lines).toContain("Laptop: $300.00 of $1,500.00 (20%), $200.00 added this month.");
    expect(lines).toContain("Compared with Sep 2026");
    expect(lines).toContain("Groceries was 100% higher than Sep 2026 ($150.00 more).");
    expect(lines.at(-1)).toBe("From ESSA. US dollars; lira at each day's rate.");
  });
});
