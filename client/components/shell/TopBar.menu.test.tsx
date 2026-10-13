// A11Y-02, the last overlay (session 21): the phone account menu. It said it
// was a menu (aria-haspopup) without being one, opening it left focus on the
// button behind, and Tab walked out past it while it stayed open. Now it
// follows the menu-button pattern: it opens onto its first item, the arrow
// keys move between items, Escape closes it and returns focus to the button,
// and Tab closes it on the way out. Its name is the button's, "Account menu".
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TopBar from "./TopBar";
import { ThemeProvider } from "../../contexts/ThemeContext";
import type { Session } from "../../lib/auth";

afterEach(cleanup);

const SESSION = { userId: "u1", email: "u1@example.com", name: "Quartz Lantern" } as Session;
function setup(syncStatus: "idle" | "synced" = "idle") {
  const onProfile = vi.fn(), onSignOut = vi.fn();
  render(<ThemeProvider><TopBar session={SESSION} onProfile={onProfile} onSignOut={onSignOut} syncStatus={syncStatus as never} /><button>After</button></ThemeProvider>);
  return { user: userEvent.setup(), trigger: screen.getByRole("button", { name: "Account menu" }), onProfile, onSignOut };
}

it("is a menu, named by its button, holding Settings and Sign out as its items", async () => {
  const { user, trigger } = setup();
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  await user.click(trigger);
  const menu = screen.getByRole("menu", { name: "Account menu" });
  expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
  expect(screen.getAllByRole("menuitem").map((i) => i.textContent?.trim())).toEqual(["⚙ Settings", "→ Sign out"]);
});

it("opens onto its first item, by click or by keyboard", async () => {
  const { user, trigger } = setup();
  await user.click(trigger);
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Settings/ }));
  await user.keyboard("{Escape}");
  await user.keyboard("{Enter}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Settings/ }));
});

it("the arrow keys, Home and End move between the items, wrapping at either end", async () => {
  const { user, trigger } = setup();
  await user.click(trigger);
  const [settings, signOut] = screen.getAllByRole("menuitem");
  await user.keyboard("{ArrowDown}"); expect(document.activeElement).toBe(signOut);
  await user.keyboard("{ArrowDown}"); expect(document.activeElement).toBe(settings);
  await user.keyboard("{ArrowUp}"); expect(document.activeElement).toBe(signOut);
  await user.keyboard("{Home}"); expect(document.activeElement).toBe(settings);
  await user.keyboard("{End}"); expect(document.activeElement).toBe(signOut);
});

it("Escape closes it and puts focus back on its button", async () => {
  const { user, trigger } = setup();
  await user.click(trigger);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("Tab closes it on the way out, so nothing is left open behind focus", async () => {
  const { user, trigger } = setup();
  await user.click(trigger);
  await user.tab();
  expect(screen.queryByRole("menu")).toBeNull();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("choosing an item still does what it did", async () => {
  const { user, trigger, onProfile, onSignOut } = setup("synced");
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: /Settings/ }));
  expect(onProfile).toHaveBeenCalledTimes(1);
  await user.click(trigger);
  await user.keyboard("{End}{Enter}");
  expect(onSignOut).toHaveBeenCalledTimes(1);
});
