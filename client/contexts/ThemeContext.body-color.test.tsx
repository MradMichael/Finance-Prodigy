// A11Y-01, found by the live scan (session 22): text with no colour of its
// own (every screen's heading, styled only with its font) inherited the
// browser's default black, unreadable on the dark themes (1.06–1.23:1). The
// theme now gives the page its text colour, so anything that inherits reads.
import { it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ThemeProvider, useThemeControl } from "./ThemeContext";
import { THEMES } from "../lib/theme";

afterEach(() => { cleanup(); localStorage.clear(); document.body.style.color = ""; });

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
function Switch() {
  const { setTheme } = useThemeControl();
  return <button onClick={() => setTheme("ivory")}>Ivory</button>;
}

it("the page takes the stored theme's text colour, and follows a change of theme", async () => {
  localStorage.setItem("essa_theme", "midnight");
  render(<ThemeProvider><h1>Budget</h1><Switch /></ThemeProvider>);
  await waitFor(() => expect(document.body.style.color).toBe(rgb(THEMES.midnight.text)));
  fireEvent.click(screen.getByRole("button", { name: "Ivory" }));
  await waitFor(() => expect(document.body.style.color).toBe(rgb(THEMES.ivory.text)));
});
