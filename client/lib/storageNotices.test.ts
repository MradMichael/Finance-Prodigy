// Session 9 (owner): the storage-failure wording, pinned verbatim.
// A1 approved as drafted; A2 replaced by the owner's text; the pull sentence
// written in A2's style, as the owner asked ("same style of wording").
// Session 10 (owner): Profile's restore sentence replaced by the owner's text.
import { it, expect } from "vitest";
import { MERGE_NOT_STORED, PUSH_NOT_RECORDED, PUSH_NOT_RECORDED_NOTICE, RESTORE_NOT_RECORDED_NOTICE } from "./storageNotices";

it("A1, a conflict merge this device couldn't store (approved as drafted)", () => {
  expect(MERGE_NOT_STORED).toBe("Your other device's changes are in your backup, but this device's storage couldn't save them, so this device still shows what it had before. ESSA will bring them in once it can save here.");
});

it("A2, a push whose time this device couldn't note (owner's text)", () => {
  expect(PUSH_NOT_RECORDED).toBe("This device couldn't note when this backup happened. Your data is unaffected.");
  expect(PUSH_NOT_RECORDED_NOTICE).toBe("Backed up. This device couldn't note when this backup happened. Your data is unaffected.");
});

it("a restore whose time this device couldn't note (owner's text, session 10)", () => {
  expect(RESTORE_NOT_RECORDED_NOTICE).toBe("✓ Data restored from database. This device couldn't note when this restore happened; the restored data is in place. Reloading…");
});
