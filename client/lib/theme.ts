export type ThemeKey = "ledger" | "midnight" | "obsidian" | "aurora" | "ember" | "ivory";

export interface ThemeColors {
  // base
  ink: string; panel: string; panelSoft: string; line: string;
  text: string; mute: string;
  brass: string; jade: string; coral: string; sky: string;
  // pre-computed hex-alpha variants (append 2-char hex opacity)
  jade10: string; jade15: string; jade20: string; jade22: string;
  jade25: string; jade28: string; jade30: string;
  brass18: string; brass20: string; brass30: string; brass40: string;
  coral18: string; coral30: string; coral40: string;
}

interface Base {
  ink: string; panel: string; panelSoft: string; line: string;
  text: string; mute: string;
  brass: string; jade: string; coral: string; sky: string;
}

function build(c: Base): ThemeColors {
  const a = (h: string, x: string) => h + x;
  return {
    ...c,
    jade10:  a(c.jade,  "10"), jade15: a(c.jade,  "15"),
    jade20:  a(c.jade,  "20"), jade22: a(c.jade,  "22"),
    jade25:  a(c.jade,  "25"), jade28: a(c.jade,  "28"),
    jade30:  a(c.jade,  "30"),
    brass18: a(c.brass, "18"), brass20: a(c.brass, "20"),
    brass30: a(c.brass, "30"), brass40: a(c.brass, "40"),
    coral18: a(c.coral, "18"), coral30: a(c.coral, "30"),
    coral40: a(c.coral, "40"),
  };
}

// A11Y-01 (session 22; WCAG 2.2 AA, the owner's target): every text colour reaches 4.5:1 on each surface,
// as a button behind the ink label, and on its own tint as the chips use it (theme.contrast.test.ts). The
// failing tokens moved in lightness only, hue and saturation kept, by the least that passes; also, found by
// the live scan, any text colour on any accent's tint up to 0x22 (a selected card).
export const THEMES: Record<ThemeKey, ThemeColors & { name: string; desc: string }> = {
  ledger: {
    name: "Ledger", desc: "Forest green, the classic",
    ...build({
      ink: "#0B1F1E", panel: "#11302C", panelSoft: "#16403A", line: "#1E4A43",
      text: "#EAF2EF", mute: "#AAC2BC",
      brass: "#E8C165", jade: "#65D7B0", coral: "#F4AAA0", sky: "#93C3DE",
    }),
  },
  midnight: {
    name: "Midnight", desc: "Navy blue, Wall Street",
    ...build({
      ink: "#070B1E", panel: "#0C1230", panelSoft: "#111840", line: "#192450",
      text: "#E4E8F8", mute: "#8B99C0",
      brass: "#F0C040", jade: "#58AEFF", coral: "#FF7070", sky: "#80C8FF",
    }),
  },
  obsidian: {
    name: "Obsidian", desc: "Warm black, premium",
    ...build({
      ink: "#13110F", panel: "#1C1A17", panelSoft: "#242220", line: "#323028",
      text: "#F0EDE8", mute: "#A7A098",
      brass: "#FFB820", jade: "#2DCA6A", coral: "#FF7676", sky: "#50C8FF",
    }),
  },
  aurora: {
    name: "Aurora", desc: "Vivid violet, electric",
    ...build({
      ink: "#0C0818", panel: "#130F28", panelSoft: "#1A1534", line: "#261F48",
      text: "#F2EEFF", mute: "#9C8FCA",
      brass: "#F5C040", jade: "#BB77FF", coral: "#FF5B97", sky: "#60C8FF",
    }),
  },
  ember: {
    name: "Ember", desc: "Flame orange, bold",
    ...build({
      ink: "#180A00", panel: "#221200", panelSoft: "#2C1800", line: "#3C2400",
      text: "#FFF4EC", mute: "#BD957B",
      brass: "#FFCC20", jade: "#FF7820", coral: "#FF7070", sky: "#FFA860",
    }),
  },
  ivory: {
    name: "Ivory", desc: "Clean white, light mode",
    ...build({
      ink: "#F5F1EB", panel: "#EDE8E1", panelSoft: "#E3DDD6", line: "#CDC7BF",
      text: "#1A1510", mute: "#59524C",
      brass: "#6B4700", jade: "#005C37", coral: "#A11F1F", sky: "#1D5787",
    }),
  },
};

const KEY = "essa_theme";

export function getStoredTheme(): ThemeKey {
  if (typeof window === "undefined") return "ivory";
  const v = localStorage.getItem(KEY);
  return (v && v in THEMES) ? v as ThemeKey : "ivory";
}

export function setStoredTheme(k: ThemeKey) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, k);
}

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('essa_theme')||'ivory';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
