// A1 (app readiness, owner-approved 2026-11-05): every type="number" field names the phone keyboard it
// wants. inputMode="decimal" where the value is parsed with parseFloat (amounts, APR, the rate), so the
// keypad has a decimal point; inputMode="numeric" where the code keeps only a whole number (parseInt, or
// Math.round), so the keypad offers nothing the code would throw away. Chosen from each field's parsing
// code, not its label. Read from source: jsdom shows no keyboard. A new number field fails the first test
// until it has a mode and a row in EXPECTED.
import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");

/** Each number field: the file, and its id, or its value expression when it has no id. */
const EXPECTED: Record<string, "decimal" | "numeric"> = {
  "components/InputPanel.tsx#new-debt-apr": "decimal", // parseFloat(dApr)
  "components/EditDebtSheet.tsx#edit-debt-balance": "decimal", // commitBalance: parseFloat
  "components/EditDebtSheet.tsx#edit-debt-apr": "decimal", // parseFloat(apr)
  "components/screens/SetupScreen.tsx#setup-income": "decimal", // parseFloat
  "components/screens/SetupScreen.tsx#setup-payday": "numeric", // parseInt(startDayDraft, 10)
  "components/screens/SetupScreen.tsx#ef-target-months": "numeric", // parseInt(e.target.value, 10)
  "components/screens/SetupScreen.tsx#ef-balance": "decimal", // commitEfBalance: parseFloat
  "components/screens/ProjectionsScreen.tsx#value={testAmount}": "numeric", // Math.round(Number(...))
  "components/screens/CurrencyScreen.tsx#currency-lbp-rate": "decimal", // commitLbpRate: parseFloat
  "components/screens/GoalsScreen.tsx#value={payAmt}": "decimal", // parseFloat(payAmt)
};

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sources(p);
    return e.name.endsWith(".tsx") && !e.name.includes(".test.") ? [p] : [];
  });
}

/** Every JSX element with type="number": its key (as in EXPECTED) and its inputMode, if any. */
function numberFields(): { key: string; mode: string | null }[] {
  const out: { key: string; mode: string | null }[] = [];
  for (const file of [...sources(path.join(ROOT, "app")), ...sources(path.join(ROOT, "components"))]) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    for (let i = src.indexOf('type="number"'); i >= 0; i = src.indexOf('type="number"', i + 1)) {
      const start = src.lastIndexOf("<", i);
      const end = src.indexOf("/>", i);
      const el = src.slice(start, end);
      const id = el.match(/\bid="([^"]+)"/)?.[1];
      const value = el.match(/value=\{[^\n]*?\}(?=\s|$)/)?.[0];
      out.push({ key: `${rel}#${id ?? value}`, mode: el.match(/inputMode="(\w+)"/)?.[1] ?? null });
    }
  }
  return out;
}

it("every number field names a keyboard", () => {
  const missing = numberFields().filter((f) => f.mode === null).map((f) => f.key);
  expect(missing).toEqual([]);
});

it("each number field has the keyboard its parsing calls for, and there are exactly the ten known", () => {
  const found = Object.fromEntries(numberFields().map((f) => [f.key, f.mode]));
  expect(found).toEqual(EXPECTED);
});
