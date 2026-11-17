"use client";

// InputPanel split, S6 (session 55): My Finances' Other Assets section, moved here line for line. The section's
// header (title and count) stays in InputPanel; a closed section doesn't build this at all.
import { useState } from "react";
import type { LocalFinancials, Currency } from "../../lib/localData";
import { uid, withRate, lbpRateOf, edited, recordDeletion, moneyMaxFor } from "../../lib/localData";
import { useTheme } from "../../contexts/ThemeContext";
import { Label, FocusInput, MoneyInput, PrimaryBtn, CurrencyToggle } from "../form/Primitives";

/** Other Assets: its form's state. InputPanel calls this, so the state lives there and what is typed survives closing the section, as before the move. */
export function useAssetsForm() {
  // Asset form
  const [aName,     setAName]     = useState("");
  const [aValue,    setAValue]    = useState("");
  const [aCurrency, setACurrency] = useState<Currency>("USD");
  return { aName, setAName, aValue, setAValue, aCurrency, setACurrency };
}

export default function AssetsSection({ financials, update, lbpRate, form }: {
  financials: LocalFinancials;
  update: (patch: Partial<LocalFinancials>) => void;
  lbpRate: number;
  form: ReturnType<typeof useAssetsForm>;
}) {
  const T = useTheme();
  const { aName, setAName, aValue, setAValue, aCurrency, setACurrency } = form;

  function addAsset() {
    if (!aName.trim() || !aValue) return;
    const asset = {
      id: uid(), name: aName.trim(),
      value: parseFloat(aValue.replace(/,/g, "")),
      currency: aCurrency,
      ...withRate(aCurrency, lbpRateOf(financials)),
      createdAt: new Date().toISOString(),
    };
    update({ assets: [...(financials.assets ?? []), edited(asset)] });
    setAName(""); setAValue(""); setACurrency("USD");
  }

  function deleteAsset(id: string) {
    if (!confirm("Remove this asset?")) return;
    update({ assets: (financials.assets ?? []).filter((a) => a.id !== id), deletedKeys: recordDeletion(financials, "assets", id) });
  }

  return (
    <>
      <p className="text-xs" style={{ color: T.mute }}>
        Anything besides goals and your safety net: a car, a brokerage account, crypto. Counted toward net worth.
      </p>
      {(financials.assets ?? []).length > 0 && (
        <div className="space-y-2">
          {(financials.assets ?? []).map((a) => (
            <div key={a.id} className="rounded-xl p-3 flex items-center justify-between gap-2" style={{ background: T.panelSoft, border: `1px solid ${T.line}` }}>
              <div>
                <p className="text-sm font-medium" style={{ color: T.text }}>{a.name}</p>
                <p className="text-xs tabular-nums" style={{ color: T.jade }}>
                  {a.currency === "LBP" ? "L£" : "$"}{a.value.toLocaleString("en-US")}
                </p>
              </div>
              <button
                onClick={() => deleteAsset(a.id)}
                className="text-xs px-2 py-1 rounded-lg hover:opacity-70 transition-opacity flex-shrink-0"
                style={{ color: T.coral }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className="rounded-xl p-4 space-y-3"
        style={{ background: T.ink, border: `1px solid ${T.line}` }}
      >
        <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>
          New asset
        </p>
        <div>
          <Label htmlFor="new-asset-name">Name</Label>
          <FocusInput id="new-asset-name" value={aName} onChange={(e) => setAName(e.target.value)} placeholder="Car, brokerage account…" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="new-asset-value">Value</Label>
            <MoneyInput id="new-asset-value" value={aValue} onChange={setAValue} placeholder="0" max={moneyMaxFor(aCurrency, lbpRate)} />
          </div>
          <div>
            <Label>Currency</Label>
            <CurrencyToggle value={aCurrency} onChange={setACurrency} />
          </div>
        </div>
        <PrimaryBtn onClick={addAsset} color={T.jade} disabled={!aName.trim() || !aValue}>+ Add asset</PrimaryBtn>
      </div>
    </>
  );
}
