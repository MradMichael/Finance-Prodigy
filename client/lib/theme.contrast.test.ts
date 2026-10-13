// A11Y-01 (blind-spot audit; owner, session 22: the target is WCAG 2.2 AA).
// Text must reach 4.5:1 against what it sits on (1.4.3). The default ivory
// theme's secondary text (mute) and gold (brass) didn't, nor ember's mute, and
// a few pairs elsewhere. Checked here from the tokens themselves, for every
// theme: each text colour on each surface; the dark label on the coloured
// buttons (jade, brass, coral); and an accent on its own tint over each
// surface, at the strongest tint the app sets it on (jade 0x2A, brass 0x30,
// coral 0x18: the chips and selected states).
import { describe, it, expect } from "vitest";
import { THEMES, type ThemeKey } from "./theme";

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const channel = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (a: number[], b: number[]) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** `fg` at `alpha` (0–1) over `bg`, as the browser composites it. */
const over = (fg: number[], alpha: number, bg: number[]) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

const TEXT = ["text", "mute", "brass", "jade", "coral", "sky"] as const;
const SURFACES = ["ink", "panel", "panelSoft"] as const;
const BUTTONS = ["jade", "brass", "coral"] as const;
const CHIPS = { jade: 0x2a, brass: 0x30, coral: 0x18 } as const;
const AA = 4.5;

describe.each(Object.keys(THEMES) as ThemeKey[])("%s", (key) => {
  const t = THEMES[key];
  it("every text colour reaches 4.5:1 on every surface", () => {
    const failing = TEXT.flatMap((fg) => SURFACES.map((bg) => ({ pair: `${fg} on ${bg}`, r: ratio(rgb(t[fg]), rgb(t[bg])) }))).filter((p) => p.r < AA);
    expect(failing.map((p) => `${p.pair} ${p.r.toFixed(2)}`)).toEqual([]);
  });
  it("the dark label on a coloured button reaches 4.5:1", () => {
    const failing = BUTTONS.map((bg) => ({ pair: `ink on ${bg}`, r: ratio(rgb(t.ink), rgb(t[bg])) })).filter((p) => p.r < AA);
    expect(failing.map((p) => `${p.pair} ${p.r.toFixed(2)}`)).toEqual([]);
  });
  it("an accent on its own tint, as strong as the app sets it, reaches 4.5:1 over every surface", () => {
    const failing = (Object.entries(CHIPS) as [keyof typeof CHIPS, number][]).flatMap(([fg, a]) => SURFACES.map((bg) => ({ pair: `${fg} on its ${a.toString(16)} tint over ${bg}`, r: ratio(rgb(t[fg]), over(rgb(t[fg]), a / 255, rgb(t[bg]))) }))).filter((p) => p.r < AA);
    expect(failing.map((p) => `${p.pair} ${p.r.toFixed(2)}`)).toEqual([]);
  });
});
