/**
 * The `weather` module's tests.
 *
 * Written failing first.
 *
 * Two things are pinned here, and they are the two the legacy taught: **the year belongs to the period, not
 * to the scenario**, and **`provider: null` means the server's default rather than "unset"**. Both are easy
 * to get subtly wrong, and both would only show up as a wrong `weatherYear`/`weatherProvider` on the wire —
 * which is invisible until a run behaves oddly.
 *
 * (The rules the core enforces — undeclared writes, clobber, the required gate — are demonstrated in the
 * example module's tests. This file is about *this* module.)
 */
import { describe, expect, it } from "vitest";
import { contractIssues, runInScratch, type ModelData, type WeatherSelection } from "@model-builder/core";
import weather, {
  DEFAULT_SELECTION,
  hold,
  issuesFor,
  sameSelection,
  setWeatherSource,
  yearOf,
} from "./index";

const NODE = weather.module.id;

/** The port this module writes, named once so the cases and the gate speak about the same thing. */
const SELECTION = "weatherSelection";

/** A projection holding just a selection — the shape the module's gate is asked about, and the one place
 *  this key is written. */
function holding(selection: WeatherSelection): Partial<ModelData> {
  return { weatherSelection: selection };
}

/** A period, and the selection the panel opens with — what a session holds by the time this node is reached. */
const READY: Partial<ModelData> = {
  fromDate: "2025-01-01",
  toDate: "2025-12-31",
  ...holding(DEFAULT_SELECTION),
};

/** Hand the module a choice the way its panel does: one gesture, one hold. */
function choose(selection: WeatherSelection): void {
  hold(NODE, holding(selection));
}

describe("weather's declaration", () => {
  it("is consistent with the contract", () => {
    expect(contractIssues(weather)).toEqual([]);
  });

  it("writes the selection, reads the period, and knows what it can affect — requiring none of them", () => {
    // `fromDate` is not required on purpose: a scenario needs no period, so demanding one would make this node
    // unplaceable before `model-start` — which is not true of the legacy.
    expect(weather.module.params.map((param) => param.port).sort()).toEqual([
      "buildingParams",
      "fromDate",
      SELECTION,
    ]);
    // Declaring a port is not claiming to write it: `buildingParams` is here because the cascade can remove it
    // when the weather changes (T7), and a module must know every port it can affect.
    expect(weather.module.params.filter((param) => param.required === true)).toEqual([]);
  });

  it("declares the edges it actually has, leaving transitivity to the module that owns it", () => {
    // Invalidation is transitive (T7), so `building-demand` declares the step to `technologies`; writing that
    // far edge here would claim a coupling that belongs to another module.
    expect([...weather.module.affect.weatherSelection!]).toEqual(["buildingParams"]);
    // The period edge is real and was found by the influence prober (T8), not by reading: a recorded year
    // comes from the period, so changing the period invalidates the selection.
    expect([...weather.module.affect.fromDate!]).toEqual([SELECTION]);
  });

  it("renders in the sidebar alone", () => {
    expect([...weather.module.layout]).toEqual(["sidebar"]);
  });
});

