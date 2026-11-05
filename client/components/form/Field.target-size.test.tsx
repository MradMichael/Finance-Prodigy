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

// A1 (app readiness, owner-approved 2026-11-05): 44 by 44, the brief's touch-target minimum (section 5).
// The inline style outranks globals.css's 44 px touch rule, so the toggle sets its own. It still fits
// inside the field (about 46 px tall on a desktop, about 50 px on a touch screen); measured live.
it("the password field's Show toggle is at least 44 by 44", () => {
  render(<ThemeProvider><Field label="Password" type="password" value="" onChange={() => {}} /></ThemeProvider>);
  const toggle = screen.getByRole("button", { name: "Show password" });
  expect(parseFloat(toggle.style.minWidth)).toBeGreaterThanOrEqual(44);
  expect(parseFloat(toggle.style.minHeight)).toBeGreaterThanOrEqual(44);
});

it("a field that isn't a password has no toggle", () => {
  render(<ThemeProvider><Field label="Email" type="email" value="" onChange={() => {}} /></ThemeProvider>);
  expect(screen.queryByRole("button")).toBeNull();
});
