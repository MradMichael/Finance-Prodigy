// F4 (session 56, held, found in the live check): the Monthly report made the sidebar seventeen screens long. Its list
// was clipped (overflow hidden), so at 1280 × 900 the last one, Balance Check, sat under the account footer and
// couldn't be clicked (at 800 px tall, Trips and Balance Check were already out of reach on main). The list now
// scrolls inside the sidebar: it may shrink below its content (min-h-0) and scrolls (overflow-y-auto). jsdom does no
// layout, so this reads the rendered classes; the live check clicks Balance Check at 1280 × 800 and 1280 × 900.
import { it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import Sidebar from "./Sidebar";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { NAV } from "../screens/shared";

it("the sidebar's list of screens scrolls instead of clipping, so the last screen can be reached on a short window", () => {
  const session = { userId: "u1", email: "u1@example.invalid", name: "U One" } as Parameters<typeof Sidebar>[0]["session"];
  const { container } = render(<ThemeProvider><Sidebar screen="overview" setScreen={vi.fn()} session={session} onProfile={vi.fn()} syncStatus="idle" /></ThemeProvider>);
  const nav = container.querySelector("nav")!;
  expect(nav.querySelectorAll("button")).toHaveLength(NAV.length); // premise: every screen is in this list
  const classes = nav.className.split(/\s+/);
  expect(classes).toContain("min-h-0");
  expect(classes).toContain("overflow-y-auto");
  expect(classes).not.toContain("overflow-hidden");
});
