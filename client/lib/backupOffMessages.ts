import type { SyncResult } from "./syncService";

/**
 * Session 23, item 6; the owner's wording, approved with edits in session 24: Profile's sentence when backup is turned off but the
 * server copy couldn't be deleted. ERR-05's "try again in a minute" and the old frame's "Try again," would
 * both appear, so the unreached server and a reply without the API's own error get one sentence each.
 * The API's own errors keep today's frame.
 */
export function backupOffDeleteFailed(result: SyncResult | null | undefined): string {
  if (result?.unreachable) return "Backup is off, but the server couldn't be reached, so its copy wasn't deleted. If you're online, it may be starting up: try again in a minute.";
  if (result?.serverStatus) return `Backup is off, but the server had a problem (error ${result.serverStatus}), so its copy wasn't deleted. Try again in a minute.`;
  return "Backup is off, but deleting the server copy failed: " + (result?.error ?? "unknown error") + " Try again, or delete your account to remove it.";
}
