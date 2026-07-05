import type { CSSProperties } from "react";

export type SyncStatus = "idle" | "syncing" | "synced" | "offline";

export type Screen = "overview" | "budget" | "setup" | "finances" | "transactions" | "goals" | "debts" | "recurring";

export const NAV: { key: Screen; label: string; icon: string }[] = [
  { key: "overview",     label: "Overview",     icon: "◉" },
  { key: "budget",       label: "Budget",       icon: "◫" },
  { key: "setup",        label: "Setup",        icon: "⚙" },
  { key: "finances",     label: "My Finances",  icon: "✎" },
  { key: "transactions", label: "Transactions", icon: "≡" },
  { key: "goals",        label: "Goals",        icon: "◎" },
  { key: "debts",        label: "Debts",        icon: "⌁" },
  { key: "recurring",    label: "Recurring",    icon: "↻" },
];

export const SERIF: CSSProperties = { fontFamily: "Spectral, Georgia, serif" };
export const NUMS:  CSSProperties = { fontVariantNumeric: "tabular-nums" };
export const money  = (n: number, d = 0) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: d }).format(n);
