"use client";

// InputPanel split, S13 (session 55): the two presentational pieces of My Finances' shell, moved here line for
// line: the month's three figures above the tabs, and the Daily / Manage tab bar. InputPanel is the shell that
// is left: it holds the forms' state, the toast and the lira dialog, and places the sections.
import { useTheme } from "../../contexts/ThemeContext";

/** Needs, Wants and Saved so far this cycle, already formatted. Shown only when an income is set (the caller decides). */
export function StatsStrip({ needs, wants, saved }: { needs: string; wants: string; saved: string }) {
  const T = useTheme();
  return (
    <div
      className="grid grid-cols-3 gap-px mx-0"
      style={{ background: T.line, borderBottom: `1px solid ${T.line}` }}
    >
      {[
        { label: "Needs", value: needs, color: T.sky   },
        { label: "Wants", value: wants, color: T.brass },
        { label: "Saved", value: saved,   color: T.jade  },
      ].map((s) => (
        <div key={s.label} className="flex flex-col items-center py-3" style={{ background: T.panelSoft }}>
          <span className="text-xs font-semibold tabular-nums" style={{ color: s.color }}>{s.value}</span>
          <span className="text-[9px] uppercase tracking-widest mt-0.5" style={{ color: T.mute }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

/** The Daily / Manage tabs. The Daily tab carries the count of this cycle's entries. */
export function TabBar({ activeTab, setActiveTab, dailyCount }: {
  activeTab: "daily" | "setup";
  setActiveTab: (t: "daily" | "setup") => void;
  dailyCount: number;
}) {
  const T = useTheme();
  return (
    <div className="flex flex-shrink-0" style={{ borderBottom: `1px solid ${T.line}` }}>
      {([
        { id: "daily" as const, label: "Daily",  icon: "⚡", badge: dailyCount },
        { id: "setup" as const, label: "Manage", icon: "⚙", badge: 0 },
      ]).map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          aria-pressed={activeTab === tab.id}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold transition-all"
          style={{
            color: activeTab === tab.id ? T.jade : T.mute,
            borderBottom: activeTab === tab.id ? `2px solid ${T.jade}` : "2px solid transparent",
            background: "transparent",
            marginBottom: -1,
          }}
        >
          <span>{tab.icon}</span>
          <span>{tab.label}</span>
          {tab.badge > 0 && (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded-full" style={{ background: T.jade + "28", color: T.jade }}>
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
