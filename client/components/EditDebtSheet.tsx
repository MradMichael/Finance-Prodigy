"use client";

import { useState } from "react";
import type { LocalFinancials, StoredDebt } from "../lib/localData";
import { derivedDebtBalance, buildDebtAdjustmentTx, roundMoney } from "../lib/localData";
import { useTheme } from "../contexts/ThemeContext";
import { Label, FocusInput, MoneyInput, DateFieldDMY } from "./form/Primitives";

/**
 * Shared edit surface for a debt -- opened from InputPanel's Manage tab and
 * from DebtsScreen alike, so there is exactly one implementation of "what
 * editing a debt looks like," not one per screen (the same duplication shape
 * that has already produced five real bugs in this codebase: recurring
 * display, goal-contribution logic, LBP formatters -- see docs/AUDIT_2026-08.md).
 * Ported verbatim from InputPanel's former inline edit-debt form (Phase 2.6.4
 * step 3's commitDebtBalance mechanic included) -- no logic changed, only
 * relocated.
 */
export default function EditDebtSheet({
  debt, financials, onChange, onClose,
}: {
  debt: StoredDebt;
  financials: LocalFinancials;
  onChange: (updated: LocalFinancials) => void;
  onClose: () => void;
}) {
  const T = useTheme();
  const update = (patch: Partial<LocalFinancials>) => onChange({ ...financials, ...patch });

  const [name,    setName]    = useState(debt.name);
  const [apr,     setApr]     = useState(String(debt.apr));
  const [min,     setMin]     = useState(String(debt.minPayment));
  const [opened,  setOpened]  = useState(debt.openedDate ?? "");
  // Phase 2.6.4 step 3: null = show the live derived value; committing on
  // blur (not per keystroke) so typing "1500" doesn't create three separate
  // correction transactions along the way.
  const [balanceInput, setBalanceInput] = useState<string | null>(null);

  const balance = derivedDebtBalance(debt, financials.transactions);

  function save() {
    if (!name.trim()) return;
    update({
      debts: financials.debts.map((d) => d.id !== debt.id ? d : {
        ...d, name: name.trim(),
        apr: Math.max(0, parseFloat(apr) || 0),
        minPayment: parseFloat(min.replace(/,/g, "")) || 0,
        openedDate: opened || undefined,
      }),
    });
    onClose();
  }

  // Mirrors SetupScreen's commitEfBalance, but with the OPPOSITE sign:
  // derivedDebtBalance SUBTRACTS `paid` from openingBalance (derivedEfBalance
  // ADDS contributions), so a balance correction here is `current - entered`,
  // not `entered - current`.
  function commitBalance(raw: string) {
    const entered = Math.max(0, parseFloat(raw.replace(/,/g, "")) || 0);
    const current = derivedDebtBalance(debt, financials.transactions);
    const delta = roundMoney(current - entered);
    if (delta !== 0) {
      update({ transactions: [buildDebtAdjustmentTx(debt, delta), ...financials.transactions] });
    }
    setBalanceInput(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        style={{ background: T.panel, border: `1px solid ${T.line}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>Edit debt</p>
          <button onClick={onClose} aria-label="Close" className="text-lg leading-none" style={{ color: T.mute }}>✕</button>
        </div>

        <div className="space-y-2.5">
          <div>
            <Label htmlFor="edit-debt-name">Name</Label>
            <FocusInput id="edit-debt-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor="edit-debt-balance">Balance ({debt.currency === "LBP" ? "L£" : "$"})</Label>
              <input
                id="edit-debt-balance"
                type="number" min="0" step="1"
                className="w-full rounded-lg px-3 py-2 text-sm tabular-nums"
                style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none" }}
                value={balanceInput ?? (balance || "")}
                onChange={(e) => setBalanceInput(e.target.value)}
                onBlur={(e) => commitBalance(e.target.value)}
                placeholder="0"
              />
            </div>
            <div><Label htmlFor="edit-debt-apr">APR (%)</Label><FocusInput id="edit-debt-apr" type="number" min="0" step="0.1" value={apr} onChange={(e) => setApr(e.target.value)} placeholder="0" /></div>
            <div><Label htmlFor="edit-debt-min">Min/mo</Label><MoneyInput id="edit-debt-min" value={min} onChange={setMin} placeholder="0" /></div>
          </div>
          <div>
            <Label htmlFor="edit-debt-opened">Opened date (when this debt started)</Label>
            <DateFieldDMY id="edit-debt-opened" value={opened} onChange={setOpened} />
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={save} className="flex-1 px-3 py-2 rounded-xl text-sm font-semibold hover:opacity-90" style={{ background: T.jade, color: T.ink }}>Save</button>
          <button onClick={onClose} className="px-3 py-2 rounded-xl text-sm hover:opacity-70" style={{ color: T.mute }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
