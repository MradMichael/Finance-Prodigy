// FB-1b2: SEC-09 -- a regenerated recovery code reaches the server, or is not
// shown (2026-10-05).
//
// Regenerating used to re-wrap the key on this device and then push, and a
// push keeps an already-registered recovery hash (server/src/routes/sync.ts
// :177). So with backup on, the OLD code kept passing /relink and the new one
// -- the one the owner had just been told to save -- failed. The owner's rule:
// a device that can't get the server to accept a new code must not display
// one. It refuses, says why, and says nothing changed.
//
// Now the new code is made in memory, the server is asked what it holds (a
// pull whose body is discarded and which records nothing), and the code is
// kept -- and shown -- only once /relink's existing old-token branch has
// accepted it, or when there's no server copy for it to matter to.
//
// Whether to ask the server at all follows the recorded backup state. It is
// skipped only when backup is off AND the copy was deleted, or was confirmed
// never to have existed (COPY-11: the address isn't sent when nothing can
// exist). Every other state asks, including an older off choice with nothing
// recorded and an account that has never answered (owner, 2026-10-05: fail
// closed).
//
// Real crypto and real account records throughout; only the network is
// replaced, by a fake server answering the two routes this touches.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { signUp, signIn, regenerateRecoveryCode, getRecoveryTokenForSync } from "./auth";
import { deriveRecoveryToken, getSyncToken, unwrapWithRecoveryCode } from "./crypto";
import { DEFAULT_DATA, saveData, type LocalFinancials } from "./localData";

const EMAIL = "a@test.com";
const USERS_KEY = "essa_users_v1";
const LAST_SYNC_KEY = "essa_last_sync";

// ── the owner-approved and drafted wording, asserted verbatim ──
const NOT_ON_THIS_DEVICE = "Your recovery code wasn't changed. This device doesn't have the recovery code your backup currently uses, so it can't replace it. Generate the new code on the device where you got your current one. Nothing changed: the code that worked before still works.";
const NOT_THE_BACKUPS = "Your recovery code wasn't changed. This device doesn't have the recovery code your backup currently uses, so it can't replace it. If the last code you got on this device came from \"Generate new recovery code\", your backup may never have received it, and may still use the code you had before. Otherwise, generate the new code on the device where you got your current one. Nothing on your backup or this device has changed.";
const NEWER_PASSWORD = "Your recovery code wasn't changed. Your backup has a newer password than this device. Sign out and back in with your current password, then try again. Nothing changed: the code that worked before still works.";
const UNREACHABLE = "Your recovery code wasn't changed, because the server couldn't be reached. Nothing changed: the code that worked before still works. Try again when you're online.";
const NO_CODE_REGISTERED = "Your recovery code wasn't changed. Your backup has no recovery code registered, and this device can't register one. Nothing on your backup or this device has changed.";
const NO_SERVER_COPY = "This code works on this device. If you turn backup on, it becomes your backup's code too.";
const NO_COPY_YET = "This code works on this device. Your backup has no copy yet; when it next uploads, this becomes its code too.";
const ACCEPTED_NOT_STORED = "Your backup accepted this code, but this device couldn't store it. The code still works: resetting your password with it goes through your backup.";
const notStored = (reason: string) => `Your recovery code wasn't changed, because this device couldn't store the new one. ${reason} Nothing changed: the code that worked before still works.`;

// ── the fake server ──
type Answer = { status: number; body?: unknown } | "offline";
const COPY: Answer = { status: 200, body: { ok: true, data: { income: 1 }, syncedAt: "2026-10-05T08:00:00.000Z", hasRecoveryCode: true } };
const COPY_NO_CODE: Answer = { status: 200, body: { ok: true, data: { income: 1 }, syncedAt: "2026-10-05T08:00:00.000Z", hasRecoveryCode: false } };
const NONE: Answer = { status: 404, body: { error: "No sync data found for this account." } };
const PLATFORM_404: Answer = { status: 404 };
const WRONG_PASSWORD: Answer = { status: 401, body: { error: "Invalid sync credentials for this account." } };
const UNREGISTERED: Answer = { status: 401, body: { error: "This account has no sync credentials registered yet. Push from an updated client first." } };
const RELINK_OK: Answer = { status: 200, body: { ok: true } };
const RELINK_REFUSED: Answer = { status: 401, body: { error: "Could not verify ownership of this account's sync data." } };
const BUSY: Answer = { status: 409, body: { error: "Sync is busy. Please try again." } };