describe("weather's run", () => {
  it("stores a scenario without inventing a year for it", async () => {
    choose({ provider: null, choice: "p90" });

    const { store, error } = await runInScratch({ module: weather.module, mock: READY });

    expect(error).toBeUndefined();
    expect(store.data.weatherSelection).toEqual({ provider: null, choice: "p90" });
    // No `year` key at all: a scenario has no calendar year, and a fake one is how the legacy's non-leap
    // convention would end up in the wrong place.
    expect(store.data.weatherSelection).not.toHaveProperty("year");
  });

  it("takes the year from the period when the choice is a recorded year", async () => {
    choose({ provider: null, choice: "year" });

    const { store } = await runInScratch({ module: weather.module, mock: READY });

    expect(store.data.weatherSelection).toEqual({ provider: null, choice: "year", year: 2025 });
  });

  it("keeps `null` as the archive, rather than writing the default's name", async () => {
    // `null` means "the server's default", so a save omits the key. Writing the name would freeze today's
    // default into every model.
    choose({ provider: null, choice: "p50" });

    const { store } = await runInScratch({ module: weather.module, mock: READY });

    expect(store.data.weatherSelection?.provider).toBeNull();
  });

  it("stores an explicitly chosen archive", async () => {
    choose({ provider: "era5-land", choice: "p50" });

    const { store } = await runInScratch({ module: weather.module, mock: READY });

    expect(store.data.weatherSelection?.provider).toBe("era5-land");
  });

  it("writes nothing when the choice would change nothing", async () => {
    // Clicking the option that is already chosen must not seal a transaction — the module compares instead of
    // trusting the click.
    choose({ provider: null, choice: "p50" });

    const { store } = await runInScratch({ module: weather.module, mock: READY });

    expect(store.log).toHaveLength(0);
  });

  it("writes nothing at all when no control collected anything", async () => {
    const { store } = await runInScratch({ module: weather.module, mock: READY });

    expect(store.log).toHaveLength(0);
  });
});

describe("weather's gate", () => {
  it("reports a recorded year with no period to take it from", () => {
    // The module's own completeness claim (T22). The choice was made, but it cannot be finished: the year it
    // needs lives on the period. The node stays unfinished, so the flow rests here.
    expect(issuesFor(holding({ provider: null, choice: "year" }))).toEqual([
      { port: SELECTION, message: "Set the model's period before running on a recorded year." },
    ]);
  });

  it("says nothing before a choice exists, and nothing once it is usable", () => {
    // Silence means two different things, both correct: nothing chosen yet (the node is `pending`, not
    // stale), and a choice that is complete.
    expect(issuesFor({})).toEqual([]);
    expect(issuesFor(holding(DEFAULT_SELECTION))).toEqual([]);
    expect(
      issuesFor({
        fromDate: "2025-01-01",
        ...holding({ provider: null, choice: "year", year: 2025 }),
      }),
    ).toEqual([]);
  });

  it("reports through the node's own validate()", async () => {
    // The same answer the position asks for, which is what makes "all nodes done" mean the model is whole.
    const { issues } = await runInScratch({
      module: weather.module,
      mock: holding({ provider: null, choice: "year" }),
    });

    expect(issues.map((issue) => issue.port)).toEqual([SELECTION]);
  });
});

describe("weather's helpers", () => {
  it("reads a year off an ISO date, and refuses what it cannot read", () => {
    expect(yearOf("2025-01-01")).toBe(2025);
    expect(yearOf("1999-12-31")).toBe(1999);
    expect(yearOf(undefined)).toBeUndefined();
    expect(yearOf("not-a-date")).toBeUndefined();
    expect(yearOf("0000-01-01")).toBeUndefined();
  });

  it("compares selections by their fields, since they are objects", () => {
    expect(sameSelection({ provider: null, choice: "p50" }, { provider: null, choice: "p50" })).toBe(true);
    expect(sameSelection({ provider: null, choice: "p50" }, { provider: null, choice: "p90" })).toBe(false);
    expect(sameSelection({ provider: null, choice: "p50" }, { provider: "era5-land", choice: "p50" })).toBe(false);
    // An undefined *case* is a selection too: absent is not equal to present.
    expect(sameSelection(undefined, undefined)).toBe(true);
    expect(sameSelection(undefined, { provider: null, choice: "p50" })).toBe(false);
  });

  it("hands the source over rather than reaching for one", () => {
    // The provider slot: the module never learns which client it has. A host installs one, a test installs a
    // fake, and `null` means "none yet" — which is what keeps this file free of any HTTP arrangement.
    const installed = { listArchives: () => Promise.resolve({ defaultProvider: null, archives: {} }) };
    setWeatherSource(installed);
    setWeatherSource(null);
  });
});
