// Owner, session 15, item 1: the date field dropped typing into a box that
// already had a value. Each box had maxLength, so once it was full (today's
// date, prefilled) the browser refused every keystroke before the field saw
// it: clicking into the day box and typing "03" changed nothing, with no
// sign why. A full box that receives a digit now starts over from that digit,
// the way a native date field's segments do; an empty or part-filled box
// types as before.
import { it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateFieldDMY } from "./Primitives";
import { ThemeProvider } from "../../contexts/ThemeContext";

afterEach(cleanup);

function Harness({ initial, onChange }: { initial: string; onChange: (iso: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <ThemeProvider>
      <label htmlFor="d">Date</label>
      <DateFieldDMY id="d" value={value} onChange={(v) => { setValue(v); onChange(v); }} />
    </ThemeProvider>
  );
}
const boxes = () => [screen.getByPlaceholderText("DD"), screen.getByPlaceholderText("MM"), screen.getByPlaceholderText("YYYY")] as HTMLInputElement[];

it("typing over a prefilled date replaces it, box by box: 12/10/2026 becomes 03/09/2025", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness initial="2026-10-12" onChange={onChange} />);
  await user.click(boxes()[0]);
  await user.keyboard("03");
  await user.keyboard("09");
  await user.keyboard("2025");
  expect(boxes().map((b) => b.value)).toEqual(["03", "09", "2025"]);
  expect(onChange).toHaveBeenLastCalledWith("2025-09-03");
});

it("one box at a time: changing only the day keeps the month and year", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness initial="2026-10-12" onChange={onChange} />);
  await user.click(boxes()[0]);
  await user.keyboard("03");
  expect(boxes().map((b) => b.value)).toEqual(["03", "10", "2026"]);
  expect(onChange).toHaveBeenLastCalledWith("2026-10-03");
});

it("a single digit over a full box that can't take a second one moves straight on to the month", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness initial="2026-10-12" onChange={onChange} />);
  await user.click(boxes()[0]);
  await user.keyboard("4");
  expect(boxes()[0].value).toBe("4");
  expect(document.activeElement).toBe(boxes()[1]); // no valid second digit: on to the month
});

it("an empty field still types straight through", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness initial="" onChange={onChange} />);
  await user.click(boxes()[0]);
  await user.keyboard("03102026");
  expect(onChange).toHaveBeenLastCalledWith("2026-10-03");
});

it("a part-filled box takes its second digit as before", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness initial="" onChange={onChange} />);
  await user.click(boxes()[0]);
  await user.keyboard("1");
  expect(boxes()[0].value).toBe("1");
  await user.keyboard("5");
  expect(boxes()[0].value).toBe("15");
  expect(document.activeElement).toBe(boxes()[1]);
});
