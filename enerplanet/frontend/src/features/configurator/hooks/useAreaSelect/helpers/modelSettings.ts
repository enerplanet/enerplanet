import type { CookingCarrier, RunMode } from "@/features/configurator/store/modelStore";

/** A saved model's settings as loaded, before any edit. */
export interface LoadedModelSettings {
    title: string;
    from_date: string;
    to_date: string;
    resolution: number;
    config: { cookingCarrier?: string; mode?: string } | null;
}

/** The model settings currently set in the configurator. */
export interface ModelSettings {
    title: string;
    fromDate: string;
    toDate: string;
    resolution: number;
    cookingCarrier: CookingCarrier;
    runMode: RunMode;
}

/** Whether any setting differs from the loaded model; a changed setting needs a new run. */
export function settingsChanged(loaded: LoadedModelSettings, current: ModelSettings): boolean {
    const loadedCooking = loaded.config?.cookingCarrier === "gas" ? "gas" : "electric";
    const loadedMode = loaded.config?.mode === "operate" ? "operate" : "plan";
    return current.title !== loaded.title
        || current.fromDate !== loaded.from_date
        || current.toDate !== loaded.to_date
        || current.resolution !== loaded.resolution
        || current.cookingCarrier !== loadedCooking
        || current.runMode !== loadedMode;
}
