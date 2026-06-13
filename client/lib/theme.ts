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

export const THEMES: Record<ThemeKey, ThemeColors & { name: string; desc: string }> = {
  ledger: {
    name: "Ledger", desc: "Forest green — the classic",
    ...build({
      ink: "#0B1F1E", panel: "#11302C", panelSoft: "#16403A", line: "#1E4A43",
      text: "#EAF2EF", mute: "#8FAFA7",
      brass: "#E3B341", jade: "#4FD1A5", coral: "#F08A7E", sky: "#7FB8D8",
    }),
  },
  midnight: {
    name: "Midnight", desc: "Navy blue — Wall Street",
    ...build({
      ink: "#070B1E", panel: "#0C1230", panelSoft: "#111840", line: "#192450",
      text: "#E4E8F8", mute: "#7080B0",
      brass: "#F0C040", jade: "#58AEFF", coral: "#FF7070", sky: "#80C8FF",
    }),
  },
  obsidian: {
    name: "Obsidian", desc: "Warm black — premium",
    ...build({
      ink: "#13110F", panel: "#1C1A17", panelSoft: "#242220", line: "#323028",
      text: "#F0EDE8", mute: "#90887E",
      brass: "#FFB820", jade: "#2DCA6A", coral: "#FF4848", sky: "#50C8FF",
    }),
  },
  aurora: {
    name: "Aurora", desc: "Vivid violet — electric",
    ...build({
      ink: "#0C0818", panel: "#130F28", panelSoft: "#1A1534", line: "#261F48",
      text: "#F2EEFF", mute: "#8878C0",
      brass: "#F5C040", jade: "#B060FF", coral: "#FF4488", sky: "#60C8FF",
    }),
  },
  ember: {
    name: "Ember", desc: "Flame orange — bold",
    ...build({
      ink: "#180A00", panel: "#221200", panelSoft: "#2C1800", line: "#3C2400",
      text: "#FFF4EC", mute: "#A07050",
      brass: "#FFCC20", jade: "#FF7820", coral: "#FF3838", sky: "#FFA860",
    }),
  },
  ivory: {
    name: "Ivory", desc: "Clean white — light mode",
    ...build({
      ink: "#F5F1EB", panel: "#EDE8E1", panelSoft: "#E3DDD6", line: "#CDC7BF",
      text: "#1A1510", mute: "#7A7068",
      brass: "#996600", jade: "#007848", coral: "#CC2828", sky: "#2268A0",
    }),
  },
};

const KEY = "essa_theme";

export function getStoredTheme(): ThemeKey {
  if (typeof window === "undefined") return "ledger";
  const v = localStorage.getItem(KEY);
  return (v && v in THEMES) ? v as ThemeKey : "ledger";
}

export function setStoredTheme(k: ThemeKey) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, k);
}

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('essa_theme')||'ledger';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