let pull: Answer;
let relink: Answer;
let calls: { url: string; init: RequestInit; body: Record<string, unknown> }[];
const fetchFake = vi.fn(async (url: string, init: RequestInit) => {
  calls.push({ url, init, body: init.body ? JSON.parse(String(init.body)) : {} });
  const a = url === "/api/sync/pull" ? pull : url === "/api/sync/relink" ? relink : { status: 500, body: { error: "unexpected route" } };
  if (a === "offline") throw new TypeError("Failed to fetch");
  return new Response(a.body === undefined ? "<html>Not Found</html>" : JSON.stringify(a.body), { status: a.status });
});
const relinkCalls = () => calls.filter((c) => c.url === "/api/sync/relink");

// ── one real account, made once and restored before every test ──
let signupCode: string;
let userId: string;
let localSnapshot: Record<string, string>;
let sessionSnapshot: Record<string, string>;
const dump = (s: Storage) => Object.fromEntries(Object.keys(s).map((k) => [k, s.getItem(k)!]));
const restore = (s: Storage, snap: Record<string, string>) => { s.clear(); for (const [k, v] of Object.entries(snap)) s.setItem(k, v); };
const users = (): Record<string, unknown>[] => JSON.parse(localStorage.getItem(USERS_KEY) ?? "[]");
const record = () => users().find((u) => u.email === EMAIL)!;

beforeAll(async () => {
  localStorage.clear(); sessionStorage.clear();
  const reg = await signUp(EMAIL, "Quartz Runner", "password12345");
  if (!reg.ok) throw new Error("setup: " + reg.error);
  const s = await signIn(EMAIL, "password12345");
  if (!s.ok) throw new Error("setup: sign-in");
  signupCode = reg.recoveryCode;
  userId = record().id as string;
  localSnapshot = dump(localStorage);
  sessionSnapshot = dump(sessionStorage);
}, 30_000);

