/** The `weather` module's tests: the year belongs to the period, and `null` provider means the default. */
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

/** The period every case starts from, named once for the same reason. */
const FROM_DATE = "2025-01-01";

/** A projection holding just a selection. */
function holding(selection: WeatherSelection): Partial<ModelData> {
  return { [SELECTION]: selection };
}

/** A period, and the selection the panel opens with — what a session holds by the time this node is reached. */
const READY: Partial<ModelData> = {
  fromDate: FROM_DATE,
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

  it("writes the selection, requires the period, and knows what it can affect", () => {
    expect(weather.module.params.map((param) => param.port).sort()).toEqual([
      "buildingParams",
      "fromDate",
      SELECTION,
    ]);
    // The period is required: this module's choice is finished only with it.
    expect(weather.module.params.filter((param) => param.required === true).map((p) => p.port)).toEqual([
      "fromDate",
    ]);
    // `buildingParams` is declared because the cascade can remove it when the weather changes.
  });

  it("declares the edges it actually has, leaving transitivity to the module that owns it", () => {
    // Invalidation is transitive: the far edge belongs to `building-demand`.
    expect([...weather.module.affect[SELECTION]!]).toEqual(["buildingParams"]);
    // The period edge is real: a recorded year comes from the period.
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
    // No `year` key: a scenario has no calendar year.
    expect(store.data.weatherSelection).not.toHaveProperty("year");
  });

  it("takes the year from the period when the choice is a recorded year", async () => {
    choose({ provider: null, choice: "year" });

    const { store } = await runInScratch({ module: weather.module, mock: READY });

    expect(store.data.weatherSelection).toEqual({ provider: null, choice: "year", year: 2025 });
  });

  it("keeps `null` as the archive, rather than writing the default's name", async () => {
    // `null` means the server's default, so a save omits the key.
    choose({ provider: null, choice: "p50" });

    const { store } = await runInScratch({ module: weather.module, mock: READY });

    expect(store.data.weatherSelection?.provider).toBeNull();
  });

  it("stores an explicitly chosen archive", async () => {
    choose({ provider: "era5-land", choice: "p50" });

    const { store } = await runInScratch({ module: weather.module, mock: READY });

    expect(store.data.weatherSelection?.provider).toBe("era5-land");
  });

  it("changes no data but still records the run when the choice would change nothing", async () => {
    // Re-clicking the chosen option changes nothing but still seals a zero-diff transaction.
    choose({ provider: null, choice: "p50" });

    const { store } = await runInScratch({ module: weather.module, mock: READY });

    expect(store.log).toHaveLength(1);
    expect(store.log[0].primary).toHaveLength(0);
    expect(store.data.weatherSelection).toEqual(DEFAULT_SELECTION);
  });

  it("changes nothing on a bare run, but still records that it ran", async () => {
    const { store } = await runInScratch({ module: weather.module, mock: READY });

    expect(store.log).toHaveLength(1);
    expect(store.log[0].primary).toHaveLength(0);
  });
});

describe("weather's gate", () => {
  it("reports a recorded year with no period to take it from", () => {
    // The node stays unfinished: the year it needs lives on the period.
    expect(issuesFor(holding({ provider: null, choice: "year" }))).toEqual([
      { port: SELECTION, message: "Set the model's period before running on a recorded year." },
    ]);
  });

  it("says nothing before a choice exists, and nothing once it is usable", () => {
    // Silence means nothing chosen yet, or a choice that is complete.
    expect(issuesFor({})).toEqual([]);
    expect(issuesFor(holding(DEFAULT_SELECTION))).toEqual([]);
    expect(
      issuesFor({
        fromDate: FROM_DATE,
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
    expect(yearOf(FROM_DATE)).toBe(2025);
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
    // The provider slot: `null` means "none yet".
    const installed = { listArchives: () => Promise.resolve({ defaultProvider: null, archives: {} }) };
    setWeatherSource(installed);
    setWeatherSource(null);
  });
});
