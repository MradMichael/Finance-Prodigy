import { describe, it, expect } from "vitest";
import { fmtCur } from "./shared";

// fmtCur is now the single native-currency formatter shared across
// GoalsScreen, DebtsScreen, InputPanel, and FinancialDashboard (Phase 1.5) --
// worth its own coverage now that it's load-bearing across that many call
// sites, unlike money() (still just local USD formatting in one place).
describe("fmtCur", () => {
  it("USD: $ prefix, 2 decimal places, thousands separator", () => {
    expect(fmtCur(1234.5, "USD")).toBe("$1,234.50");
    expect(fmtCur(0, "USD")).toBe("$0.00");
    expect(fmtCur(1000000, "USD")).toBe("$1,000,000.00");
  });

  it("LBP: L£ prefix, 0 decimal places, thousands separator", () => {
    expect(fmtCur(8950000, "LBP")).toBe("L£8,950,000");
    expect(fmtCur(0, "LBP")).toBe("L£0");
    expect(fmtCur(1234, "LBP")).toBe("L£1,234");
  });
});
