// Session 21, item 2 (owner): Profile's report date range moves to this field.
// There, blank is a real choice ("leave blank for all time"), so a date typed
// and then cleared must read as blank again. Every other date field always
// holds a date, and clearing its boxes keeps the last whole date, as before;
// only a field given `allowEmpty` reports "" once every box is empty.
import { it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateFieldDMY } from "./Primitives";
import { ThemeProvider } from "../../contexts/ThemeContext";

afterEach(cleanup);

function Harness({ initial, onChange, allowEmpty }: { initial: string; onChange: (iso: string) => void; allowEmpty?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <ThemeProvider>
      <DateFieldDMY value={value} allowEmpty={allowEmpty} onChange={(v) => { setValue(v); onChange(v); }} />
    </ThemeProvider>
  );
}
const boxes = () => [screen.getByPlaceholderText("DD"), screen.getByPlaceholderText("MM"), screen.getByPlaceholderText("YYYY")] as HTMLInputElement[];

it("allowEmpty: clearing every box reports blank", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness initial="2026-10-12" onChange={onChange} allowEmpty />);
  for (const b of boxes()) await user.clear(b);
  expect(boxes().map((b) => b.value)).toEqual(["", "", ""]);
  expect(onChange).toHaveBeenLastCalledWith("");
});

it("allowEmpty: backspacing out of every box reports blank too", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness initial="" onChange={onChange} allowEmpty />);
  await user.click(boxes()[0]);
  await user.keyboard("01102026");
  expect(onChange).toHaveBeenLastCalledWith("2026-10-01");
  await user.keyboard("{Backspace>10/}");
  expect(boxes().map((b) => b.value)).toEqual(["", "", ""]);
  expect(onChange).toHaveBeenLastCalledWith("");
});

it("allowEmpty: a backspace in an empty box that clears the box before it, the last one holding a digit, reports blank", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness initial="2026-10-12" onChange={onChange} allowEmpty />);
  const [dd, mm, yyyy] = boxes();
  await user.clear(dd);
  await user.clear(yyyy);
  await user.click(mm); await user.keyboard("{End}{Backspace}"); // the month is now "1"
  expect(onChange).not.toHaveBeenCalled();
  await user.click(yyyy); await user.keyboard("{Backspace}"); // from the empty year box: the month's "1" goes
  expect(boxes().map((b) => b.value)).toEqual(["", "", ""]);
  expect(onChange).toHaveBeenLastCalledWith("");
});

it("allowEmpty: a part-cleared field keeps its last whole date, as every date field does", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness initial="2026-10-12" onChange={onChange} allowEmpty />);
  await user.clear(boxes()[0]);
  expect(onChange).not.toHaveBeenCalled();
});

it("without allowEmpty nothing changes: clearing every box never reports blank", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness initial="2026-10-12" onChange={onChange} />);
  for (const b of boxes()) await user.clear(b);
  await user.click(boxes()[2]);
  await user.keyboard("{Backspace>6/}");
  expect(onChange).not.toHaveBeenCalledWith("");
});
