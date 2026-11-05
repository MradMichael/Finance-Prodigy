// PWA P2 (owner-approved, 2026-11-05): ESSA draws to the screen's edges (viewport-fit=cover), so the phone
// shell pads itself: the top bar by the status bar/notch, the bottom navigation by the home indicator (its
// panel colour runs under the indicator rather than leaving a bare strip), and the page body by the side
// insets a notch takes in landscape. Each keeps its old padding and adds the inset, which is 0 on screens
// without one.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import fs from "fs";
import path from "path";
import TopBar from "./TopBar";
import BottomNav from "./BottomNav";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { viewport } from "../../app/layout";
import type { Session } from "../../lib/auth";

afterEach(cleanup);

it("lets the app draw under the notch and home indicator, so the insets are reported", () => {
  expect(viewport.viewportFit).toBe("cover");
});

it("the top bar keeps its padding and adds the top inset", () => {
  const session = { userId: "u1", email: "u1@example.com", name: "Quartz Lantern" } as Session;
  const { container } = render(<ThemeProvider><TopBar session={session} onProfile={vi.fn()} onSignOut={vi.fn()} syncStatus={"idle" as never} /></ThemeProvider>);
  const header = container.querySelector("header")!;
  expect(header.className.split(" ")).toContain("pt-[calc(0.625rem+env(safe-area-inset-top))]");
  expect(header.className.split(" ")).toContain("pb-2.5");
});

it("the bottom navigation keeps its padding and adds the bottom inset", () => {
  render(<ThemeProvider><BottomNav screen="overview" setScreen={vi.fn()} /></ThemeProvider>);
  const nav = screen.getByRole("navigation");
  expect(nav.className.split(" ")).toContain("pb-[calc(0.5rem+env(safe-area-inset-bottom))]");
  expect(nav.className.split(" ")).toContain("pt-2");
});

it("the page body clears a landscape notch on either side", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
  expect(css).toMatch(/body\s*\{[^}]*padding-left:\s*env\(safe-area-inset-left\)/);
  expect(css).toMatch(/body\s*\{[^}]*padding-right:\s*env\(safe-area-inset-right\)/);
});
