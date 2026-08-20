import type { CSSProperties } from "react";
import type { Currency } from "../../lib/localData";

export type SyncStatus = "idle" | "syncing" | "synced" | "offline";

export type Screen = "overview" | "budget" | "setup" | "finances" | "transactions" | "categories" | "goals" | "debts" | "recurring" | "projections" | "journey" | "currency" | "wishlist" | "statistics";

export const NAV: { key: Screen; label: string; icon: string }[] = [
  { key: "overview",     label: "Overview",     icon: "◉" },
  { key: "budget",       label: "Budget",       icon: "◫" },
  { key: "setup",        label: "Setup",        icon: "⚙" },
  { key: "finances",     label: "My Finances",  icon: "✎" },
  { key: "transactions", label: "Transactions", icon: "≡" },
  { key: "categories",   label: "Categories",   icon: "▦" },
  { key: "goals",        label: "Goals",        icon: "◎" },
  { key: "wishlist",     label: "Wishlist",     icon: "✧" },
  { key: "debts",        label: "Debts",        icon: "⌁" },
  { key: "recurring",    label: "Recurring",    icon: "↻" },
  { key: "projections",  label: "Projections",  icon: "↗" },
  { key: "statistics",   label: "Statistics",   icon: "▤" },
  { key: "journey",      label: "Journey",      icon: "✦" },
  { key: "currency",     label: "Currency",     icon: "⇄" },
];

export const SERIF: CSSProperties = { fontFamily: "Spectral, Georgia, serif" };
export const NUMS:  CSSProperties = { fontVariantNumeric: "tabular-nums" };
export const money  = (n: number, d = 0) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: d }).format(n);
/** A record's own amount in its own currency -- for a native-currency figure, not a cross-record USD total (use money() for those). */
export const fmtCur = (amt: number, cur: Currency) => cur === "LBP"
  ? `L£${amt.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
  : `$${amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
