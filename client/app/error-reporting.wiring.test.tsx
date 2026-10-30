// INF-02 (owner, session 30): the wiring. The two error boundaries report
// what they caught, and the root layout's ErrorReporting installs the window
// handlers (lib/errorReport.ts, tested on its own).
import { it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

const reportError = vi.fn();
const installErrorReporting = vi.fn();
vi.mock("../lib/errorReport", () => ({ reportError: (...a: unknown[]) => reportError(...a), installErrorReporting: () => installErrorReporting() }));

import ErrorPage from "./error";
import GlobalError from "./global-error";
import ErrorReporting from "../components/ErrorReporting";
import { ThemeProvider } from "../contexts/ThemeContext";

afterEach(() => { cleanup(); reportError.mockReset(); installErrorReporting.mockReset(); vi.restoreAllMocks(); });

it("the page boundary reports the error it caught", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const e = new TypeError("boom");
  render(<ThemeProvider><ErrorPage error={e} reset={vi.fn()} /></ThemeProvider>);
  expect(reportError).toHaveBeenCalledWith(e);
});

it("the root boundary reports the error it caught", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const e = new RangeError("boom");
  render(<GlobalError error={e} reset={vi.fn()} />, { container: document.documentElement });
  expect(reportError).toHaveBeenCalledWith(e);
});

it("ErrorReporting installs the window handlers once mounted, and renders nothing", () => {
  const { container } = render(<ErrorReporting />);
  expect(installErrorReporting).toHaveBeenCalledTimes(1);
  expect(container.innerHTML).toBe("");
});
