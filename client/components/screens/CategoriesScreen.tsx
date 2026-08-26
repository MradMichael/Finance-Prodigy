"use client";

import { useState } from "react";
import type { LocalFinancials, CategoryRule } from "../../lib/localData";
import { CATEGORIES, allCategories, categoryLabel, categoryIcon, matchCategoryRule, historizedRecurringContribution, toUSD as toUSDShared, uid, todayISO, moneyEquals, activeTransactions, DEFAULT_LBP_RATE } from "../../lib/localData";
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
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [editIcon, setEditIcon] = useState("");
  const [editName, setEditName] = useState("");
  const [ruleKeyword, setRuleKeyword] = useState("");
  const [ruleCategory, setRuleCategory] = useState("");

  const customCategories = financials.customCategories ?? [];
  const categoryRules = financials.categoryRules ?? [];
  const lbpRate = financials.lbpRate ?? DEFAULT_LBP_RATE;
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

  function startEdit(c: { value: string; label: string; icon: string }) {
    setEditingValue(c.value);
    setEditIcon(c.icon);
    setEditName(c.label);
  }

  // Renaming only ever touches label/icon, never `value` -- value is the key
  // every existing transaction/recurring item's `category` field points at,
  // so changing it would orphan every past reference instead of relabeling them.
  function saveEdit() {
    const name = editName.trim();
    if (!name || !editingValue) return;
    onChange({
      ...financials,
      customCategories: customCategories.map((c) =>
        c.value !== editingValue ? c : { ...c, label: name, icon: editIcon.trim() || "🏷️" }
      ),
    });
    setEditingValue(null);
  }

  function addRule() {
    const keyword = ruleKeyword.trim();
    if (!keyword || !ruleCategory) return;
    onChange({ ...financials, categoryRules: [...categoryRules, { id: uid(), keyword, category: ruleCategory }] });
    setRuleKeyword("");
    setRuleCategory("");
  }

  function deleteRule(id: string) {
    onChange({ ...financials, categoryRules: categoryRules.filter((r) => r.id !== id) });
  }

  // Retroactively applies one rule to already-logged transactions/recurring
  // items -- "if null only" still holds (matchCategoryRule is never even
  // called for an entry that already has a category), so this only ever
  // fills gaps, never overwrites a manual choice.
  function applyRuleToExisting(rule: CategoryRule) {
    let count = 0;
    const updatedTx = financials.transactions.map((t) => {
      if (t.category) return t;
      const match = matchCategoryRule(t.description, [rule]);
      if (!match) return t;
      count++;
      return { ...t, category: match };
    });
    const updatedRecurring = (financials.recurring ?? []).map((r) => {
      if (r.category) return r;
      const match = matchCategoryRule(r.name, [rule]);
      if (!match) return r;
      count++;
      return { ...r, category: match };
    });
    if (count === 0) { alert(`No uncategorized entries matched "${rule.keyword}".`); return; }
    onChange({ ...financials, transactions: updatedTx, recurring: updatedRecurring });
    alert(`Categorized ${count} existing entr${count === 1 ? "y" : "ies"}.`);
  }

  // Same categoryBreakdown aggregation TransactionsScreen's "By category"
  // donut uses: INCOME excluded, recurring blended in only for "this month"
  // (summing a recurring item across all of history is a different, fuzzier
  // question than "what did this month cost").
  const currentYm = todayISO().slice(0, 7);
  // Phase 2.6.3b: excludes soft-deleted transactions from the category
  // breakdown, same as every other total.
  const activeTx = activeTransactions(financials.transactions);
  const txInScope = scope === "month" ? activeTx.filter((t) => t.date.startsWith(currentYm)) : activeTx;
  const totals = new Map<string, number>();
  const bump = (key: string, amt: number) => totals.set(key, (totals.get(key) ?? 0) + amt);
  for (const t of txInScope) {
    if (t.bucket === "INCOME") continue;
    bump(t.category ?? "uncategorized", toUSD(t.amount, t.currency));
  }
  if (scope === "month") {
    for (const r of financials.recurring ?? []) {
      const amt = toUSD(historizedRecurringContribution(r, currentYm, new Date()), r.currency);
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
              {customCategories.map((c) =>
                editingValue === c.value ? (
                  <div key={c.value} className="rounded-xl p-3 space-y-2.5" style={{ background: T.panelSoft, border: `1px solid ${T.jade}50` }}>
                    <div className="flex gap-2">
                      <div style={{ width: 68 }}>
                        <Label htmlFor="edit-cat-icon">Emoji</Label>
                        <FocusInput id="edit-cat-icon" value={editIcon} onChange={(e) => setEditIcon(e.target.value)} />
                      </div>
                      <div className="flex-1">
                        <Label htmlFor="edit-cat-name">Name</Label>
                        <FocusInput
                          id="edit-cat-name" value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveEdit} disabled={!editName.trim()} className="px-3 py-1.5 rounded-xl text-xs font-semibold hover:opacity-90 disabled:opacity-40" style={{ background: T.jade, color: T.ink }}>Save</button>
                      <button onClick={() => setEditingValue(null)} className="px-3 py-1.5 rounded-xl text-xs hover:opacity-70" style={{ color: T.mute }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div
                    key={c.value}
                    className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 group"
                    style={{ background: T.panelSoft, border: `1px solid ${T.line}` }}
                  >
                    <span className="text-sm" style={{ color: T.text }}>{c.icon} {c.label}</span>
                    <div className="flex gap-1.5 opacity-70 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={() => startEdit(c)}
                        aria-label={`Edit ${c.label} category`}
                        className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                        style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
                      >✎</button>
                      <button
                        onClick={() => deleteCategory(c.value)}
                        aria-label={`Delete ${c.label} category`}
                        className="text-xs px-1"
                        style={{ color: T.coral }}
                      >✕</button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>

        {/* Built-in categories -- always available, can't be edited/removed;
            shown so it's obvious what already exists before adding a custom
            one that might just duplicate it. */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-3" style={{ color: T.mute }}>Built-in categories</p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <span
                key={c.value}
                className="text-sm px-3 py-1.5 rounded-xl"
                style={{ background: T.panelSoft, color: T.mute, border: `1px solid ${T.line}` }}
              >
                {c.icon} {c.label}
              </span>
            ))}
          </div>
        </div>

        {/* Auto-categorize by keyword */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: T.mute }}>Auto-categorize by keyword</p>
          <p className="text-[11px] mb-3" style={{ color: T.mute }}>
            When a transaction&apos;s description contains a keyword below, its category fills in automatically — only if you haven&apos;t already picked one yourself.
          </p>
          <div className="flex gap-2 mb-3">
            <div className="flex-1">
              <Label htmlFor="rule-keyword">Keyword</Label>
              <FocusInput
                id="rule-keyword" value={ruleKeyword} placeholder="Spinneys, Netflix, Uber…"
                onChange={(e) => setRuleKeyword(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="rule-category">Category</Label>
              <select
                id="rule-category"
                value={ruleCategory}
                onChange={(e) => setRuleCategory(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm"
                style={{ background: T.panelSoft, border: `1px solid ${T.line}`, color: T.text, outline: "none", colorScheme: "dark" }}
              >
                <option value="">Choose…</option>
                {allCategories(customCategories).map((c) => (
                  <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                ))}
              </select>
            </div>
          </div>
          <PrimaryBtn onClick={addRule} color={T.brass} disabled={!ruleKeyword.trim() || !ruleCategory}>+ Add rule</PrimaryBtn>

          {categoryRules.length > 0 && (
            <div className="space-y-2 mt-4">
              {categoryRules.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-xl px-3 py-2"
                  style={{ background: T.panelSoft, border: `1px solid ${T.line}` }}
                >
                  <span className="text-sm min-w-0 truncate" style={{ color: T.text }}>
                    <span style={{ color: T.mute }}>&quot;{r.keyword}&quot;</span> → {categoryIcon(r.category, customCategories)} {categoryLabel(r.category, customCategories)}
                  </span>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => applyRuleToExisting(r)}
                      title="Apply to existing uncategorized transactions and recurring items"
                      className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                      style={{ color: T.jade, border: `1px solid ${T.jade}40` }}
                    >Apply to past</button>
                    <button
                      onClick={() => deleteRule(r.id)}
                      aria-label={`Delete rule for ${r.keyword}`}
                      className="text-xs px-1"
                      style={{ color: T.coral }}
                    >✕</button>
                  </div>
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
          {moneyEquals(breakdownTotal, 0) ? (
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
