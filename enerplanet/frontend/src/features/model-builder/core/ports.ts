/**
 * The port catalog — the store's typed surface.
 *
 * A *port* is a typed key in the store. Modules never talk to each other: they read
 * ports and write ports, and every write goes through one reducer. Vector-keyed ports
 * (`buildingParams`, `technologies`) are an **open set** — registering a new energy
 * carrier is adding a vector, never a redesign.
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
  /** Per-class breakdown, when one building carries several uses — the legacy's `fclass_details`. */
  byClass?: readonly ClassDemand[];
  /** Where the number came from. Anything not from an estimate is flagged as such in the UI. */
  source?: DemandSource;
  [key: string]: unknown;
}

/** One class's share of a building's demand. */
export interface ClassDemand {
  fClass: string;
  yearlyKwh: number;
  peakKw: number;
}

/** Where a demand figure came from — the legacy's `heat_demand_estimated` flag, made explicit. */
export type DemandSource = "estimate" | "mirror" | "user";

/**
 * One technology assigned to one building. `inputVector → outputVector` is what makes a
 * heat pump (`electricity → heat`) first-class instead of a special case.
 */
export interface TechAssignment {
  techId: string;
  inputVector?: EnergyVector;
  outputVector?: EnergyVector;
  params?: Record<string, unknown>;
  /** Where the assignment came from — an autoplaced estimate is badged and overridable. */
  source?: TechSource;
}

/** How a technology ended up on a building. */
export type TechSource = "catalogue" | "estimated" | "user";

/** What a household cooks with — the legacy's own union, saved as `config.cookingCarrier`. */
export type CookingCarrier = "electric" | "gas";

/** How the model is run: `plan` optimises the dispatch, `operate` runs it. Saved as `config.mode`. */
export type RunMode = "plan" | "operate";

/** Import and export prices in ct/kWh, or `null` for "no own price" (the legacy's `NO_OWN_PRICES`). */
export interface ElectricityPrices {
  import_ct_per_kwh: number | null;
  export_ct_per_kwh: number | null;
}

/** `region` is a nested port: its `country`/`state` are what a downstream module matches on, not a flat value. */
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

/** The weather a model's runs use; `year` means the period's recorded weather, the others a solar scenario. */
export type WeatherChoice = "p50" | "p10" | "p90" | "year";

export interface WeatherSelection {
  /** The archive, or `null` for the server's default. */
  provider: string | null;
  /** `p50` typical / `p10` low / `p90` high solar, or `year` for the period's recorded weather. */
  choice: WeatherChoice;
  /** The resolved calendar year, filled when the choice is `year` and the period is known. */
  year?: number;
}

/**
 * A MEME run dispatched for a model — `run-meme-calliope`'s record of the run, not its results.
 *
 * Written by the `run-meme-calliope` node alone; declaring it `required` places the nodes that read the
 * run after it by construction. The status strings are the backend's own (`models.MemeRunStatus*`).
 */
export interface MemeRun {
  /** Which framework leg this run is. Fixed to the Calliope default (`run-meme-calliope`). */
  framework: "calliope";
  /** The TentaCron job id, when the host learned one (absent in practice — the backend keeps it server-side). */
  runId?: string;
  /** The run's state, in the backend's own run vocabulary (`models.MemeRunStatus*`). */
  status: "pending" | "running" | "completed" | "failed";
  /** Why it failed, when it did. */
  error?: string;
}

/**
 * A model's isolated PyPSA power-flow leg — `run-meme-pypsa`'s record of the leg, not its results.
 *
 * Written by the `run-meme-pypsa` node alone, which declares `memeRun` required beside it so the leg is
 * placed after the Calliope run it derives from. The host reads its status directly off `pypsa_leg_status`.
 */
export interface MemePypsaLeg {
  /** Which framework leg this is. Fixed to `pypsa` (`run-meme-pypsa`). */
  framework: "pypsa";
  /** The TentaCron job id, when the host learned one (absent in practice — kept server-side). */
  runId?: string;
  /** The leg's state, in the backend's own run vocabulary (`models.MemeRunStatus*`). */
  status: "pending" | "running" | "completed" | "failed";
  /** Why it failed, when it did (unset in practice — the backend exposes only the status). */
  error?: string;
}

/**
 * A family copy of a saved model — `model-variant`'s record of the copy it made.
 *
 * Written by the `model-variant` node alone; declaring it `required` places the comparison after the
 * variant by construction. Both ids come from the created model as the backend recorded it.
 */
export interface ModelVariant {
  /** The copy this node made. */
  variantModelId: number;
  /** The family's own original — the baseline a comparison is made against. */
  rootModelId: number;
  /** The copy's title, as the backend recorded it (the ` v<n>` versioning). */
  title?: string;
}

/** The store's projection: the *current* model state. */
export interface ModelData {
  // identity and metadata (model-start)
  modelName?: string;
  fromDate?: string;
  toDate?: string;
  resolution?: number;
  workspaceId?: number;
  userId?: string;
  /**
   * What a household cooks with. Gas cooking adds BuEM's kitchen profile as a gas demand, so this is a real
   * modelling choice rather than a label; the legacy saves it as `config.cookingCarrier`.
   */
  cookingCarrier?: CookingCarrier;
  /**
   * How the model is run — `plan` optimises, `operate` dispatches. The legacy saves it as `config.mode`.
   */
  mode?: RunMode;
  /**
   * Import/export prices in ct/kWh, or `null` for "no own price". The legacy saves it as
   * `config.electricity_prices`.
   */
  electricityPrices?: ElectricityPrices;
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

  // run records (run-meme-calliope, run-meme-pypsa)
  memeRun?: MemeRun;
  memePypsaLeg?: MemePypsaLeg;

  // family copy (model-variant)
  modelVariant?: ModelVariant;
}

/** Every legal port key. */
export type PortKey = keyof ModelData;
