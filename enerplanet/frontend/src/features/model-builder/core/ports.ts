/**
 * The port catalog — the store's typed surface (`Modules.md` §2).
 *
 * A *port* is a typed key in the store. Modules never talk to each other: they read
 * ports and write ports, and every write goes through one reducer. Vector-keyed ports
 * (`buildingParams`, `technologies`) are an **open set** — registering a new energy
 * carrier is adding a vector, never a redesign (`Plan.md` §2.4/§3).
 */

/**
 * Energy carriers we ship. The set is open: any string is a legal vector key, so a
 * module for a new carrier needs no change here, in the reducer, or in the engine.
 */
export const ENERGY_VECTORS = ["electricity", "heat"] as const;

export type KnownEnergyVector = (typeof ENERGY_VECTORS)[number];

/** A carrier key. `KnownEnergyVector`s autocomplete; anything else is accepted. */
export type EnergyVector = KnownEnergyVector | (string & {});

/**
 * Demand parameters for one building under one carrier (produced by `building-demand`).
 * Free-form beyond the fields the flow itself needs.
 */
export interface BuildingParams {
  fClass?: string;
  yearlyKwh?: number;
  peakKw?: number;
  [key: string]: unknown;
}

/**
 * One technology assigned to one building. `inputVector → outputVector` is what makes a
 * heat pump (`electricity → heat`) first-class instead of a special case.
 */
export interface TechAssignment {
  techId: string;
  inputVector?: EnergyVector;
  outputVector?: EnergyVector;
  params?: Record<string, unknown>;
}

export interface RegionRef {
  country: string;
  state: string;
  boundary?: GeoJSON.GeoJsonObject;
}

/**
 * Drawn area: one entry per polygon, each an outer ring of `[lon, lat]` pairs
 * (EPSG:4326). Matches the legacy `polygonCoordinates`; the save node wraps each ring
 * into a MultiPolygon on the way out.
 */
export type Coordinates = [number, number][][];

/**
 * The weather a model's runs use (`Modules.md` §5, `modules/weather.md`).
 *
 * The shape is the legacy's, deliberately. Its `WeatherSettings` is `{ provider: string | null; choice }`
 * and its `isScenario(weather)` is simply `choice !== "year"` — so an explicit `mode` field would be a
 * second way to say something already said, and the spec's earlier `scenario | year` mode was that
 * duplication. `WeatherChoice` is the choice itself, `year` meaning the period's recorded weather.
 *
 * `provider: null` means "the server's default archive", not "unset" — which is why a save omits the key
 * rather than writing a default value. That is the legacy's own reading (`weatherFromConfig`), and a
 * distinction worth keeping: the default archive can change server-side without rewriting anyone's model.
 */
export type WeatherChoice = "p50" | "p10" | "p90" | "year";

export interface WeatherSelection {
  /** The archive, or `null` for the server's default. */
  provider: string | null;
  /** `p50` typical / `p10` low / `p90` high solar, or `year` for the period's recorded weather. */
  choice: WeatherChoice;
  /**
   * The resolved calendar year, filled when the choice is `year` and the period is known.
   *
   * Kept in the store rather than derived at save time, so what will be written is visible and testable
   * here. A scenario has no calendar year of its own — the legacy pins scenario dates to a non-leap year
   * so its 365-day series stays aligned — which is why this is absent for a scenario rather than defaulted.
   */
  year?: number;
}

/** The store's projection: the *current* model state (`Plan.md` §3). */
export interface ModelData {
  // identity and metadata (model-start)
  modelName?: string;
  fromDate?: string;
  toDate?: string;
  resolution?: number;
  workspaceId?: number;
  userId?: string;
  region?: RegionRef;

  // grid topology (region-select / grid-generation / grid-editor)
  coordinates?: Coordinates;
  buildings?: GeoJSON.FeatureCollection;
  transformers?: GeoJSON.FeatureCollection;
  lines?: GeoJSON.FeatureCollection;
  mvLines?: GeoJSON.FeatureCollection;
  grids?: unknown;

  // demand and technologies — keyed by energy vector
  buildingParams?: Partial<Record<EnergyVector, Record<string, BuildingParams>>>;
  technologies?: Record<string, TechAssignment[]>;

  // settings
  advancedParams?: Record<string, unknown>;
  weatherSelection?: WeatherSelection;

  // persistence handles (model-load / model-save)
  modelId?: number;
  draftId?: string;
  saveResult?: { modelId: number; created: boolean };
}

/** Every legal port key. */
export type PortKey = keyof ModelData;
