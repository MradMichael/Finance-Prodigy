// Session 10, item 6 (HELD): the money field shows "450,000" and swaps to
// "450000" on focus, so typing never has to step over commas. The swap was a
// re-render after the focus event, and replacing an input's value throws away
// its selection. Reproduced live in Edge: Tab into a field holding 450,000
// (the browser selects it all, as it does a plain input: [0,7]), type 5, and
// the field reads 4500005, not 5. A select-all made straight after focus (a
// script, Playwright's fill) was lost the same way.
//
// The swap now waits for the end of the focusing task, once the browser has
// placed the selection, carries each end to the same digit, and only then
// renders as focused. (Chrome's select() on an unfocused field focuses it
// first and applies the selection after the focus event: checked live in
// Edge, as jsdom doesn't do that.)
import { it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MoneyInput } from "./Primitives";
import { ThemeProvider } from "../../contexts/ThemeContext";

afterEach(cleanup);

function Field({ initial = "450000", allowNegative = false, onChange = vi.fn() }: { initial?: string; allowNegative?: boolean; onChange?: (raw: string) => void }) {
  const [v, setV] = useState(initial);
  return <MoneyInput id="amt" value={v} onChange={(raw) => { setV(raw); onChange(raw); }} max={1e12} allowNegative={allowNegative} />;
}
function show(props: Parameters<typeof Field>[0] = {}) {
  render(<ThemeProvider><button>before</button><Field {...props} /></ThemeProvider>);
  return screen.getByRole("textbox") as HTMLInputElement;
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const sel = (i: HTMLInputElement) => [i.selectionStart, i.selectionEnd];

it("shows the figure with commas until focused, then without", async () => {
  const i = show();
  expect(i.value).toBe("450,000");
  i.focus(); await settle();
  expect(i.value).toBe("450000");
});

it("a whole-field selection made as focus arrives (the browser's, on Tab) survives the swap", async () => {
  const i = show();
  i.setSelectionRange(0, 7); // what the browser does to "450,000" on Tab
  i.focus(); await settle();
  expect(i.value).toBe("450000");
  expect(sel(i)).toEqual([0, 6]);
});

it("so typing after Tab replaces the figure, not appends to it", async () => {
  const user = userEvent.setup();
  const i = show();
  i.setSelectionRange(0, 7);
  i.focus(); await settle();
  await user.keyboard("5");
  expect(i.value).toBe("5");
});

it("a select-all straight after focus (a script) survives too", async () => {
  const i = show();
  i.focus(); i.select(); // the same task: before React's re-render
  await settle();
  expect(i.value).toBe("450000");
  expect(sel(i)).toEqual([0, 6]);
});

it("in the order Playwright's fill uses (select, then focus), too", async () => {
  const i = show();
  i.select(); i.focus();
  await settle();
  expect(sel(i)).toEqual([0, 6]);
});

it("Edge's select() on an unfocused field (Playwright's fill): the select-all survives", async () => {
  // Modelled on what Edge does, observed live: select() focuses first (the
  // selection reads [0,0] during the focus event), then restores its cached
  // selection, which a setSelectionRange made during that event replaces.
  const i = show();
  let cache: [number, number] = [0, i.value.length];
  const real = HTMLInputElement.prototype.setSelectionRange;
  Object.defineProperty(i, "setSelectionRange", { configurable: true, value(s: number, e: number) { cache = [s, e]; real.call(i, s, e); } });
  real.call(i, 0, 0);
  i.focus();
  real.call(i, ...cache);
  delete (i as unknown as Record<string, unknown>).setSelectionRange;
  await settle();
  expect(i.value).toBe("450000");
  expect(sel(i)).toEqual([0, 6]);
});

it("focused and left within the same task: no swap, the commas stay", async () => {
  const i = show();
  i.focus(); i.blur();
  await settle();
  expect(i.value).toBe("450,000");
});

it("a caret inside the figure stays at the same digit", async () => {
  const i = show({ initial: "1234567" });
  expect(i.value).toBe("1,234,567");
  i.setSelectionRange(6, 6); // after "1,234,"
  i.focus(); await settle();
  expect(i.value).toBe("1234567");
  expect(sel(i)).toEqual([4, 4]); // after "1234"
});

it("a negative correction and decimals map the same way", async () => {
  const i = show({ initial: "-1234.5", allowNegative: true });
  expect(i.value).toBe("-1,234.5");
  i.setSelectionRange(0, 8);
  i.focus(); await settle();
  expect(i.value).toBe("-1234.5");
  expect(sel(i)).toEqual([0, 7]);
});

it("focusing changes no figure: nothing is reported as typed", async () => {
  const onChange = vi.fn();
  const i = show({ onChange });
  i.setSelectionRange(0, 7);
  i.focus(); await settle();
  expect(onChange).not.toHaveBeenCalled();
});

it("an empty field focuses as before", async () => {
  const i = show({ initial: "" });
  i.focus(); await settle();
  expect(i.value).toBe("");
});

it("leaving shows the commas again", async () => {
  const i = show();
  i.focus(); await settle();
  i.blur(); await settle();
  expect(i.value).toBe("450,000");
});
