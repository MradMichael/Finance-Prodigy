// DRAFTS, held for the owner's approval (session 8, item 6). None of this is
// approved wording; the branch that uses it is held until it is.
//
// Each says storage is the problem and what is actually on this device.

/** A conflict merge reached the backup, but storing it on this device failed (the save-error banner gives the reason). */
export const MERGE_NOT_STORED =
  "Your other device's changes are in your backup, but this device's storage couldn't save them, so this device still shows what it had before. ESSA will bring them in once it can save here.";

/** The server took a push, but this device couldn't record when (its sync time). Shown after "Backed up." or "✓ Pushed to database.". */
export const PUSH_NOT_RECORDED =
  "This device's storage couldn't record the backup, but everything on this device is unchanged.";

/** The dashboard's form of it, after an automatic backup. */
export const PUSH_NOT_RECORDED_NOTICE = "Backed up. " + PUSH_NOT_RECORDED;
