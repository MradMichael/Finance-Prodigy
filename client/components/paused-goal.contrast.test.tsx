// Item 1 (owner, session 59): a paused goal keeps its text at full strength; "paused" is shown by the card's existing
// badge alone. Both screens faded the whole card (My Finances' goals section to 65%, the Goals screen to 60%), so every
// text in it fell under 4.5:1 in every theme (axe in session 58, at 1280: "Paused" 2.4–3.0:1, the figures 2.7–3.8:1).
// Checked here in each of the six themes, on both screens: every text with a letter or digit in it (axe skips
// symbol-only glyphs such as ✎ and ▶) as the browser composites it (its colour, faded by every opacity above it, over
// the nearest background) reaches 4.5:1; and the badge is there. jsdom does no layout: this is the arithmetic; the live
// check runs axe at 390 and 1280.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import InputPanel from "./InputPanel";
import GoalsScreen from "./screens/GoalsScreen";
import { ThemeProvider } from "../contexts/ThemeContext";
import { THEMES, type ThemeKey } from "../lib/theme";
import { computeDashboard } from "../lib/computeDashboard";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal } from "../lib/localData";

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

/** The contrast an element's text shows: its colour (or the theme's text colour it inherits), faded by every opacity above it, over the nearest background. */
function shownContrast(el: HTMLElement, themeText: string): number {
  let fg: number[] | null = null;
  let alpha = 1;
  const backs: number[][] = [];
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (!fg && n.style.color) fg = parse(n.style.color);
    for (const cls of Array.from(n.classList)) { const m = /^opacity-(\d+)$/.exec(cls); if (m) alpha *= Number(m[1]) / 100; }
    if (n.style.opacity) alpha *= Number(n.style.opacity);
    const bg = n.style.background || n.style.backgroundColor;
    const c = bg ? parse(bg) : null;
    if (c) { backs.push(c); if (c[3] === 1) break; }
  }
  fg ??= parse(themeText) ?? [0, 0, 0, 1];
  if (!backs.length) throw new Error("no background found");
  let bg = backs[backs.length - 1];
  for (let i = backs.length - 2; i >= 0; i--) bg = over(backs[i], backs[i][3], bg);
  return ratio(over(fg, alpha, bg), bg);
}

/** Every element in `root` with text of its own that has a letter or a digit in it, outside SVG. */
function textElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("*")).filter((el) =>
    !(el instanceof SVGElement) && Array.from(el.childNodes).some((c) => c.nodeType === 3 && /[\p{L}\p{N}]/u.test(c.textContent ?? "")));
}
const hexToRgb = (h: string) => `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ")})`;

const PAUSED: StoredGoal = { id: "g1", name: "Laptop", emoji: "L", targetAmount: 1500, currentAmount: 0, openingAmount: 300, currency: "USD", targetDate: "2027-12-31", createdAt: "2026-01-01T00:00:00.000Z", pausedAt: "2026-10-01T00:00:00.000Z" };
const DATA = { ...DEFAULT_DATA, income: 3000, goals: [PAUSED], transactions: [] } as LocalFinancials;

function failing(card: HTMLElement, theme: ThemeKey): string[] {
  return textElements(card)
    .map((el) => ({ text: (el.textContent ?? "").trim().slice(0, 30), r: shownContrast(el, hexToRgb(THEMES[theme].text)) }))
    .filter((x) => x.r < 4.5)
    .map((x) => `"${x.text}" ${x.r.toFixed(2)}`);
}

describe.each(Object.keys(THEMES) as ThemeKey[])("%s", (theme) => {
  it("My Finances: a paused goal's card keeps every text at 4.5:1 or more, and says Paused", async () => {
    localStorage.setItem("essa_theme", theme);
    render(<ThemeProvider><InputPanel financials={DATA} dashData={computeDashboard(DATA)} onChange={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} /></ThemeProvider>);
    await waitFor(() => expect(document.querySelector('[style*="background"]')).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
    fireEvent.click(screen.getByRole("button", { name: /Goals/ }));
    const card = screen.getByRole("button", { name: "Resume goal" }).closest<HTMLElement>("div.rounded-xl")!;
    expect(card.textContent).toContain("Paused"); // the badge
    expect(failing(card, theme)).toEqual([]);
  });

  it("Goals: a paused goal's card keeps every text at 4.5:1 or more, and says paused", async () => {
    localStorage.setItem("essa_theme", theme);
    render(<ThemeProvider><GoalsScreen dashData={computeDashboard(DATA)} financials={DATA} onChange={vi.fn()} onEdit={vi.fn()} /></ThemeProvider>);
    await waitFor(() => expect(document.querySelector('[style*="background"]')).toBeTruthy());
    const card = screen.getByRole("button", { name: "Resume goal" }).closest<HTMLElement>("div.rounded-2xl")!;
    expect(card.textContent).toContain("paused"); // the status pill
    expect(failing(card, theme)).toEqual([]);
  });
});
