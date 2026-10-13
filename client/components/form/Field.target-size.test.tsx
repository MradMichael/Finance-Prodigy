// A11Y-06 (blind-spot audit; owner, session 22: the target is WCAG 2.2 AA).
// 2.5.8, target size (minimum): a pointer target is at least 24 by 24 CSS
// pixels. The password fields' "Show" / "Hide" toggle was its 11px text and no
// more, about 16px tall (axe flagged it on sign-in and sign-up). It now has a
// 24 by 24 minimum, padded, still inside the field. (The live check measures
// the rendered box.)
import { it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import Field from "./Field";
import { ThemeProvider } from "../../contexts/ThemeContext";

afterEach(cleanup);

it("the password field's Show toggle is at least 24 by 24", () => {
  render(<ThemeProvider><Field label="Password" type="password" value="" onChange={() => {}} /></ThemeProvider>);
  const toggle = screen.getByRole("button", { name: "Show password" });
  expect(parseFloat(toggle.style.minWidth)).toBeGreaterThanOrEqual(24);
  expect(parseFloat(toggle.style.minHeight)).toBeGreaterThanOrEqual(24);
});

it("a field that isn't a password has no toggle", () => {
  render(<ThemeProvider><Field label="Email" type="email" value="" onChange={() => {}} /></ThemeProvider>);
  expect(screen.queryByRole("button")).toBeNull();
});
