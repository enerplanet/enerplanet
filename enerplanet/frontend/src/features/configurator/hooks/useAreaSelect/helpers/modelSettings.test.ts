import { describe, expect, it } from "vitest";

import { hasUnsavedChanges, settingsChanged, type LoadedModelSettings, type ModelSettings } from "./modelSettings";

const loaded: LoadedModelSettings = { title: "Loenen", from_date: "2018-01-01", to_date: "2018-12-31", resolution: 60, config: {} };
const current: ModelSettings = { title: "Loenen", fromDate: "2018-01-01", toDate: "2018-12-31", resolution: 60, cookingCarrier: "electric", runMode: "plan", weather: { provider: null, choice: "p50" } };

describe("settingsChanged", () => {
  it("reads a model saved without cooking or mode as electric and plan", () => {
    expect(settingsChanged(loaded, current)).toBe(false);
    expect(settingsChanged({ ...loaded, config: null }, current)).toBe(false);
  });

  it("counts a changed cooking carrier or run mode", () => {
    expect(settingsChanged(loaded, { ...current, cookingCarrier: "gas" })).toBe(true);
    expect(settingsChanged(loaded, { ...current, runMode: "operate" })).toBe(true);
    expect(settingsChanged({ ...loaded, config: { mode: "operate" } }, { ...current, runMode: "operate" })).toBe(false);
  });

  it("counts a changed weather archive or weather year", () => {
    expect(settingsChanged(loaded, { ...current, weather: { provider: null, choice: "p90" } })).toBe(true);
    expect(settingsChanged(loaded, { ...current, weather: { provider: "era5-land", choice: "p50" } })).toBe(true);
    expect(settingsChanged({ ...loaded, config: { weatherScenario: "p90" } }, { ...current, weather: { provider: null, choice: "p90" } })).toBe(false);
  });

  it("counts a changed name, period or resolution", () => {
    expect(settingsChanged(loaded, { ...current, title: "Loenen 2" })).toBe(true);
    expect(settingsChanged(loaded, { ...current, toDate: "2018-06-30" })).toBe(true);
    expect(settingsChanged(loaded, { ...current, resolution: 15 })).toBe(true);
  });
});

describe("hasUnsavedChanges", () => {
  it("counts a new model as unsaved once an area is drawn", () => {
    expect(hasUnsavedChanges(false, false, 0)).toBe(false);
    expect(hasUnsavedChanges(false, false, 1)).toBe(true);
  });

  it("counts a saved model as unsaved only after an edit", () => {
    expect(hasUnsavedChanges(true, false, 1)).toBe(false);
    expect(hasUnsavedChanges(true, true, 1)).toBe(true);
  });
});
