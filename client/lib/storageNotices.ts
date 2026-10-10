// Storage-failure wording (session 8, item 6; owner, session 9). Each says
// storage is the problem and what is actually on this device. A1 approved as
// drafted; A2 the owner's text; the restore sentence the owner's (session
// 10). Pinned verbatim in storageNotices.test.ts.

/** A1: a conflict merge reached the backup, but storing it on this device failed (the save-error banner gives the reason). */
export const MERGE_NOT_STORED =
  "Your other device's changes are in your backup, but this device's storage couldn't save them, so this device still shows what it had before. ESSA will bring them in once it can save here.";

/** A2: the server took a push, but this device couldn't note when (its sync time). Shown after "Backed up." or "✓ Pushed to database.". */
export const PUSH_NOT_RECORDED = "This device couldn't note when this backup happened. Your data is unaffected.";

/** The dashboard's form of it, after an automatic backup. */
export const PUSH_NOT_RECORDED_NOTICE = "Backed up. " + PUSH_NOT_RECORDED;

/** Profile's Restore: the copy is stored, but this device couldn't note when (owner's text, session 10). */
export const RESTORE_NOT_RECORDED_NOTICE =
  "✓ Data restored from database. This device couldn't note when this restore happened; the restored data is in place. Reloading…";
