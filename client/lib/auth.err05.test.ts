// Session 22, item 3 (wording drafts, HELD): ERR-05 in sign-in and recovery.
// Every failure here was wrapped as "(<developer text>). Check your
// connection and try again.", even a server error, which then read "Something
// went wrong on our side ... Check your connection". Now: the connection is
// named only when the server couldn't be reached, and the server's own
// sentence is passed on as written, with no developer text.
import { it, expect, beforeEach, vi } from "vitest";
import { signIn, recoverAccount, signUp } from "./auth";
import { pullFromServer, relinkSync, confirmOverwriteIfNeeded, recordRestoreStored } from "./syncService";

vi.mock("./syncService", () => ({
  pullFromServer: vi.fn(),
  relinkSync: vi.fn(),
  getRecoveryTokenForSync: vi.fn(),
  confirmOverwriteIfNeeded: vi.fn(),
  deleteFromServer: vi.fn(),
  recordRestoreStored: vi.fn(() => true),
}));

const UNREACHABLE = { ok: false as const, unreachable: true as const, error: "Couldn't reach the server. If you're online, it may be starting up: try again in a minute." };
const SERVER_ERROR = { ok: false as const, error: "Something went wrong on our side. Your data is safe." };

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.mocked(pullFromServer).mockReset();
  vi.mocked(relinkSync).mockReset();
  vi.mocked(confirmOverwriteIfNeeded).mockReset().mockResolvedValue(true);
  vi.mocked(recordRestoreStored).mockReset().mockReturnValue(true);
});

it("signing in on a new device, with the server out of reach", async () => {
  vi.mocked(pullFromServer).mockResolvedValue(UNREACHABLE);
  expect(await signIn("vex-harbor@test.com", "password12345")).toEqual({ ok: false, error: "Couldn't verify your account: the server couldn't be reached. If you're online, it may be starting up: try again in a minute." });
});

it("signing in on a new device, with a server error: its sentence, and no blame on the connection", async () => {
  vi.mocked(pullFromServer).mockResolvedValue(SERVER_ERROR);
  expect(await signIn("vex-harbor@test.com", "password12345")).toEqual({ ok: false, error: "Couldn't verify your account right now. Something went wrong on our side. Your data is safe." });
});

it("recovering onto a new device, with the server out of reach, and with a server error", async () => {
  vi.mocked(relinkSync).mockResolvedValue(UNREACHABLE);
  expect(await recoverAccount("vex-harbor@test.com", "SOME-REAL-CODE-0000", "brandnewpassword1")).toEqual({ ok: false, error: "Couldn't reach the server, so your password wasn't reset. If you're online, it may be starting up: try again in a minute." });
  vi.mocked(relinkSync).mockResolvedValue(SERVER_ERROR);
  expect(await recoverAccount("vex-harbor@test.com", "SOME-REAL-CODE-0000", "brandnewpassword1")).toEqual({ ok: false, error: "Your password wasn't reset. Something went wrong on our side. Your data is safe." });
});

it("recovering on a device that holds the account: the same two sentences", async () => {
  const made = await signUp("vex-harbor@test.com", "Vex Harbor", "password12345");
  if (!made.ok) throw new Error(made.error);
  const code = made.recoveryCode;
  vi.mocked(relinkSync).mockResolvedValue(UNREACHABLE);
  expect(await recoverAccount("vex-harbor@test.com", code, "brandnewpassword1")).toEqual({ ok: false, error: "Couldn't reach the server, so your password wasn't reset. If you're online, it may be starting up: try again in a minute." });
  vi.mocked(relinkSync).mockResolvedValue(SERVER_ERROR);
  expect(await recoverAccount("vex-harbor@test.com", code, "brandnewpassword1")).toEqual({ ok: false, error: "Your password wasn't reset. Something went wrong on our side. Your data is safe." });
});
