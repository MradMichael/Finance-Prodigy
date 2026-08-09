"use client";

import { useTheme } from "../../contexts/ThemeContext";
import { NAV, type Screen } from "../screens/shared";

export default function BottomNav({ screen, setScreen }: { screen: Screen; setScreen: (s: Screen) => void }) {
  const T = useTheme();
  return (
    <nav
      className="md:hidden flex items-center px-1 py-2 flex-shrink-0 overflow-x-auto"
      style={{ background: T.panel, borderTop: `1px solid ${T.line}`, scrollbarWidth: "none" }}
    >
      {NAV.map(({ key, label, icon }) => {
        const active = screen === key;
        return (
          <button
            key={key}
            onClick={() => setScreen(key)}
            aria-current={active ? "page" : undefined}
            className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl transition-all flex-shrink-0"
            style={{ color: active ? T.brass : T.mute }}
          >
            <span className="text-base leading-none">{icon}</span>
            <span className="text-[9px] font-medium whitespace-nowrap">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
