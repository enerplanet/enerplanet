/**
 * The weather a model's runs use, as the backend reads it from the model config
 * (run_buem's modelWeatherProvider and modelWeatherPeriod): an archive, and either
 * a scenario year (weatherScenario) or the real year of the period (weatherYear).
 */

/** p50 typical, p10 low and p90 high solar: years weather-serve stitches from archive months. "year" is the period's real year. */
export type WeatherChoice = "p50" | "p10" | "p90" | "year";

export interface WeatherSettings {
    /** Archive to use; null leaves the server's default archive. */
    provider: string | null;
    choice: WeatherChoice;
}

export const DEFAULT_WEATHER: WeatherSettings = { provider: null, choice: "p50" };

const SCENARIOS: WeatherChoice[] = ["p50", "p10", "p90"];

/** The weather a saved config asks for; anything unset or unknown reads as the default. */
export function weatherFromConfig(config: Record<string, unknown> | null | undefined): WeatherSettings {
    const provider = typeof config?.weatherProvider === "string" ? config.weatherProvider : null;
    const year = config?.weatherYear;
    if (typeof year === "number" && Number.isInteger(year) && year > 0) return { provider, choice: "year" };
    const scenario = config?.weatherScenario;
    if (typeof scenario === "string" && SCENARIOS.includes(scenario as WeatherChoice)) return { provider, choice: scenario as WeatherChoice };
    return { provider, choice: "p50" };
}

/** Writes weather into config, replacing any earlier weather keys; a real year takes the period's year. */
export function applyWeatherToConfig(config: Record<string, unknown>, weather: WeatherSettings, periodYear: number | undefined): void {
    delete config.weatherProvider;
    delete config.weatherYear;
    delete config.weatherScenario;
    if (weather.provider) config.weatherProvider = weather.provider;
    if (weather.choice === "year" && periodYear) config.weatherYear = periodYear;
    else if (weather.choice !== "year") config.weatherScenario = weather.choice;
}

export function sameWeather(a: WeatherSettings, b: WeatherSettings): boolean {
    return a.provider === b.provider && a.choice === b.choice;
}
