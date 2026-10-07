// Owner, 2026-10-07: "Offline" only when the device is actually offline; a
// server error or a wait that runs out reads "Couldn't reach backup", in the
// sidebar's short form and the account menu's long form alike.
import { describe, it, expect } from "vitest";
import { syncStatusShortLabel, syncStatusLongLabel, syncStatusColor } from "./SyncDot";

const T = { jade: "jade", brass: "brass", coral: "coral", mute: "mute" } as unknown as Parameters<typeof syncStatusColor>[1];

describe("the 'unreachable' status", () => {
  it("says 'Couldn't reach backup', short and long", () => {
    expect(syncStatusShortLabel("unreachable")).toBe("Couldn't reach backup");
    expect(syncStatusLongLabel("unreachable")).toBe("Couldn't reach backup");
  });

  it("is as quiet as 'Offline' (muted, not the conflict's coral)", () => {
    expect(syncStatusColor("unreachable", T)).toBe("mute");
  });

  it("leaves 'Offline' as it was", () => {
    expect(syncStatusShortLabel("offline")).toBe("Offline");
    expect(syncStatusLongLabel("offline")).toBe("Sync offline — changes saved on this device only");
  });
});
