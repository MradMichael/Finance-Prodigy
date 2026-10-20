// Session 27, item 1 (owner; HELD, the prompts are drafts): the sign-in page on
// a stale device. When the server accepts a password this device doesn't
// know, the page asks for the previous one (prompt A); "I don't remember it"
// explains starting from the backup (prompt B) before doing it.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const ROUTER = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const signIn = vi.fn();
const updateDevicePassword = vi.fn();
const restartDeviceFromServer = vi.fn();
vi.mock("../../lib/auth", () => ({
  getSession: () => null,
  signIn: (...a: unknown[]) => signIn(...a),
  updateDevicePassword: (...a: unknown[]) => updateDevicePassword(...a),
  restartDeviceFromServer: (...a: unknown[]) => restartDeviceFromServer(...a),
}));

import SignInPage from "./page";
import { ThemeProvider } from "../../contexts/ThemeContext";

const A_TEXT = "Your new password works for your account. This device's data is still locked with the password it used before. Enter that password to keep everything saved on this device.";
const B_TEXT = "This device will start again from your backup on the server. Anything saved here that wasn't backed up stays on this device, still locked with the previous password. Nothing is deleted.";
const SESSION = { userId: "u1", email: "quartz@test.com", name: "Quartz Lantern" };

beforeEach(() => {
  ROUTER.push.mockReset(); signIn.mockReset(); updateDevicePassword.mockReset(); restartDeviceFromServer.mockReset();
  signIn.mockResolvedValue({ ok: false, error: "", staleDevice: true });
});
afterEach(cleanup);

async function toPromptA() {
  render(<ThemeProvider><SignInPage /></ThemeProvider>);
  fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "quartz@test.com" } });
  fireEvent.change(screen.getByLabelText("Password", { exact: true, selector: "input" }), { target: { value: "new-password-456" } });
  fireEvent.click(screen.getByRole("button", { name: /Sign in/ }));
  await screen.findByRole("heading", { name: "Bring this device up to date" });
}

it("prompt A: the heading, the text, and the previous password field", async () => {
  await toPromptA();
  expect(screen.getByText(A_TEXT)).toBeTruthy();
  expect(screen.getByLabelText("Previous password", { exact: true, selector: "input" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Keep this device's data" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "I don't remember it" })).toBeTruthy();
});

it("with the previous password: the device is updated with both passwords, then the app opens", async () => {
  updateDevicePassword.mockResolvedValue({ ok: true, session: SESSION });
  await toPromptA();
  fireEvent.change(screen.getByLabelText("Previous password", { exact: true, selector: "input" }), { target: { value: "old-password-123" } });
  fireEvent.click(screen.getByRole("button", { name: "Keep this device's data" }));
  await waitFor(() => expect(ROUTER.push).toHaveBeenCalledWith("/"));
  expect(updateDevicePassword).toHaveBeenCalledWith("quartz@test.com", "new-password-456", "old-password-123");
});

it("a wrong previous password says so and stays", async () => {
  updateDevicePassword.mockResolvedValue({ ok: false, error: "That isn't the password this device used before." });
  await toPromptA();
  fireEvent.change(screen.getByLabelText("Previous password", { exact: true, selector: "input" }), { target: { value: "nope-nope-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Keep this device's data" }));
  expect(await screen.findByText("That isn't the password this device used before.")).toBeTruthy();
  expect(ROUTER.push).not.toHaveBeenCalled();
});

it("prompt B: \"I don't remember it\" explains first; Back returns; Start from the backup does it", async () => {
  restartDeviceFromServer.mockResolvedValue({ ok: true, session: SESSION });
  await toPromptA();
  fireEvent.click(screen.getByRole("button", { name: "I don't remember it" }));
  expect(screen.getByText(B_TEXT)).toBeTruthy();
  expect(restartDeviceFromServer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByText(A_TEXT)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "I don't remember it" }));
  fireEvent.click(screen.getByRole("button", { name: "Start from the backup" }));
  await waitFor(() => expect(ROUTER.push).toHaveBeenCalledWith("/"));
  expect(restartDeviceFromServer).toHaveBeenCalledWith("quartz@test.com", "new-password-456");
});

it("an ordinary failure still shows its sentence on the form, with no prompt", async () => {
  signIn.mockResolvedValue({ ok: false, error: "Incorrect password." });
  render(<ThemeProvider><SignInPage /></ThemeProvider>);
  fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "quartz@test.com" } });
  fireEvent.change(screen.getByLabelText("Password", { exact: true, selector: "input" }), { target: { value: "typo-typo-1" } });
  fireEvent.click(screen.getByRole("button", { name: /Sign in/ }));
  expect(await screen.findByText("Incorrect password.")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Bring this device up to date" })).toBeNull();
});
