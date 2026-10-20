"use client";

import { allCategories, categoryLabel, TRAVEL_CATEGORY_KEYS, type CustomCategory } from "../../lib/localData";

/**
 * Session 22, item 1a (owner; approved and merged in session 23, 2f5d30c): the options every category picker shows.
 * The ordinary built-ins and the account's own categories as before, then the
 * travel categories grouped as "Travel". The picker supplies its own first
 * option ("No category", "Choose…").
 */
export default function CategoryOptions({ customCategories }: { customCategories?: CustomCategory[] }) {
  const all = allCategories(customCategories);
  const travel = new Set<string>(TRAVEL_CATEGORY_KEYS);
  const option = (c: { value: string; label: string; icon: string }) => <option key={c.value} value={c.value}>{c.icon} {categoryLabel(c.value, customCategories)}</option>; // "(custom)" on a clash (owner, session 22)
  return (
    <>
      {all.filter((c) => !travel.has(c.value)).map(option)}
      <optgroup label="Travel">
        {TRAVEL_CATEGORY_KEYS.map((k) => all.find((c) => c.value === k)!).map(option)}
      </optgroup>
    </>
  );
}
