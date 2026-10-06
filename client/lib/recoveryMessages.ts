/**
 * What regenerating a recovery code tells the owner (FB-1b2, SEC-09). Kept
 * in one place because each sentence is a claim about which code works, and
 * the owner reviews them as a set.
 *
 * The rule behind all of them (owner, 2026-10-05): a device that can't get
 * the server to accept a new code doesn't display one. It refuses, says why,
 * and says nothing changed.
 *
 * Approved by the owner on 2026-10-05: `confirm`, `newerPassword`,
 * `unreachable`, `noServerCopy`, and the first two sentences of
 * `notOnThisDevice` (their replacement for the original message 2). On
 * 2026-10-06 `newerPassword` and `unreachable` end with "Nothing on your
 * backup or this device has changed." instead of "the code that worked
 * before still works", which an owner in SEC-09's state reads as their
 * newest code. Neither can tell such an owner apart: both stop before relink.
 * Drafted while building and sent for review before merge: the next step in
 * `notOnThisDevice`, and `notTheBackupsCode`, `noCodeRegistered`,
 * `noCopyYet`, `acceptedNotStored`, `notStored`.
 */
export const REGENERATE = {
  confirm: "Generate a new recovery code? Once the new code is accepted, your old one stops working.",

  /** The server holds a code; this device has no copy of it to prove with. */
  notOnThisDevice:
    "Your recovery code wasn't changed. This device doesn't have the recovery code your backup currently uses, so it can't replace it. " +
    "Generate the new code on the device where you got your current one. " +
    "Nothing changed: the code that worked before still works.",

  /**
   * This device's code was refused, so the server holds a different one.
   * That's where accounts already in SEC-09's state land: the code this
   * device last showed them never reached the server. It's also where a
   * device lands after another device changed the code, and nothing on the
   * device tells those apart, so each sentence holds for both. "The code that
   * worked before" isn't used here: a SEC-09 owner would read it as the
   * newest code, which is the one that doesn't work.
   */
  notTheBackupsCode:
    "Your recovery code wasn't changed. This device doesn't have the recovery code your backup currently uses, so it can't replace it. " +
    "If the last code you got on this device came from \"Generate new recovery code\", your backup may never have received it, and may still use the code you had before. " +
    "Otherwise, generate the new code on the device where you got your current one. " +
    "Nothing on your backup or this device has changed.",

  newerPassword:
    "Your recovery code wasn't changed. Your backup has a newer password than this device. Sign out and back in with your current password, then try again. " +
    "Nothing on your backup or this device has changed.",

  unreachable:
    "Your recovery code wasn't changed, because the server couldn't be reached. Nothing on your backup or this device has changed. " +
    "Try again when you're online.",

  /** The server holds a copy with no recovery code registered: /relink refuses such a row whatever it's sent. */
  noCodeRegistered:
    "Your recovery code wasn't changed. Your backup has no recovery code registered, and this device can't register one. " +
    "Nothing on your backup or this device has changed.",

  /** Shown with the code: the server says there's no copy, and backup isn't on. */
  noServerCopy: "This code works on this device. If you turn backup on, it becomes your backup's code too.",

  /** Shown with the code: backup is on, but nothing has reached the server yet. The first upload registers this code. */
  noCopyYet: "This code works on this device. Your backup has no copy yet; when it next uploads, this becomes its code too.",

  /**
   * Shown with the code: the server took it, then this device failed to
   * store it. It's shown because it works -- a reset on this device falls
   * back to the server when its own envelope doesn't open (auth.ts) -- and
   * the old code is already dead on the server.
   */
  acceptedNotStored:
    "Your backup accepted this code, but this device couldn't store it. The code still works: resetting your password with it goes through your backup.",

  /** The server says there's no copy, and this device couldn't store the new code, so nothing changed anywhere. */
  notStored: (reason: string) =>
    `Your recovery code wasn't changed, because this device couldn't store the new one. ${reason} Nothing changed: the code that worked before still works.`,
} as const;
