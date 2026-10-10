// Owner, session 9: an amount in a merge sentence, in its own currency. Lira
// in the app's existing lira format (fmtCur, components/screens/shared.ts:
// "L£" and whole lira with separators); dollars as the approved merge
// sentences have always shown them (whole dollars, "$150").
export function noticeMoney(amount: number, currency: string | undefined): string {
  return currency === "LBP"
    ? `L£${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
}
