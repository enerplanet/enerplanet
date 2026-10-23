import { describe, expect, it } from "vitest";

import { applyWeatherToConfig, weatherFromConfig } from "./weatherSettings";

describe("weatherFromConfig", () => {
  it("reads an unset or unknown weather as the typical scenario on the default archive", () => {
    expect(weatherFromConfig(null)).toEqual({ provider: null, choice: "p50" });
    expect(weatherFromConfig({ weatherScenario: "p75" })).toEqual({ provider: null, choice: "p50" });
  });

  it("prefers a real year over a scenario, as the backend does", () => {
    expect(weatherFromConfig({ weatherYear: 2018, weatherScenario: "p10", weatherProvider: "era5-land" })).toEqual({ provider: "era5-land", choice: "year" });
    expect(weatherFromConfig({ weatherScenario: "p90" })).toEqual({ provider: null, choice: "p90" });
  });
});

describe("applyWeatherToConfig", () => {
  it("replaces earlier weather keys, so a scenario does not lose to an old year", () => {
    const config: Record<string, unknown> = { weatherYear: 2018, weatherProvider: "cosmo-rea6", buildings: [] };
    applyWeatherToConfig(config, { provider: null, choice: "p10" }, 2020);
    expect(config).toEqual({ weatherScenario: "p10", buildings: [] });
  });

  it("takes the period's year for a real year", () => {
    const config: Record<string, unknown> = { weatherScenario: "p50" };
    applyWeatherToConfig(config, { provider: "merra-2", choice: "year" }, 2020);
    expect(config).toEqual({ weatherProvider: "merra-2", weatherYear: 2020 });
  });
});
