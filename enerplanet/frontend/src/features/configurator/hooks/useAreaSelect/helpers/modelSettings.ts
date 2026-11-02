import type { CookingCarrier, ElectricityPrices, RunMode } from "@/features/configurator/store/modelStore";
import { sameWeather, weatherFromConfig, type WeatherSettings } from "./weatherSettings";

/** A saved model's settings as loaded, before any edit. */
export interface LoadedModelSettings {
    title: string;
    from_date: string;
    to_date: string;
    resolution: number;
    config: ({ cookingCarrier?: string; mode?: string } & Record<string, unknown>) | null;
}

/** The model settings currently set in the configurator. */
export interface ModelSettings {
    title: string;
    fromDate: string;
    toDate: string;
    resolution: number;
    cookingCarrier: CookingCarrier;
    runMode: RunMode;
    weather: WeatherSettings;
    electricityPrices: ElectricityPrices;
}

const priceOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The model's own grid prices from config.electricity_prices; null where the country default applies. */
export function pricesFromConfig(config: Record<string, unknown> | null | undefined): ElectricityPrices {
    const own = (config?.electricity_prices ?? {}) as Record<string, unknown>;
    return { import_ct_per_kwh: priceOrNull(own.import_ct_per_kwh), export_ct_per_kwh: priceOrNull(own.export_ct_per_kwh) };
}

/** Whether any setting differs from the loaded model; a changed setting needs a new run. */
export function settingsChanged(loaded: LoadedModelSettings, current: ModelSettings): boolean {
    const loadedCooking = loaded.config?.cookingCarrier === "gas" ? "gas" : "electric";
    const loadedMode = loaded.config?.mode === "operate" ? "operate" : "plan";
    const loadedPrices = pricesFromConfig(loaded.config);
    return current.title !== loaded.title
        || current.fromDate !== loaded.from_date
        || current.toDate !== loaded.to_date
        || current.resolution !== loaded.resolution
        || current.cookingCarrier !== loadedCooking
        || current.runMode !== loadedMode
        || current.electricityPrices.import_ct_per_kwh !== loadedPrices.import_ct_per_kwh
        || current.electricityPrices.export_ct_per_kwh !== loadedPrices.export_ct_per_kwh
        || !sameWeather(current.weather, weatherFromConfig(loaded.config));
}

/** Whether leaving now loses work: a new model once an area is drawn, a saved model once it is edited. */
export function hasUnsavedChanges(editMode: boolean, isModified: boolean, polygonCount: number): boolean {
    return editMode ? isModified : polygonCount > 0;
}
