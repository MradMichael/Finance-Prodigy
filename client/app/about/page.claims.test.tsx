// About page, session 41 (owner-approved item B). The page repeated privacy
// and encryption claims that the Privacy and Security pages state correctly,
// and several of its copies were false: "Nothing is sent anywhere unless you
// explicitly use 'Push to database'" (analytics is on by default; backup
// uploads automatically when on), "encrypted with your password" (the key is
// random; the password only locks it), "does not connect to any external
// servers", "offline-first, encrypted" and "never leaves your device without
// your permission". They're removed, and the page links to the two pages that
// own those statements. "3 themes" is read from THEMES so it can't drift again.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));

import AboutPage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { THEMES } from "../../lib/theme";

afterEach(cleanup);

/** The whole page's text, every FAQ answer opened. */
function fullText(): string {
  render(<ThemeProvider><AboutPage /></ThemeProvider>);
  // Opening one FAQ closes the previous, so collect each answer as it opens.
  let text = (document.body.textContent ?? "");
  for (const b of screen.getAllByRole("button").filter((x) => x.textContent?.trim().endsWith("+"))) {
    fireEvent.click(b);
    text += " " + (document.body.textContent ?? "");
  }
  return text.replace(/\s+/g, " ");
}

describe("About page: no privacy or encryption claims of its own", () => {
  it("drops every false or duplicated data-handling claim", () => {
    const text = fullText();
    expect(text).not.toMatch(/Nothing is sent anywhere/i);
    expect(text).not.toMatch(/encrypted with your password/i);
    expect(text).not.toMatch(/does not connect to any external servers/i);
    expect(text).not.toMatch(/offline-first/i);
    expect(text).not.toMatch(/never leaves your device without your permission/i);
    expect(text).not.toMatch(/Where is my data stored\?/i);
    expect(text).not.toMatch(/How secure is the encryption\?/i);
  });

  it("links to the Privacy Policy and Trust & Security pages for those questions", () => {
    render(<ThemeProvider><AboutPage /></ThemeProvider>);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs.filter((h) => h === "/privacy").length).toBeGreaterThanOrEqual(2); // the FAQ pointer, and the footer
    expect(hrefs.filter((h) => h === "/security").length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).toMatch(/where your data is stored/i);
  });

  // Session 42 (owner, item F): the badge keeps only the claim that holds --
  // the copy in the browser is encrypted (AES-256-GCM, lib/crypto.ts); the
  // server copy, with backup on, is not.
  it("hero badge reads exactly 'Version 1.0 · encrypted in your browser'", () => {
    render(<ThemeProvider><AboutPage /></ThemeProvider>);
    expect(screen.getByText("Version 1.0 · encrypted in your browser")).toBeTruthy();
  });

  it("names every theme the app has, not a stale count", () => {
    render(<ThemeProvider><AboutPage /></ThemeProvider>);
    const names = Object.values(THEMES).map((t) => t.name);
    const text = document.body.textContent ?? "";
    expect(text).toContain(`${names.length} themes`);
    for (const n of names) expect(text).toContain(n);
    expect(text).not.toMatch(/\b3 themes\b/);
  });
});
