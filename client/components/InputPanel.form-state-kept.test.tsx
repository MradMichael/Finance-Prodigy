// InputPanel split (session 55): what the section moves (S6 on) must keep. Text typed into a section's form is
// kept while the section is closed and while the other tab is showing: the forms' state lives in InputPanel, not
// in the sections (a closed Section doesn't render its body). A move that put a form's state inside its section
// would lose the text on close. These pin today's behaviour; each move keeps them green.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import InputPanel from "./InputPanel";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials } from "../lib/localData";

beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 10, 13, 12, 0), toFake: ["Date"] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

function Harness() {
  const [d, setD] = useState({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, cards: [], transactions: [] } as LocalFinancials);
  return <InputPanel financials={d} dashData={computeDashboard(d)} onChange={setD} onEdit={vi.fn()} onPay={vi.fn()} />;
}
const type = (id: string, v: string) => fireEvent.change(document.getElementById(id)!, { target: { value: v } });
const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
const tab = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const toggle = (section: RegExp) => fireEvent.click(screen.getByRole("button", { name: section }));

const MANAGE: [string, RegExp, string, string][] = [
  ["Goals", /^🎯\s*Goals/, "new-goal-name", "Laptop"],
  ["Recurring Payments", /Recurring Payments/, "new-rec-name", "Gym"],
  ["Debts", /Debts/, "new-debt-name", "Car loan"],
  ["Other Assets", /Other Assets/, "new-asset-name", "Car"],
  ["Transfer", /^🔁\s*Transfer\s*▾$/, "new-transfer-amount", "250"],
];

describe("a form's text is kept while its section is closed", () => {
  it.each(MANAGE)("%s", (_title, section, id, text) => {
    render(<Harness />);
    tab(/Manage/);
    toggle(section);
    type(id, text);
    toggle(section); // closed: the field is gone from the page
    expect(document.getElementById(id)).toBeNull();
    toggle(section);
    expect(value(id)).toBe(text);
  });

  it("Log an entry", () => {
    render(<Harness />);
    type("tx-desc", "Flat white");
    type("tx-amount", "4.5");
    toggle(/Log an entry/);
    expect(document.getElementById("tx-desc")).toBeNull();
    toggle(/Log an entry/);
    expect(value("tx-desc")).toBe("Flat white");
    expect(value("tx-amount")).toBe("4.5");
  });
});

describe("a form's text is kept while the other tab is showing", () => {
  it("Manage's forms, across a visit to Daily", () => {
    render(<Harness />);
    tab(/Manage/);
    for (const [, section, id, text] of MANAGE) { toggle(section); type(id, text); }
    tab(/Daily/);
    expect(document.getElementById("new-goal-name")).toBeNull();
    tab(/Manage/);
    // A section opened before stays as its default when the tab comes back (closed); the text is there on reopening.
    for (const [, section, id, text] of MANAGE) {
      if (!document.getElementById(id)) toggle(section);
      expect(value(id)).toBe(text);
    }
  });

  it("Daily's entry form, across a visit to Manage", () => {
    render(<Harness />);
    type("tx-desc", "Flat white");
    tab(/Manage/);
    expect(document.getElementById("tx-desc")).toBeNull();
    tab(/Daily/);
    expect(value("tx-desc")).toBe("Flat white");
  });
});
