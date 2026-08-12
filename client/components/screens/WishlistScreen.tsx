"use client";

import { useState } from "react";
import type { LocalFinancials, WishlistItem, Currency, StoredGoal } from "../../lib/localData";
import { uid, toUSD as toUSDShared } from "../../lib/localData";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, money } from "./shared";
import { Label, FocusInput, MoneyInput, PrimaryBtn, CurrencyToggle } from "../form/Primitives";

const PRIORITIES: { value: WishlistItem["priority"]; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export default function WishlistScreen({
  financials,
  onChange,
}: {
  financials: LocalFinancials;
  onChange: (f: LocalFinancials) => void;
}) {
  const T = useTheme();
  const [emoji, setEmoji] = useState("✨");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [priority, setPriority] = useState<WishlistItem["priority"]>("medium");
  const [savedGoalIds, setSavedGoalIds] = useState<Record<string, boolean>>({});

  const lbpRate = financials.lbpRate ?? 89500;
  const toUSD = (n: number, cur?: string) => toUSDShared(n, cur as Currency | undefined, lbpRate);
  const wishlist = financials.wishlist ?? [];

  const priorityRank: Record<WishlistItem["priority"], number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...wishlist].sort((a, b) => {
    if (!!a.boughtAt !== !!b.boughtAt) return a.boughtAt ? 1 : -1; // bought sinks to the bottom
    if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority];
    return b.createdAt.localeCompare(a.createdAt);
  });
  const activeTotal = wishlist.filter((w) => !w.boughtAt).reduce((s, w) => s + toUSD(w.price, w.currency), 0);

  function addItem() {
    const trimmed = name.trim();
    const parsedPrice = parseFloat(price.replace(/,/g, ""));
    if (!trimmed || isNaN(parsedPrice) || parsedPrice <= 0) return;
    const item: WishlistItem = {
      id: uid(), name: trimmed, emoji: emoji || "✨", price: parsedPrice, currency, priority,
      createdAt: new Date().toISOString(),
    };
    onChange({ ...financials, wishlist: [...wishlist, item] });
    setName(""); setPrice(""); setEmoji("✨"); setPriority("medium");
  }

  function toggleBought(id: string) {
    onChange({
      ...financials,
      wishlist: wishlist.map((w) => w.id !== id ? w : { ...w, boughtAt: w.boughtAt ? undefined : new Date().toISOString() }),
    });
  }

  function deleteItem(id: string) {
    if (!confirm("Delete this wishlist item?")) return;
    onChange({ ...financials, wishlist: wishlist.filter((w) => w.id !== id) });
  }

  // Bridges to the existing Goals feature instead of reinventing savings-
  // toward-a-purchase tracking -- a wishlist item you're serious about
  // becomes a real goal (6 months out by default, editable like any other
  // goal afterward) with one click, in whatever it costs converted to USD
  // (goals have no currency field of their own -- see localData.ts).
  function saveTowardGoal(item: WishlistItem) {
    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() + 6);
    const goal: StoredGoal = {
      id: uid(), name: item.name, emoji: item.emoji,
      targetAmount: Math.round(toUSD(item.price, item.currency) * 100) / 100,
      currentAmount: 0,
      targetDate: targetDate.toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
    };
    onChange({ ...financials, goals: [...financials.goals, goal] });
    setSavedGoalIds((s) => ({ ...s, [item.id]: true }));
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">

        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Wishlist</h1>
          <p className="text-sm mt-2" style={{ color: T.mute }}>Things you want, before they become things you&apos;re saving for.</p>
        </div>

        {activeTotal > 0 && (
          <div className="rounded-2xl px-5 py-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>Wishlist total</p>
            <p className="text-2xl font-medium tabular-nums mt-0.5" style={{ ...SERIF, color: T.text }}>{money(activeTotal)}</p>
          </div>
        )}

        {/* Add item */}
        <div className="rounded-2xl p-5 space-y-3" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.mute }}>Add to wishlist</p>
          <div className="flex gap-2">
            <div style={{ width: 68 }}>
              <Label htmlFor="wish-emoji">Emoji</Label>
              <FocusInput id="wish-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
            </div>
            <div className="flex-1">
              <Label htmlFor="wish-name">Name</Label>
              <FocusInput id="wish-name" value={name} placeholder="Noise-cancelling headphones…" onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="wish-price">Price</Label>
              <MoneyInput id="wish-price" value={price} onChange={setPrice} placeholder="0" />
            </div>
            <div>
              <Label>Currency</Label>
              <CurrencyToggle value={currency} onChange={setCurrency} />
            </div>
          </div>
          <div>
            <Label>Priority</Label>
            <div className="grid grid-cols-3 gap-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPriority(p.value)}
                  aria-pressed={priority === p.value}
                  className="py-2 rounded-xl text-xs font-medium transition-all"
                  style={{
                    background: priority === p.value ? T.jade + "22" : T.panelSoft,
                    border: `1px solid ${priority === p.value ? T.jade : T.line}`,
                    color: priority === p.value ? T.jade : T.mute,
                  }}
                >{p.label}</button>
              ))}
            </div>
          </div>
          <PrimaryBtn onClick={addItem} color={T.brass} disabled={!name.trim() || !price}>+ Add to wishlist</PrimaryBtn>
        </div>

        {/* List */}
        {sorted.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-2xl mb-2">✨</p>
            <p className="text-sm" style={{ color: T.mute }}>Nothing on your wishlist yet.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {sorted.map((w) => {
              const priorityColor = w.priority === "high" ? T.coral : w.priority === "medium" ? T.brass : T.mute;
              return (
                <div
                  key={w.id}
                  className="rounded-2xl px-4 py-3.5"
                  style={{ background: T.panel, border: `1px solid ${T.line}`, opacity: w.boughtAt ? 0.55 : 1 }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm flex items-center gap-1.5 flex-wrap" style={{ color: T.text }}>
                        {w.emoji} {w.name}
                        {w.boughtAt ? (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: T.jade + "22", color: T.jade }}>Bought</span>
                        ) : (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ border: `1px solid ${priorityColor}`, color: priorityColor }}>{w.priority}</span>
                        )}
                      </p>
                      <p className="text-xs mt-1 tabular-nums" style={{ color: T.mute }}>
                        {w.currency === "LBP" ? `L£${w.price.toLocaleString()}` : money(w.price)}
                        {w.currency === "LBP" && ` · ${money(toUSD(w.price, w.currency))}`}
                      </p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      {!w.boughtAt && (
                        <button
                          onClick={() => saveTowardGoal(w)}
                          disabled={savedGoalIds[w.id]}
                          title="Create a savings goal for this item"
                          className="text-[10px] px-2 py-1 rounded-full transition-all hover:opacity-80 disabled:opacity-40"
                          style={{ background: T.jade + "18", color: T.jade }}
                        >{savedGoalIds[w.id] ? "Goal added ✓" : "Save toward this"}</button>
                      )}
                      <button
                        onClick={() => toggleBought(w.id)}
                        aria-label={w.boughtAt ? "Mark as not bought" : "Mark as bought"}
                        className="text-[10px] px-1.5 py-1 rounded transition-all hover:opacity-80"
                        style={{ color: T.mute, border: `1px solid ${T.mute}40` }}
                      >{w.boughtAt ? "↺" : "✓"}</button>
                      <button
                        onClick={() => deleteItem(w.id)}
                        aria-label={`Delete ${w.name} from wishlist`}
                        className="text-xs px-1"
                        style={{ color: T.coral }}
                      >✕</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </main>
  );
}