beforeEach(() => {
  restore(localStorage, localSnapshot);
  restore(sessionStorage, sessionSnapshot);
  calls = [];
  pull = COPY; relink = RELINK_OK;
  vi.stubGlobal("fetch", fetchFake);
  fetchFake.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type Choice = LocalFinancials["syncChoice"];
const AT = "2026-09-28T10:00:00.000Z";
const ON: Choice = { enabled: true, decidedAt: AT };
async function withChoice(choice: Choice) {
  await saveData({ ...DEFAULT_DATA, income: 3000, ...(choice ? { syncChoice: choice } : {}) } as LocalFinancials, userId);
}
/** The account record as stored, to compare byte for byte. */
const usersBlob = () => localStorage.getItem(USERS_KEY);

async function expectRefused(error: string) {
  const before = usersBlob();
  const r = await regenerateRecoveryCode(userId);
  expect(r).toEqual({ ok: false, error });
  // Nothing written on this device: not the envelope, not the token.
  expect(usersBlob()).toBe(before);
  // And the code that worked before still unlocks this device's key.
  expect(await unwrapWithRecoveryCode(signupCode, userId, record().wrappedDekRecovery as never)).not.toBeNull();
}

describe("backup on, a server copy holding this device's code: relink first, then show", () => {
  it("the server accepts: the code is shown, kept here, and relink got exactly the right three tokens", async () => {
    await withChoice(ON);
    const r = await regenerateRecoveryCode(userId);
    if (!r.ok) throw new Error("refused: " + r.error);
    expect(r.note).toBeUndefined();

    const [call] = relinkCalls();
    expect(relinkCalls()).toHaveLength(1);
    expect(call.body.email).toBe(EMAIL);
    // The password token just proven current by the probe, so the server
    // rewrites its own to the same value.
    expect(call.body.token).toBe(getSyncToken());
    expect(call.body.recoveryToken).toBe(await deriveRecoveryToken(r.recoveryCode, EMAIL));
    // The proof is the code this device holds now -- the sign-up code.
    expect(call.body.oldRecoveryToken).toBe(await deriveRecoveryToken(signupCode, EMAIL));

    // Kept locally: the new code unlocks the key, the old one no longer does,
    // and the stored token is the new one.
    expect(await unwrapWithRecoveryCode(r.recoveryCode, userId, record().wrappedDekRecovery as never)).not.toBeNull();
    expect(await unwrapWithRecoveryCode(signupCode, userId, record().wrappedDekRecovery as never)).toBeNull();
    expect(await getRecoveryTokenForSync(EMAIL)).toBe(await deriveRecoveryToken(r.recoveryCode, EMAIL));
  }, 20_000);

  it("asking the server writes nothing: no last-sync time, and the pulled body is not kept", async () => {
    await withChoice(ON);
    const before = Object.keys(localStorage).sort();
    await regenerateRecoveryCode(userId);
    expect(localStorage.getItem(LAST_SYNC_KEY)).toBeNull();
    // Only the account record changed; no new keys (the server's data is discarded).
    expect(Object.keys(localStorage).sort()).toEqual(before);
    const probe = calls.find((c) => c.url === "/api/sync/pull")!;
    expect(probe.init.method).toBe("POST");
    expect((probe.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${getSyncToken()}`);
  }, 20_000);

  it("the server refuses this device's code: refused, nothing written, no code (the SEC-09 wording)", async () => {
    await withChoice(ON);
    relink = RELINK_REFUSED;
    await expectRefused(NOT_THE_BACKUPS);
  }, 20_000);

  it("this device holds no code to prove with: refused, and relink is never called", async () => {
    await withChoice(ON);
    localStorage.setItem(USERS_KEY, JSON.stringify(users().map((u) => {
      const { recoveryTokenEnc: _drop, ...rest } = u;
      return rest;
    })));
    await expectRefused(NOT_ON_THIS_DEVICE);
    expect(relinkCalls()).toHaveLength(0);
  }, 20_000);

  it("a device still holding the pre-FB-1b plaintext proves with it, and keeps no plaintext afterwards", async () => {
    await withChoice(ON);
    const legacy = await deriveRecoveryToken(signupCode, EMAIL);
    localStorage.setItem(USERS_KEY, JSON.stringify(users().map((u) => {
      const { recoveryTokenEnc: _drop, ...rest } = u;
      return { ...rest, recoveryTokenForSync: legacy };
    })));
    const r = await regenerateRecoveryCode(userId);
    if (!r.ok) throw new Error("refused: " + r.error);
    expect(relinkCalls()[0].body.oldRecoveryToken).toBe(legacy);
    expect("recoveryTokenForSync" in record()).toBe(false);
    expect(Object.values(localStorage).join("\n")).not.toContain(legacy);
  }, 20_000);
});

describe("every way the server can't accept it is a refusal that changes nothing", () => {
  it.each([
    ["the server says this device's password is out of date", WRONG_PASSWORD, NEWER_PASSWORD],
    ["the copy has no recovery code registered at all", COPY_NO_CODE, NO_CODE_REGISTERED],
    ["the copy has no password token registered at all", UNREGISTERED, NO_CODE_REGISTERED],
    ["the server can't be reached", "offline" as Answer, UNREACHABLE],
    ["a 404 that isn't the API's (a platform error page)", PLATFORM_404, UNREACHABLE],
  ])("asking: %s", async (_label, answer, message) => {
    await withChoice(ON);
    pull = answer;
    await expectRefused(message);
    expect(relinkCalls()).toHaveLength(0);
  }, 20_000);

  it.each([
    ["the server can't be reached", "offline" as Answer],
    ["the server is busy", BUSY],
  ])("at relink: %s", async (_label, answer) => {
    await withChoice(ON);
    relink = answer;
    await expectRefused(UNREACHABLE);
  }, 20_000);

  it("a session without its sync token can't ask, so it refuses", async () => {
    await withChoice(ON);
    sessionStorage.removeItem("essa_st_v1");
    await expectRefused("Your session isn't fully unlocked. Sign out and back in, then try again.");
    expect(calls).toHaveLength(0);
  }, 20_000);
});

describe("no server copy: the code is kept and shown, and says it works on this device", () => {
  it("backup undecided, the server has nothing: shown with the 'turn backup on' note", async () => {
    await withChoice(undefined);
    pull = NONE;
    const r = await regenerateRecoveryCode(userId);
    if (!r.ok) throw new Error("refused: " + r.error);
    expect(r.note).toBe(NO_SERVER_COPY);
    expect(relinkCalls()).toHaveLength(0);
    expect(await getRecoveryTokenForSync(EMAIL)).toBe(await deriveRecoveryToken(r.recoveryCode, EMAIL));
  }, 20_000);

  it("backup on but nothing uploaded yet: the note says it becomes the backup's code on the next upload", async () => {
    await withChoice(ON);
    pull = NONE;
    const r = await regenerateRecoveryCode(userId);
    if (!r.ok) throw new Error("refused: " + r.error);
    expect(r.note).toBe(NO_COPY_YET);
  }, 20_000);
});

describe("whether to ask the server follows the recorded backup state", () => {
  const offWith = (serverCopy?: "kept" | "deleted" | "none"): Choice =>
    ({ enabled: false, decidedAt: AT, ...(serverCopy ? { serverCopy } : {}) }) as Choice;

  it.each([
    ["backup on", ON],
    ["off, copy kept", offWith("kept")],
    ["off, chosen before this was recorded (fail closed)", offWith()],
    ["never answered (fail closed)", undefined],
  ])("asks: %s", async (_label, choice) => {
    await withChoice(choice);
    await regenerateRecoveryCode(userId);
    expect(calls.filter((c) => c.url === "/api/sync/pull")).toHaveLength(1);
  }, 20_000);

  it.each([
    ["off, copy deleted", offWith("deleted")],
    ["off, confirmed there was never a copy", offWith("none")],
  ])("doesn't ask, and sends nothing at all: %s", async (_label, choice) => {
    await withChoice(choice);
    const r = await regenerateRecoveryCode(userId);
    if (!r.ok) throw new Error("refused: " + r.error);
    // COPY-11: not the address, not anything.
    expect(fetchFake).not.toHaveBeenCalled();
    expect(r.note).toBe(NO_SERVER_COPY);
  }, 20_000);
});

describe("when this device can't store the new code", () => {
  /** Makes the next write of the account record fail the way a full browser does. */
  function failNextUsersWrite() {
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === USERS_KEY) {
        vi.mocked(Storage.prototype.setItem).mockRestore();
        throw new DOMException("quota", "QuotaExceededError");
      }
      return real.call(this, k, v);
    });
  }

  it("after the server accepted it: still shown, because it works, with a note saying this device didn't keep it", async () => {
    await withChoice(ON);
    const before = usersBlob();
    failNextUsersWrite();
    const r = await regenerateRecoveryCode(userId);
    if (!r.ok) throw new Error("refused: " + r.error);
    expect(r.note).toBe(ACCEPTED_NOT_STORED);
    expect(relinkCalls()).toHaveLength(1);
    expect(usersBlob()).toBe(before);
  }, 20_000);

  it("with no server copy: refused, no code, nothing changed", async () => {
    await withChoice({ enabled: false, decidedAt: AT, serverCopy: "deleted" } as Choice);
    failNextUsersWrite();
    await expectRefused(notStored("This browser has run out of storage space for ESSA."));
  }, 20_000);
});
