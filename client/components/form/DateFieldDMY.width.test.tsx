// Session 20, item 2 (owner): "MM" showed as "MN" on the Trips form. The DD
// and MM boxes were 1.6em wide, but "M" runs to about 0.9em in the app's UI
// fonts (Segoe UI, Roboto; SF Pro a little less), so "MM" needs about 1.8em
// and was clipped; and a box could shrink further in a narrow row. Now every
// box is wide enough for its placeholder (DD and MM 2em, YYYY 3em), has no
// padding to eat into that, and never shrinks. (The live check measures each
// date field with the real fonts at desktop and phone widths.)
import { it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DateFieldDMY } from "./Primitives";

const segments = () => {
  render(<ThemeProvider><DateFieldDMY id="d" value="" onChange={() => {}} /></ThemeProvider>);
  const byPlaceholder = (p: string) => document.querySelector(`input[placeholder="${p}"]`) as HTMLInputElement;
  return { dd: byPlaceholder("DD"), mm: byPlaceholder("MM"), yyyy: byPlaceholder("YYYY") };
};
const em = (el: HTMLInputElement) => { const w = el.style.width; if (!w.endsWith("em")) throw new Error(`width ${w} isn't in em`); return parseFloat(w); };

it("each box is wide enough for its placeholder: DD and MM at least 2em, YYYY at least 3em", () => {
  const { dd, mm, yyyy } = segments();
  expect(em(dd)).toBeGreaterThanOrEqual(2);
  expect(em(mm)).toBeGreaterThanOrEqual(2);
  expect(em(yyyy)).toBeGreaterThanOrEqual(3);
});

it("no box shrinks in a narrow row, and none has padding to eat into its width", () => {
  for (const el of Object.values(segments())) {
    expect(el.style.flexShrink).toBe("0");
    expect(el.style.padding).toBe("0px");
  }
});
