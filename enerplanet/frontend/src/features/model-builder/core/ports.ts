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
  /**
   * Per-class breakdown, when one building carries several uses — the legacy's `fclass_details`.
   *
   * Faithful to the template rather than simplified: a building with a shop below and flats above has one
   * demand figure *and* a decomposition, and the save writes both. An estimate fills a single entry; a
   * user's edit splits it.
   */
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

/**
 * Where a demand figure came from — the legacy's `heat_demand_estimated` flag, made explicit.
 *
 * `mirror` is the frontend's own heat estimate: a deliberate duplicate of the backend's TABULA-flavoured
 * defaults, correct only because the backend is authoritative at run time and overrides it.
 */
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

/**
 * How a technology ended up on a building.
 *
 * `estimated` mirrors the legacy, which badges an expected-fit autoresolve as estimated precisely because it
 * is provisional: the heuristic is review-flagged and the user is always allowed to disagree with it.
 */
export type TechSource = "catalogue" | "estimated" | "user";

/** What a household cooks with — the legacy's own union, saved as `config.cookingCarrier`. */
export type CookingCarrier = "electric" | "gas";

/** How the model is run: `plan` optimises the dispatch, `operate` runs it. Saved as `config.mode`. */
export type RunMode = "plan" | "operate";

/**
 * Import and export prices in ct/kWh, or `null` for "no own price".
 *
 * `null` is the legacy's own default (`NO_OWN_PRICES`), and it means *not set*, not *free* — the backend
 * substitutes a market price. Writing a zero here would claim a decision nobody made.
 */
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

/**
 * A MEME run dispatched for a model — `run-meme-calliope`'s **record of the run, not its results**.
 *
 * Written by the `run-meme-calliope` node alone. It says where the run stands and, when it failed, why; the
 * results themselves are fetched by the nodes that read them (a later results-overview or compare node), each
 * of which declares this port `required` to place *after* the run that produced them.
 *
 * The status strings are the backend's own (`models.MemeRunStatus*`, the `model_meme_runs.status` column) —
 * carried verbatim rather than reinvented, so nothing here disagrees with what the server records.
 *
 * A port rather than a bag entry because it is a first-class fact about the model, and because it is the
 * ordering the flow rests on: `run-meme-pypsa`, the results overview and the compare node all depend on the
 * run having happened, and declaring this port `required` is what puts them after this node by construction.
 */
export interface MemeRun {
  /** Which framework leg this run is. Fixed to the Calliope default (`run-meme-calliope`). Kind to the pypsa leg's own record. */
  framework: "calliope";
  /**
   * The TentaCron job id, when the host learned one.
   *
   * Absent in practice: the backend keeps the id server-side (`model_meme_runs.run_id`) and no frontend-facing
   * response carries it, so the shell's gateway cannot fill this. Optional for exactly that reason.
   */
  runId?: string;
  /**
   * The run's state, in the backend's own run vocabulary (`models.MemeRunStatus*`): `pending` and `running`
   * while it is in flight, `completed` and `failed` terminal.
   *
   * The port carries the vocabulary; the **host derives the value**, reading the model's lifecycle the way the
   * model dashboard does (`shell/memeRunGateway.ts` names the sets it copies). The run's own row in
   * `model_meme_runs` is server-side and on no frontend response, so nothing here reads it directly.
   */
  status: "pending" | "running" | "completed" | "failed";
  /**
   * Why it failed, when it did — composed by the host from the model's own failure fields
   * (`results.failed_service` and `results.failed_stage`, which is what the dashboard's failed badge reads),
   * falling back to `results.error`, and naming the model's status when nothing recorded a failure at all.
   */
  error?: string;
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

  // run record (run-meme-calliope)
  memeRun?: MemeRun;
}

/** Every legal port key. */
export type PortKey = keyof ModelData;
