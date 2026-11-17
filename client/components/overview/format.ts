// R17 (session 55): the Overview's money format, moved from FinancialDashboard.tsx so the charts, which now load
// after the first paint, use the same one.
export const money = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(n);
