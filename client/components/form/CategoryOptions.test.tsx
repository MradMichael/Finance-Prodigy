// Session 22, item 1a (owner; approved and merged in session 23, 2f5d30c): eight travel categories, in every
// category picker, grouped as "Travel": Flights, Accommodation, Local
// transport, Food & dining, Activities, Shopping, Insurance & visas, Other
// travel. They're built in (code, not seeded into anyone's data), so custom
// categories are untouched. The existing "Travel" stays an ordinary category:
// it's the exchange row's, the money moving rather than a purchase.
import { it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import CategoryOptions from "./CategoryOptions";
import { CATEGORIES, TRAVEL_CATEGORY_KEYS, categoryLabel } from "../../lib/localData";

afterEach(cleanup);

const TRAVEL = [
  ["travel-flights", "Flights"], ["travel-accommodation", "Accommodation"], ["travel-local-transport", "Local transport"],
  ["travel-food", "Food & dining"], ["travel-activities", "Activities"], ["travel-shopping", "Souvenirs & shopping"],
  ["travel-insurance-visas", "Insurance & visas"], ["travel-other", "Other travel"],
];

it("the eight travel categories are built in, in the owner's order and words", () => {
  expect(TRAVEL_CATEGORY_KEYS).toEqual(TRAVEL.map(([k]) => k));
  for (const [k, label] of TRAVEL) expect(categoryLabel(k)).toBe(label);
  expect(CATEGORIES.some((c) => c.value === "travel")).toBe(true); // the exchange's own category stays
});

function options(custom: { value: string; label: string; icon: string }[] = []) {
  const { container } = render(<select defaultValue=""><option value="">No category</option><CategoryOptions customCategories={custom} /></select>);
  return container;
}

it("a picker lists the ordinary categories and custom ones as before, then the travel ones in a Travel group", () => {
  const c = options([{ value: "pet-care", label: "Pet care", icon: "🐾" }]);
  const group = c.querySelector('optgroup[label="Travel"]')!;
  expect([...group.querySelectorAll<HTMLOptionElement>("option")].map((o) => o.value)).toEqual(TRAVEL.map(([k]) => k));
  const outside = [...c.querySelectorAll<HTMLOptionElement>("select > option")].map((o) => o.value);
  expect(outside).toContain("travel");
  expect(outside).toContain("pet-care");
  expect(outside.some((v) => v.startsWith("travel-"))).toBe(false);
  expect(outside.indexOf("pet-care")).toBeGreaterThan(outside.indexOf("other")); // customs after the built-ins, as before
});

it("every category picker in the app goes through the one component, so none misses the Travel group", () => {
  const root = join(__dirname, "../..");
  const files: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx$/.test(e) && !/\.test\./.test(e)) files.push(p); } };
  walk(join(root, "components")); walk(join(root, "app"));
  const handBuilt = files.filter((f) => /allCategories\([^)]*\)\.map\(\s*\(\w+\)\s*=>\s*\(?\s*<option/.test(readFileSync(f, "utf8").replace(/\s+/g, " "))).map((f) => relative(root, f).replace(/\\/g, "/"));
  expect(handBuilt).toEqual([]);
});
