// A11Y-05, its keyboard half (owner, session 8): a scrolling area with
// nothing focusable inside can't be scrolled from the keyboard (axe
// scrollable-region-focusable; Statistics' main area). useScrollFocus makes
// such an area a Tab stop, only while it actually overflows and holds nothing
// focusable, and takes the stop away again when either stops being true.
//
// jsdom has no layout, so each test says which elements overflow.
import { it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useScrollFocus } from "./useScrollFocus";

const props = ["scrollHeight", "clientHeight"] as const;
beforeEach(() => {
  // An element with data-overflows reports more content than it shows.
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get() { return (this as HTMLElement).dataset.overflows ? 900 : 100; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return 100; } });
});
afterEach(() => { cleanup(); for (const p of props) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[p]; });

function Area({ overflows = true, initial = "text" as "text" | "button" }) {
  const ref = useScrollFocus();
  const [content, setContent] = useState(initial);
  return (
    <div>
      <button onClick={() => setContent(content === "text" ? "button" : "text")}>outside</button>
      <div ref={ref} data-testid="area" data-overflows={overflows ? "1" : undefined} style={{ overflowY: "auto" }}>
        {content === "text" ? <p>Charts and figures</p> : <button>Inside</button>}
      </div>
    </div>
  );
}
const area = () => document.querySelector<HTMLElement>("[data-testid=area]")!;

it("an overflowing area with nothing focusable inside is a Tab stop", () => {
  render(<Area />);
  expect(area().getAttribute("tabindex")).toBe("0");
});

it("an area with something focusable inside isn't: Tab already reaches into it", () => {
  render(<Area initial="button" />);
  expect(area().hasAttribute("tabindex")).toBe(false);
});

it("an area that doesn't overflow isn't: there is nothing to scroll", () => {
  render(<Area overflows={false} />);
  expect(area().hasAttribute("tabindex")).toBe(false);
});

it("follows its content: the stop goes when a control appears, and comes back when it goes", async () => {
  render(<Area />);
  expect(area().getAttribute("tabindex")).toBe("0");
  (document.querySelector("button") as HTMLButtonElement).click(); // a control appears inside
  await waitFor(() => expect(area().hasAttribute("tabindex")).toBe(false));
  (document.querySelector("button") as HTMLButtonElement).click(); // and goes
  await waitFor(() => expect(area().getAttribute("tabindex")).toBe("0"));
});

it("a disabled or hidden control doesn't count as focusable", () => {
  function Disabled() {
    const ref = useScrollFocus();
    return <div ref={ref} data-testid="area" data-overflows="1"><button disabled>Off</button><input type="hidden" /><a>no href</a></div>;
  }
  render(<Disabled />);
  expect(area().getAttribute("tabindex")).toBe("0");
});
