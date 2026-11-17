// D-d and D-e (owner, session 56; approved): a field the entry form and an edit sheet share shows one hint. The
// sheets had the short forms ("Who paid or how?", "Total amount"); both now carry the form's longer text. Read
// from source, each pair by its own file, so a new copy of either hint that drifts fails here.
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (p: string) => readFileSync(join(__dirname, p), "utf8");
const placeholders = (p: string, start: string) =>
  [...src(p).matchAll(/placeholder="([^"]*)"/g)].map((m) => m[1]).filter((t) => t.startsWith(start));

const PAIRS = [
  { hint: "Who paid or how? e.g. Dad filled gas tank", start: "Who paid or how?", form: "inputpanel/EntrySection.tsx", sheet: "EditTransactionSheet.tsx" },
  { hint: "Total amount e.g. 10,000", start: "Total amount", form: "inputpanel/RecurringSection.tsx", sheet: "EditRecurringSheet.tsx" },
];

it.each(PAIRS)("$sheet shows the form's hint: \"$hint\"", ({ hint, start, form, sheet }) => {
  expect(placeholders(form, start)).toEqual([hint]); // premise: the form's own text
  expect(placeholders(sheet, start)).toEqual([hint]);
});
