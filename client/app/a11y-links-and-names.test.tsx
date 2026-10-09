// A11Y-08: the links inside body text on the privacy, security and terms
// pages differed from the text around them by colour alone (axe
// link-in-text-block, WCAG 1.4.1: privacy 1, security 4, terms 3). They are
// underlined now.
//
// A11Y-04, its first half: Profile's "Help improve ESSA" switch had a role
// and a state but no name, so a screen reader heard "switch, checked" and
// nothing about what it controls. It is named by the heading beside it. (The
// month picker on Transactions has no visible label to name it by; that half
// would need new wording and is left for the owner.)
import { it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));
const SESSION = { userId: "u1", email: "u1@example.com", name: "U One" }; // one object: Profile's effects key on it
vi.mock("../lib/auth", () => ({
  getSession: () => SESSION, hasValidSession: () => true, signOut: vi.fn(), updateProfile: vi.fn(),
  deleteAccount: vi.fn(), ensureFirstUserIsAdmin: vi.fn(), regenerateRecoveryCode: vi.fn(),
}));
vi.mock("../lib/syncService", () => ({
  pushToServer: vi.fn(), pullFromServer: vi.fn(), getLastSyncTime: () => null, confirmOverwriteIfNeeded: vi.fn(async () => true),
  mergeAndPush: vi.fn(), recordMergeStored: vi.fn(), buildMergeNoticeText: () => ({ text: "" }), applyBackupChoice: vi.fn(),
}));
vi.mock("../lib/analytics", () => ({ isAnalyticsOptedIn: () => true, setAnalyticsOptIn: vi.fn() }));

import PrivacyPage from "./privacy/page";
import SecurityPage from "./security/page";
import TermsPage from "./terms/page";
import ProfilePage from "./profile/page";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, saveData, type LocalFinancials } from "../lib/localData";
import { activateSessionKey } from "../lib/crypto";

afterEach(cleanup);

/** Links that sit inside a paragraph of text, and whether each is underlined. */
function linksInText() {
  return Array.from(document.querySelectorAll("main p a, p a")).filter((a, i, all) => all.indexOf(a) === i)
    .map((a) => (a as HTMLElement).style.textDecoration.includes("underline"));
}

it.each([
  ["privacy", PrivacyPage, 1],
  ["security", SecurityPage, 4],
  ["terms", TermsPage, 3],
])("every link in the %s page's text is underlined, not marked by colour alone", (_name, Page, count) => {
  render(<ThemeProvider><Page /></ThemeProvider>);
  const links = linksInText();
  expect(links.length).toBe(count);
  expect(links.every(Boolean)).toBe(true);
});

it("Profile's analytics switch is named by its heading", async () => {
  localStorage.clear(); sessionStorage.clear();
  activateSessionKey(new Uint8Array(32).fill(7));
  await saveData({ ...DEFAULT_DATA, income: 3000 } as LocalFinancials, "u1");
  render(<ThemeProvider><ProfilePage /></ThemeProvider>);
  await screen.findByRole("button", { name: /Download my data/ }); // loaded
  // queryBy, not findBy: a failing role query lists every role on this large page on each retry.
  const sw = screen.queryByRole("switch", { name: "Help improve ESSA" });
  expect(sw).not.toBeNull();
  expect(sw!.getAttribute("aria-checked")).toBe("true");
});
