// AUDIT 2.4.175 (owner, session 65, item 3; TODO 130): My Finances' recurring rows, their small "Confirm" and "+extra",
// reach 4.5:1 in all six themes (WCAG 2.2 AA, 1.4.3). Both are 10 px text, jade (Confirm coral when overdue), in the
// row's button group, which was faded to 70%, and each faded to 80% more on hover: 3.32:1 at rest in Ivory, found by axe
// in session 64, and 2.53:1 hovered (the mouse rests on Confirm after the click). Session 58's arithmetic
// (add-and-log-again.contrast.test.tsx): the text colour, faded by every opacity on the way up, over the nearest
// background; here in both states, at rest and hovered (a hovered button's ancestors are hovered too, and an element's
// `hover:opacity-*` replaces its own resting opacity). A disabled button ("Confirming…") is exempt and not checked.
// jsdom does no layout, so this is the arithmetic; the live check runs axe at 390 and 1280.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import InputPanel from "../InputPanel";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { THEMES, type ThemeKey } from "../../lib/theme";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring, type StoredTransaction } from "../../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }) }));
beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 9, 15, 10, 0), toFake: ["Date"] }); });
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

const parse = (c: string): number[] | null => {
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return null;
  const p = m[1].split(",").map((x) => parseFloat(x));
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
};
const channel = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg: number[], alpha: number, bg: number[]) => [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha));
const opacityOf = (cls: string, prefix: "" | "hover:"): number | null => {
  const m = new RegExp(`^${prefix}opacity-(?:(\\d+)|\\[(0?\\.\\d+|1)\\])$`).exec(cls);
  return m ? (m[1] !== undefined ? Number(m[1]) / 100 : Number(m[2])) : null;
};

/** The contrast an element's text shows at rest and hovered: its colour, faded by every opacity above it, over the nearest background. */
function shownContrast(el: HTMLElement): { rest: number; hovered: number } {
  let fg: number[] | null = null;
  let rest = 1, hovered = 1;
  const backs: number[][] = [];
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (!fg && n.style.color) fg = parse(n.style.color);
    let own = 1, ownHover: number | null = null;
    for (const cls of Array.from(n.classList)) {
      const a = opacityOf(cls, ""); if (a !== null) own *= a;
      const h = opacityOf(cls, "hover:"); if (h !== null) ownHover = h;
    }
    if (n.style.opacity) own *= Number(n.style.opacity);
    rest *= own;
    hovered *= ownHover ?? own;
    const bg = n.style.background || n.style.backgroundColor;
    const c = bg ? parse(bg) : null;
    if (c) { backs.push(c); if (c[3] === 1) break; }
  }
  if (!fg || !backs.length) throw new Error("no colour or background found");
  let bg = backs[backs.length - 1];
  for (let i = backs.length - 2; i >= 0; i--) bg = over(backs[i], backs[i][3], bg); // tints over the opaque one
  return { rest: ratio(over(fg, rest, bg), bg), hovered: ratio(over(fg, hovered, bg), bg) };
}

const item = (id: string, name: string, startDate: string): StoredRecurring => ({ id, name, emoji: "•", amount: 100, currency: "USD", frequency: "monthly",
  bucket: "NEEDS", startDate, endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z" });
// Rent: September's cycle confirmed, October's due on the 20th (not overdue, jade). Gym: unpaid since August (overdue, coral).
const RENT = item("r-rent", "Rent", "2026-09-20");
const GYM = item("r-gym", "Gym", "2026-08-01");
const PAID: StoredTransaction = { id: "t-sep", amount: 100, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-09-20", paymentMethod: "card",
  createdAt: "2026-09-20T09:00:00.000Z", recurringId: "r-rent", cycleDate: "2026-09-20" } as StoredTransaction;
const DATA = { ...DEFAULT_DATA, income: 3000, recurring: [RENT, GYM], transactions: [PAID] } as LocalFinancials;

async function rowsIn(theme: ThemeKey) {
  localStorage.setItem("essa_theme", theme);
  render(<ThemeProvider><InputPanel financials={DATA} dashData={computeDashboard(DATA)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} onConfirmRecurring={vi.fn()} /></ThemeProvider>);
  await waitFor(() => expect(document.querySelector('[style*="background"]')).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
  fireEvent.click(screen.getByRole("button", { name: /Recurring Payments/ }));
  const confirmRent = screen.getByRole("button", { name: "Confirm this Rent payment" });
  const confirmGym = screen.getByRole("button", { name: "Confirm this Gym payment" });
  const extraRent = confirmRent.parentElement!.querySelector<HTMLElement>('button[aria-label="Log an extra payment"]')!;
  return { confirmRent, confirmGym, extraRent };
}

const AA = 4.5;
const fmt = (r: { rest: number; hovered: number }) => `at rest ${r.rest.toFixed(2)}, hovered ${r.hovered.toFixed(2)}`;

describe.each(Object.keys(THEMES) as ThemeKey[])("%s", (theme) => {
  it("\"Confirm\" on a row that's due reaches 4.5:1, at rest and hovered", async () => {
    const { confirmRent } = await rowsIn(theme);
    expect(confirmRent.textContent).toBe("Confirm");
    const r = shownContrast(confirmRent);
    expect(Math.min(r.rest, r.hovered), fmt(r)).toBeGreaterThanOrEqual(AA);
  });

  it("\"Confirm\" on an overdue row (coral) reaches 4.5:1, at rest and hovered", async () => {
    const { confirmGym } = await rowsIn(theme);
    expect(confirmGym.textContent).toBe("Confirm");
    const r = shownContrast(confirmGym);
    expect(Math.min(r.rest, r.hovered), fmt(r)).toBeGreaterThanOrEqual(AA);
  });

  it("\"+extra\" reaches 4.5:1, at rest and hovered", async () => {
    const { extraRent } = await rowsIn(theme);
    expect(extraRent.textContent).toBe("+extra");
    const r = shownContrast(extraRent);
    expect(Math.min(r.rest, r.hovered), fmt(r)).toBeGreaterThanOrEqual(AA);
  });
});

it("the premise: Gym is overdue (its Confirm is coral) and Rent is not (jade)", async () => {
  const { confirmRent, confirmGym } = await rowsIn("ivory" as ThemeKey);
  expect(parse(confirmGym.style.color)).not.toEqual(parse(confirmRent.style.color));
  expect(screen.getByText(/overdue/i)).toBeTruthy();
});
