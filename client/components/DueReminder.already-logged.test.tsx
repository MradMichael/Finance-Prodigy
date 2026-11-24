// TODO 121 (owner, session 63, item 2; option b, held for the owner): "Already logged" on the due-date reminder.
// When one item is due and a row already logged matches its cycle (lib/alreadyLogged.ts), the reminder names the
// row and offers "Already logged", which links it instead of logging a new one; then it says so, with Undo. The
// notice stays until Undo, the next answer, or a move to another screen (no timer: an Undo that vanishes is a
// timing barrier). With nothing found, or several items due, the reminder is as before.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import DueReminder, { type Renewal } from "./DueReminder";
import { ThemeProvider } from "../contexts/ThemeContext";
import type { LoggedEntry } from "../lib/alreadyLogged";

afterEach(cleanup);

const NETFLIX: Renewal = { id: "r-netflix", name: "Netflix", emoji: "📺", amount: 15, currency: "USD", dueDate: "2026-11-24", dueInDays: 0, overdueCount: 0 };
const HAND: LoggedEntry = { txId: "hand", description: "Netflix", date: "2026-11-22", amount: 15, currency: "USD" };

function show(o: { renewals?: Renewal[]; found?: Record<string, LoggedEntry>; onLink?: () => Promise<boolean>; onUnlink?: () => Promise<boolean>; resetKey?: string } = {}) {
  const onConfirm = vi.fn(async () => true);
  const onLink = vi.fn(o.onLink ?? (async () => true));
  const onUnlink = vi.fn(o.onUnlink ?? (async () => true));
  const el = (resetKey: string) => (
    <ThemeProvider>
      <DueReminder renewals={o.renewals ?? [NETFLIX]} blocked={false} onConfirm={onConfirm} onReview={vi.fn()}
        found={o.found ?? { "r-netflix": HAND }} onLink={onLink} onUnlink={onUnlink} resetKey={resetKey} />
    </ThemeProvider>
  );
  const r = render(el(o.resetKey ?? "overview"));
  return { ...r, onConfirm, onLink, onUnlink, rerenderAt: (key: string) => r.rerender(el(key)) };
}
const region = () => screen.getByRole("region", { name: "Payment reminder" });
const buttons = () => within(region()).getAllByRole("button").map((b) => b.textContent);

describe("a row already logged for the cycle asked about", () => {
  it("names it under the question: \"You logged {name} on {date} ({amount}).\"; Already logged leads", () => {
    show();
    expect(region().textContent).toContain("Netflix is due today ($15.00). Is it paid?");
    expect(region().textContent).toContain("You logged Netflix on 22/11/2026 ($15.00).");
    expect(buttons()).toEqual(["Already logged", "Yes, it's paid", "Not yet"]);
  });

  it("the row's own description, amount and currency: a lira generator bill that came to L£2,600,000", () => {
    show({ renewals: [{ ...NETFLIX, id: "r-gen", name: "Generator", amount: 2_500_000, currency: "LBP" }], found: { "r-gen": { txId: "g", description: "generator", date: "2026-11-20", amount: 2_600_000, currency: "LBP" } } });
    expect(region().textContent).toContain("You logged generator on 20/11/2026 (L£2,600,000)."); // the row's own words
  });

  it("an overdue cycle too (the oldest outstanding, as Yes answers)", () => {
    show({ renewals: [{ ...NETFLIX, dueDate: "2026-10-24", dueInDays: -31, overdueCount: 2 }], found: { "r-netflix": { ...HAND, date: "2026-10-25" } } });
    expect(region().textContent).toContain("Netflix has 2 payments outstanding, the oldest due on 24/10/2026. Is that one paid?");
    expect(region().textContent).toContain("You logged Netflix on 25/10/2026 ($15.00).");
  });

  it("Already logged links that row to that cycle (no new row), then says so, with Undo", async () => {
    const { onLink, onConfirm } = show();
    fireEvent.click(screen.getByRole("button", { name: "Already logged" }));
    await waitFor(() => expect(region().textContent).toContain("Netflix: your entry of 22/11/2026 now counts as this payment. Nothing new was logged."));
    expect(onLink).toHaveBeenCalledWith("r-netflix", "hand", "2026-11-24");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("Netflix: your entry of 22/11/2026 now counts as this payment. Nothing new was logged.");
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("Undo takes the link off, and the notice goes", async () => {
    const { onUnlink } = show();
    fireEvent.click(screen.getByRole("button", { name: "Already logged" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).toBeNull());
    expect(onUnlink).toHaveBeenCalledWith("r-netflix", "hand", "2026-11-24");
    expect(region().textContent).not.toContain("now counts as this payment");
  });

  it("the notice stays on its own (no timer), and goes when the screen changes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { rerenderAt } = show();
      fireEvent.click(screen.getByRole("button", { name: "Already logged" }));
      await vi.waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy());
      vi.advanceTimersByTime(60_000);
      expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
      rerenderAt("recurring");
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("the link refused (the row changed meanwhile): no notice, the question stays", async () => {
    const { onLink } = show({ onLink: async () => false });
    fireEvent.click(screen.getByRole("button", { name: "Already logged" }));
    await waitFor(() => expect(onLink).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(region().textContent).toContain("Netflix is due today ($15.00). Is it paid?");
  });
});

// Session 63's live check at 390: with three buttons beside it, the question was squeezed into a column about 80 px
// wide ("20/10/2" cut off). With a row found, the text keeps at least 12rem (as Overview's renewals do), so on a
// phone the buttons wrap below it; at 1280 they stay on its line. jsdom has no layout, so the class is what is pinned.
it("with a row found, the question keeps 12rem, so the three buttons wrap below it on a phone", () => {
  show();
  const block = screen.getByText(/You logged Netflix/).parentElement!;
  expect(block.className.split(" ")).toContain("min-w-[12rem]");
  expect(block.className.split(" ")).toContain("flex-1");
});

describe("as before", () => {
  it("nothing found: no line, and today's two buttons (Yes leads)", () => {
    show({ found: {} });
    expect(region().textContent).not.toContain("You logged");
    expect(buttons()).toEqual(["Yes, it's paid", "Not yet"]);
  });

  it("several items due: the count and Review, no line", () => {
    show({ renewals: [NETFLIX, { ...NETFLIX, id: "r-gym", name: "Gym", amount: 40 }], found: { "r-netflix": HAND } });
    expect(region().textContent).toContain("2 payments are due or overdue.");
    expect(region().textContent).not.toContain("You logged");
    expect(screen.queryByRole("button", { name: "Already logged" })).toBeNull();
  });

  it("Yes still logs a new row (the person's choice)", async () => {
    const { onConfirm } = show();
    fireEvent.click(screen.getByRole("button", { name: "Yes, it's paid" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("r-netflix"));
  });
});
