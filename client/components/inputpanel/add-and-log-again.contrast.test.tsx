// Item 2 (owner, session 58): My Finances' "+add" on a goal and the "Log again" pill reach 4.5:1 in all six themes
// (WCAG 2.2 AA, 1.4.3). Both are 10 px jade text, and both were faded to 70% (the goal's control row; the pill's own
// button): 3.32:1 in Ivory, found by axe in session 57. The tokens themselves pass at full strength
// (lib/theme.contrast.test.ts); the fading took them under. Here each is rendered in each theme and the contrast is
// computed as the browser composites it: the text colour, faded by every opacity on the way up (an `opacity-NN`
// class or an inline opacity), over the nearest background. jsdom does no layout, so this is the arithmetic; the
// live check runs axe at 390 and 1280.
//
// TODO 133 (owner, session 66, item 2; AUDIT 2.4.179): both are checked hovered too. "+add" kept an 80% hover fade, and
// hovered it fell to 4.07 in Ivory and 4.30 in Aurora. Session 65's arithmetic (recurring-row.contrast.test.tsx): a
// hovered button's ancestors are hovered too, and an element's `hover:opacity-*` replaces its own resting opacity.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import InputPanel from "../InputPanel";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { THEMES, type ThemeKey } from "../../lib/theme";
import { computeDashboard } from "../../lib/computeDashboard";
import { DEFAULT_DATA, todayISO, type LocalFinancials, type StoredGoal, type StoredTransaction } from "../../lib/localData";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }) }));
afterEach(() => { cleanup(); localStorage.clear(); });

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

/**
 * The contrast an element's text shows, the lower of at rest and hovered: its colour, faded by every opacity above it,
 * over the nearest background.
 */
function shownContrast(el: HTMLElement): number {
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
  return Math.min(ratio(over(fg, rest, bg), bg), ratio(over(fg, hovered, bg), bg));
}

const GOAL: StoredGoal = { id: "g1", name: "Laptop", emoji: "L", targetAmount: 1500, currentAmount: 0, openingAmount: 0, currency: "USD", targetDate: "2027-12-31", createdAt: "2026-01-01T00:00:00.000Z" };
const ENTRY = { id: "t1", amount: 12, currency: "USD", bucket: "NEEDS", description: "Bread", date: todayISO(), paymentMethod: "cash", createdAt: "2026-11-01T09:00:00.000Z" } as StoredTransaction;
const DATA = { ...DEFAULT_DATA, income: 3000, goals: [GOAL], transactions: [ENTRY] } as LocalFinancials;

async function openIn(theme: ThemeKey) {
  localStorage.setItem("essa_theme", theme);
  render(<ThemeProvider><InputPanel financials={DATA} dashData={computeDashboard(DATA)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} /></ThemeProvider>);
  await waitFor(() => expect(document.querySelector('[style*="background"]')).toBeTruthy());
}

describe.each(Object.keys(THEMES) as ThemeKey[])("%s", (theme) => {
  it("\"Log again\" on this month's row reaches 4.5:1, at rest and hovered", async () => {
    await openIn(theme);
    const pill = screen.getByRole("button", { name: "Log again: Bread" }).querySelector("span")!;
    const r = shownContrast(pill);
    expect(r, `${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  });

  it("\"+add\" on a goal reaches 4.5:1, at rest and hovered", async () => {
    await openIn(theme);
    fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
    fireEvent.click(screen.getByRole("button", { name: /Goals/ }));
    const add = screen.getByRole("button", { name: "Add to this goal" });
    const r = shownContrast(add);
    expect(r, `${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  });
});

it("the premise: the theme really changes (Ivory's jade differs from Ledger's)", () => {
  expect(THEMES.ivory.jade).not.toBe(THEMES.ledger.jade);
});
