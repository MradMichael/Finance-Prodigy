"use client";

import { useState } from "react";
import type { LocalFinancials } from "../../lib/localData";
import { allCategories, categoryLabel, categoryIcon, monthlyEquivalent, toUSD as toUSDShared } from "../../lib/localData";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, money } from "./shared";
import { Label, FocusInput, PrimaryBtn } from "../form/Primitives";
import Donut from "../charts/Donut";

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "category";
}

export default function CategoriesScreen({
  financials,
  onChange,
}: {
  financials: LocalFinancials;
  onChange: (f: LocalFinancials) => void;
}) {
  const T = useTheme();
  const [newIcon, setNewIcon] = useState("🏷️");
  const [newName, setNewName] = useState("");
  const [scope, setScope] = useState<"month" | "all">("all");

  const customCategories = financials.customCategories ?? [];
  const lbpRate = financials.lbpRate ?? 89500;
  const toUSD = (n: number, cur?: string) => toUSDShared(n, cur as "USD" | "LBP" | undefined, lbpRate);

  function addCategory() {
    const name = newName.trim();
    if (!name) return;
    // "uncategorized" is reserved -- TransactionsScreen/this screen use it as
    // the synthetic grouping key for spend with no category set.
    const taken = new Set(["uncategorized", ...allCategories(customCategories).map((c) => c.value)]);
    const base = slugify(name);
    let value = base, n = 2;
    while (taken.has(value)) { value = `${base}-${n}`; n++; }
    onChange({ ...financials, customCategories: [...customCategories, { value, label: name, icon: newIcon.trim() || "🏷️" }] });
    setNewName("");
    setNewIcon("🏷️");
  }

  function deleteCategory(value: string) {
    if (!confirm("Delete this category? Transactions and recurring items already using it will keep showing its name, but you won't be able to pick it for new ones.")) return;
    onChange({ ...financials, customCategories: customCategories.filter((c) => c.value !== value) });
  }

  // Same categoryBreakdown aggregation TransactionsScreen's "By category"
  // donut uses: INCOME excluded, recurring blended in only for "this month"
  // (summing a recurring item across all of history is a different, fuzzier
  // question than "what did this month cost").
  const currentYm = new Date().toISOString().slice(0, 7);
  const txInScope = scope === "month" ? financials.transactions.filter((t) => t.date.startsWith(currentYm)) : financials.transactions;
  const totals = new Map<string, number>();
  const bump = (key: string, amt: number) => totals.set(key, (totals.get(key) ?? 0) + amt);
  for (const t of txInScope) {
    if (t.bucket === "INCOME") continue;
    bump(t.category ?? "uncategorized", toUSD(t.amount, t.currency));
  }
  if (scope === "month") {
    for (const r of financials.recurring ?? []) {
      const amt = toUSD(monthlyEquivalent(r), r.currency);
      if (amt > 0) bump(r.category ?? "uncategorized", amt);
    }
  }
  const breakdown = Array.from(totals.entries()).map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
  const breakdownTotal = breakdown.reduce((s, c) => s + c.value, 0);
  const colors = [T.jade, T.brass, T.sky, T.coral, T.jade + "80", T.brass + "80", T.sky + "80", T.coral + "80", T.mute];

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Categories</h1>
        </div>

        {/* Add category */}
        <div className="rounded-2xl p-5 space-y-3" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.mute }}>Add a category</p>
          <div className="flex gap-2">
            <div style={{ width: 68 }}>
              <Label htmlFor="new-cat-icon">Emoji</Label>
              <FocusInput id="new-cat-icon" value={newIcon} onChange={(e) => setNewIcon(e.target.value)} />
            </div>
            <div className="flex-1">
              <Label htmlFor="new-cat-name">Name</Label>
              <FocusInput
                id="new-cat-name" value={newName} placeholder="Pet care…"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCategory()}
              />
            </div>
          </div>
          <PrimaryBtn onClick={addCategory} color={T.brass} disabled={!newName.trim()}>+ Add category</PrimaryBtn>
        </div>

        {/* Custom category list */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-3" style={{ color: T.mute }}>Your categories</p>
          {customCategories.length === 0 ? (
            <p className="text-sm" style={{ color: T.mute }}>No custom categories yet — add one above to track spending your own way, alongside the built-in ones.</p>
          ) : (
            <div className="space-y-2">
              {customCategories.map((c) => (
                <div
                  key={c.value}
                  className="flex items-center justify-between gap-2 rounded-xl px-3 py-2"
                  style={{ background: T.panelSoft, border: `1px solid ${T.line}` }}
                >
                  <span className="text-sm" style={{ color: T.text }}>{c.icon} {c.label}</span>
                  <button
                    onClick={() => deleteCategory(c.value)}
                    aria-label={`Delete ${c.label} category`}
                    className="text-xs transition-all hover:opacity-70"
                    style={{ color: T.coral }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Spend-by-category monitoring */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: T.mute }}>Spend by category</p>
            <div className="flex gap-1.5">
              {(["month", "all"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: scope === s ? T.brass + "22" : T.panelSoft,
                    border: `1px solid ${scope === s ? T.brass : T.line}`,
                    color: scope === s ? T.brass : T.mute,
                  }}
                >
                  {s === "month" ? "This month" : "All time"}
                </button>
              ))}
            </div>
          </div>
          {breakdownTotal === 0 ? (
            <p className="text-sm" style={{ color: T.mute }}>No categorized spending yet.</p>
          ) : (
            <div className="flex items-center gap-6 flex-wrap">
              <Donut
                segments={breakdown.map((c, i) => ({ value: c.value, color: colors[i % colors.length], label: categoryLabel(c.key, customCategories) }))}
                trackColor={T.line}
                labelColor={T.text}
                centerLabel={money(breakdownTotal)}
                centerSublabel={scope === "month" ? "this month" : "all time"}
              />
              <div className="flex-1 min-w-[160px] space-y-2.5">
                {breakdown.map((c, i) => (
                  <div key={c.key} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2" style={{ color: T.text }}>
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colors[i % colors.length] }} />
                      {categoryIcon(c.key, customCategories)} {categoryLabel(c.key, customCategories)}
                    </span>
                    <span style={{ color: T.mute }}>
                      {money(c.value)} <span style={{ color: T.text }}>· {breakdownTotal > 0 ? Math.round((c.value / breakdownTotal) * 100) : 0}%</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
