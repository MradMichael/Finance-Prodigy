// One local-day formatter (owner, 2026-10-07, session 3 item 1). Balance
// Check built "dd/mm/yyyy of the LOCAL day" twice, by hand: once for the
// cycle's last moment (the late-close sentence) and once for instants
// (closed on, reopened on, accounted for on). Both now call fmtLocalDay.
//
// Each expectation is computed in this run's own zone, so the file holds in
// UTC, east of it and west of it alike; the instants are picked so that the
// UTC day and the local day differ on at least one side of UTC.
import { it, expect } from "vitest";
import { fmtLocalDay } from "./localData";

const localLabel = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

it("names an instant's LOCAL day, not its UTC day", () => {
  for (const iso of ["2026-09-26T21:30:00.000Z", "2026-09-27T05:30:00.000Z"]) {
    expect(fmtLocalDay(new Date(iso))).toBe(localLabel(new Date(iso)));
  }
});

it("the last moment of a local day is still that day", () => {
  const lastMoment = new Date(2026, 8, 27, 0, 0, 0, 0).getTime() - 1; // 26 Sep, 23:59:59.999 local
  expect(fmtLocalDay(new Date(lastMoment))).toBe("26/09/2026");
});
