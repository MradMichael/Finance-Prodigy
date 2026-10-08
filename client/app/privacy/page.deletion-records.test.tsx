// DI-13 (owner-approved, session 4): the privacy page says that deleting an
// item, or resetting all data, leaves a short record of the deletion, synced
// with backup on, and kept until the account is deleted. Checked before
// writing it: nothing in the code ever prunes a deletion record
// (recordDeletion only adds or replaces; the reset keeps them; the field's
// own comment says "kept for good"), and deleting the account removes them
// with everything else.
import { it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));

import PrivacyPage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";

afterEach(cleanup);

it("says what a deletion leaves behind, and for how long, under Deleting your data", () => {
  render(<ThemeProvider><PrivacyPage /></ThemeProvider>);
  const section = screen.getByRole("heading", { name: "Deleting your data" }).closest("section")!;
  expect((section.textContent ?? "").replace(/\s+/g, " ")).toContain(
    "When you delete an item, or reset all data, ESSA keeps a short record that it was deleted — its internal key (for a custom category, its name in lowercase) and when — so your other devices remove it too. " +
    "These records are stored with the rest of your data, in the server copy too if backup is on, and are kept until you delete your account, which removes them.",
  );
});
