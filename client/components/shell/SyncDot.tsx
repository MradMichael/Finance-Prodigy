"use client";

import { useTheme } from "../../contexts/ThemeContext";
import type { SyncStatus } from "../screens/shared";

export default function SyncDot({ status }: { status: SyncStatus }) {
  const T = useTheme();
  if (status === "idle") return null;
  const cfg = {
    syncing: { color: T.brass,  label: "Syncing…",  animate: true  },
    synced:  { color: T.jade,   label: "Synced",     animate: false },
    offline: { color: T.mute,   label: "Offline",    animate: false },
  }[status];
  return (
    <span
      className="flex items-center gap-1"
      title={cfg.label}
      style={{ color: cfg.color }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{
          background: cfg.color,
          animation: cfg.animate ? "essa-spin 1s linear infinite" : undefined,
        }}
      />
    </span>
  );
}
