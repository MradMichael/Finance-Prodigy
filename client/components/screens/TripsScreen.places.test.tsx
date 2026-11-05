// Travel map plan, Phase 1b (owner-approved; wording APPROVED 2026-11-05): a
// trip's countries and cities, and its notes, in the New trip and Edit trip
// forms. Countries are picked by name; cities picked from the one bundled file
// (loaded the first time a form needs it, never on opening the screen) or
// typed. A typed city the list doesn't hold is kept as typed, with no point on
// the map. A blank name becomes the countries (lib/trips.ts, D8).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import TripsScreen from "./TripsScreen";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials } from "../../lib/localData";
import { forgetCities, type CityRow } from "../../lib/places";
import type { StoredTrip } from "../../lib/trips";

const ROWS: CityRow[] = [
  ["Lyon", "FR", 45.75, 4.85], ["Paris", "FR", 48.85, 2.35], ["Villeparisis", "FR", 48.94, 2.61],
  ["Rome", "IT", 41.89, 12.48], ["Beirut", "LB", 33.89, 35.49], ["Zahlé", "LB", 33.85, 35.9],
];
const FILE = JSON.stringify({ fields: ["name", "country", "lat", "lon"], source: "GeoNames cities15000, 2026-11-04, CC BY 4.0", rows: ROWS });
let fetchMock: ReturnType<typeof vi.fn>;
function serve(ok = true) {
  fetchMock = vi.fn(async () => (ok ? new Response(FILE) : Promise.reject(new TypeError("offline"))));
  vi.stubGlobal("fetch", fetchMock);
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); forgetCities(); });

const fin = (trips: StoredTrip[] = []) => ({ ...DEFAULT_DATA, lbpRate: 89_500, lbpRateHistory: [], transactions: [], trips }) as LocalFinancials;
function show(d: LocalFinancials = fin()) {
  const onChange = vi.fn();
  render(<ThemeProvider><TripsScreen financials={d} onChange={onChange} /></ThemeProvider>);
  return { onChange, written: () => onChange.mock.calls.at(-1)![0] as LocalFinancials };
}
const setDate = (el: HTMLElement, iso: string) => fireEvent.change(el.querySelector('input[type="date"]')!, { target: { value: iso } });
const newForm = () => within(screen.getByRole("form", { name: "New trip" }));
function dates(f = newForm()) {
  setDate(f.getByTestId("trip-start"), "2025-06-01");
  setDate(f.getByTestId("trip-end"), "2025-06-20");
}
/** Adds a country by typing and tapping its name. */
function addCountry(text: string, name: string, f = newForm()) {
  fireEvent.click(f.getByRole("button", { name: "Add a country" }));
  const boxes = f.getAllByLabelText("Country");
  fireEvent.change(boxes[boxes.length - 1], { target: { value: text } });
  fireEvent.click(f.getByRole("button", { name }));
}
/** Types a city into the last city box of the last country. */
function typeCity(text: string, f = newForm()) {
  const adds = f.getAllByRole("button", { name: "Add a city" });
  fireEvent.click(adds[adds.length - 1]);
  const boxes = f.getAllByLabelText("City");
  fireEvent.change(boxes[boxes.length - 1], { target: { value: text } });
}
const stopsOf = (d: LocalFinancials) => d.trips![0].stops!.map(({ id: _id, ...s }) => s);
const save = (f = newForm()) => fireEvent.click(f.getByRole("button", { name: "Save trip" }));

describe("the city file", () => {
  it("isn't fetched when the screen opens; it is the first time a country is added, and only once", async () => {
    serve();
    show();
    expect(fetchMock).not.toHaveBeenCalled();
    addCountry("fra", "France");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/geo/cities15000.json");
    addCountry("ita", "Italy");
    typeCity("ro");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("when it can't load, the form says so, and a typed city is still saved", async () => {
    serve(false);
    const { written } = show();
    dates();
    addCountry("leb", "Lebanon");
    expect(await newForm().findByText("The city list couldn't load. You can still type a city.")).toBeTruthy();
    typeCity("Batroun");
    save();
    expect(stopsOf(written())).toEqual([{ countryCode: "LB", city: "Batroun" }]);
  });
});

describe("a new trip's countries and cities", () => {
  it("a city picked from the list is saved with its point; a blank name becomes the countries", async () => {
    serve();
    const { written } = show();
    dates();
    addCountry("fra", "France");
    typeCity("par");
    fireEvent.click(await newForm().findByRole("button", { name: "Paris" }));
    addCountry("ita", "Italy");
    typeCity("rom");
    fireEvent.click(await newForm().findByRole("button", { name: "Rome" }));
    save();
    expect(written().trips![0].name).toBe("France, Italy");
    expect(stopsOf(written())).toEqual([
      { countryCode: "FR", city: "Paris", lat: 48.85, lon: 2.35 },
      { countryCode: "IT", city: "Rome", lat: 41.89, lon: 12.48 },
    ]);
  });

  it("searches cities without accents: \"zahle\" offers Zahlé", async () => {
    serve();
    show();
    addCountry("leb", "Lebanon");
    typeCity("zahle");
    expect(await newForm().findByRole("button", { name: "Zahlé" })).toBeTruthy();
  });

  it("a typed city that is in the list, accents aside, is saved as the list writes it, with its point", async () => {
    serve();
    const { written } = show();
    dates();
    addCountry("leb", "Lebanon");
    typeCity("zahle");
    await newForm().findByRole("button", { name: "Zahlé" });
    save();
    expect(stopsOf(written())).toEqual([{ countryCode: "LB", city: "Zahlé", lat: 33.85, lon: 35.9 }]);
  });

  it("a typed city the list doesn't hold: told it won't be on the map, and saved as typed, with no point", async () => {
    serve();
    const { written } = show();
    dates();
    addCountry("leb", "Lebanon");
    typeCity("Batroun");
    expect(await newForm().findByText("Not in the list. It'll be saved as you typed it, but won't appear on the map.")).toBeTruthy();
    save();
    expect(stopsOf(written())).toEqual([{ countryCode: "LB", city: "Batroun" }]);
  });

  it("a country with no city is saved as the country alone", async () => {
    serve();
    const { written } = show();
    dates();
    addCountry("mal", "Malta");
    save();
    expect(stopsOf(written())).toEqual([{ countryCode: "MT" }]);
    expect(written().trips![0].name).toBe("Malta");
  });

  it("rows can be removed: a city, and a whole country", async () => {
    serve();
    const { written } = show();
    dates();
    addCountry("fra", "France");
    typeCity("Lyon");
    typeCity("Paris");
    await newForm().findByRole("button", { name: "Paris" }); // the list has loaded, so Paris gets its point
    fireEvent.click(newForm().getByRole("button", { name: "Remove Lyon" }));
    addCountry("ita", "Italy");
    fireEvent.click(newForm().getByRole("button", { name: "Remove Italy" }));
    save();
    expect(stopsOf(written())).toEqual([{ countryCode: "FR", city: "Paris", lat: 48.85, lon: 2.35 }]);
  });

  it("a country typed but never picked: its exact name counts; anything else is refused with the approved line", async () => {
    serve();
    const { onChange, written } = show();
    dates();
    fireEvent.click(newForm().getByRole("button", { name: "Add a country" }));
    fireEvent.change(newForm().getByLabelText("Country"), { target: { value: "Narnia" } });
    save();
    expect(onChange).not.toHaveBeenCalled();
    expect(newForm().getByText("One of the countries or cities couldn't be saved. Check them and try again.")).toBeTruthy();
    fireEvent.change(newForm().getByLabelText("Country"), { target: { value: "lebanon" } });
    save();
    expect(stopsOf(written())).toEqual([{ countryCode: "LB" }]);
  });

  it("an empty country row that was never filled in is ignored", () => {
    serve();
    const { written } = show();
    fireEvent.change(newForm().getByLabelText("Name"), { target: { value: "Weekend" } });
    dates();
    fireEvent.click(newForm().getByRole("button", { name: "Add a country" }));
    save();
    expect(written().trips![0]).not.toHaveProperty("stops");
  });

  it("notes are saved, trimmed", () => {
    serve();
    const { written } = show();
    fireEvent.change(newForm().getByLabelText("Name"), { target: { value: "Lisbon" } });
    dates();
    fireEvent.change(newForm().getByLabelText("Notes"), { target: { value: "  Fado night in Alfama  " } });
    save();
    expect(written().trips![0].notes).toBe("Fado night in Alfama");
  });

  it("a blank name and no countries is still \"Name the trip.\"", () => {
    serve();
    const { onChange } = show();
    dates();
    save();
    expect(onChange).not.toHaveBeenCalled();
    expect(newForm().getByText("Name the trip.")).toBeTruthy();
  });
});

describe("editing a trip's countries and cities", () => {
  const EUROPE: StoredTrip = {
    id: "trip-eu", name: "Europe", startDate: "2025-06-01", endDate: "2025-06-20", budgetUSD: 0, notes: "Night trains",
    stops: [{ id: "s1", countryCode: "FR", city: "Paris", lat: 48.85, lon: 2.35 }, { id: "s2", countryCode: "IT", city: "Rome", lat: 41.89, lon: 12.48 }, { id: "s3", countryCode: "FR", city: "Lyon" }, { id: "s4", countryCode: "MT" }],
    createdAt: "2026-11-05T09:00:00.000Z", updatedAt: "2026-11-05T09:00:00.000Z",
  };
  const openEdit = () => {
    fireEvent.click(screen.getByRole("button", { name: "Edit trip" }));
    return within(screen.getByRole("form", { name: "Edit trip" }));
  };

  it("shows them in route order, and saving another change keeps every stop, ids included, and the notes", () => {
    serve();
    const { written } = show(fin([EUROPE]));
    const f = openEdit();
    expect(f.getAllByLabelText("City").map((el) => (el as HTMLInputElement).value)).toEqual(["Paris", "Rome", "Lyon"]);
    expect((f.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Night trains");
    fireEvent.change(f.getByLabelText("Budget ($)"), { target: { value: "2000" } });
    fireEvent.click(f.getByRole("button", { name: "Save changes" }));
    expect(written().trips![0].budgetUSD).toBe(2000);
    expect(written().trips![0].stops).toEqual(EUROPE.stops);
    expect(written().trips![0].notes).toBe("Night trains");
  });

  it("removing every country clears them", () => {
    serve();
    const { written } = show(fin([EUROPE]));
    const f = openEdit();
    for (const name of ["Remove France", "Remove Italy", "Remove France", "Remove Malta"]) fireEvent.click(f.getAllByRole("button", { name })[0]);
    fireEvent.click(f.getByRole("button", { name: "Save changes" }));
    expect(written().trips![0]).not.toHaveProperty("stops");
    expect(written().trips![0].name).toBe("Europe");
  });

  it("a name left blank re-fills from the countries", () => {
    serve();
    const { written } = show(fin([EUROPE]));
    const f = openEdit();
    fireEvent.change(f.getByLabelText("Name"), { target: { value: "" } });
    fireEvent.click(f.getByRole("button", { name: "Save changes" }));
    expect(written().trips![0].name).toBe("France, Italy, Malta");
  });
});
