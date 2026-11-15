/**
 * The technology catalogue: what a building can be given, what each type converts, and which type the
 * expected-fit autoresolve picks.
 *
 * **Three things live here, and they are deliberately different in kind.**
 *
 * 1. **The slot.** The catalogue itself — products with their constraints — comes from a host through an
 *    injected source, exactly like the grid engine and the demand estimate. This module knows nothing about
 *    the app's HTTP client, and the legacy's own load path (`GET /technologies`, falling back to a bundled
 *    `default_technologies.json`) stays in the shell where the app's client lives.
 * 2. **The vector map.** Which carrier a type converts, and to what. *This is the thesis's redesign* — the
 *    legacy keys assignments by a type slug with no vector typing at all — and it is what makes a heat pump
 *    (`electricity → heat`) a first-class device rather than a special case.
 * 3. **The expected-fit table.** Portable **verbatim** from the legacy's `utils/heatResolution.ts`, because an
 *    invented heuristic would be a number with no author. Its own rationale is worth keeping too: the
 *    fallback is a gas boiler not because it is clean, but because gas draws on the unlimited import and stays
 *    solvable where electric heating would exceed the transformer capacity pylovo sized for ordinary use.
 */

import type { EnergyVector } from "@model-builder/core";

/** A product in the catalogue, as a host serves it (the legacy's `Technology`, minus what we do not use). */
export interface CatalogueProduct {
  /** The product's key. On the default product of a type, this equals the type. */
  key: string;
  /** The technology type it provides, e.g. `pv_supply`. */
  type?: string;
  alias: string;
  manufacturer?: string | null;
  icon?: string;
  description?: string;
  /** The type's parameters, with the defaults a fresh assignment starts from. */
  constraints?: readonly { key: string; default_value: number | string }[];
}

/** What a host must provide: the catalogue. */
export interface CatalogueSource {
  load(): Promise<readonly CatalogueProduct[]>;
}

let source: CatalogueSource | null = null;

/** Install the source. The frame calls this at startup, the way it installs the grid engine. */
export function setCatalogueSource(next: CatalogueSource | null): void {
  source = next;
}

/** The installed source, or null when no host has provided one. */
export function catalogueSource(): CatalogueSource | null {
  return source;
}

/**
 * What each technology type converts. The set of *types* is the catalogue's business (a product added
 * server-side appears in the picker); the set of *vectors* is this module's, because it is what the store
 * reasons about.
 */
export const VECTORS_BY_TYPE: Record<string, { input?: EnergyVector; output: EnergyVector }> = {
  // Electricity provided on site, and stored.
  pv_supply: { output: "electricity" },
  battery_storage: { input: "electricity", output: "electricity" },
  // Heat, from electricity or from a fuel.
  air_source_heat_pump: { input: "electricity", output: "heat" },
  ground_source_heat_pump: { input: "electricity", output: "heat" },
  electric_boilers: { input: "electricity", output: "heat" },
  gas_boiler: { input: "gas", output: "heat" },
  // The legacy groups this with heat; it is the one entry whose vector typing is a judgement call.
  air_conditioner: { input: "electricity", output: "heat" },
};

/** The types that supply heat — the legacy's `HEAT_SUPPLY_TYPES`, which is also the one-per-building set. */
export const HEAT_SUPPLY_TYPES: readonly string[] = [
  "air_source_heat_pump",
  "ground_source_heat_pump",
  "electric_boilers",
  "gas_boiler",
];

/** What a type converts, or undefined when it is a type we cannot place. */
export function vectorsOfType(
  type: string,
): { inputVector?: EnergyVector; outputVector: EnergyVector } | undefined {
  const vectors = VECTORS_BY_TYPE[type];
  if (vectors === undefined) return undefined;
  return vectors.input === undefined
    ? { outputVector: vectors.output }
    : { inputVector: vectors.input, outputVector: vectors.output };
}

/** The type a product provides: its own `type`, else its key. */
export function productType(product: CatalogueProduct): string {
  return product.type ?? product.key;
}

/** The type's default product — the one keyed by the type itself, else the first of that type. */
export function defaultProduct(
  products: readonly CatalogueProduct[],
  type: string,
): CatalogueProduct | undefined {
  return products.find((product) => product.key === type) ?? products.find((p) => productType(p) === type);
}

/** The products of one type, the default first. */
export function productsOfType(
  products: readonly CatalogueProduct[],
  type: string,
): CatalogueProduct[] {
  return products
    .filter((product) => productType(product) === type)
    .sort((a, b) => Number(b.key === type) - Number(a.key === type));
}

/** The parameters a fresh assignment of this product starts from. */
export function defaultParams(product: CatalogueProduct): Record<string, unknown> {
  return Object.fromEntries((product.constraints ?? []).map((c) => [c.key, c.default_value]));
}

// ── The expected-fit autoresolve ─────────────────────────────────────────────
//
// Ported from the legacy's `utils/heatResolution.ts`. Heuristic, review-flagged, user-overridable — which is
// why an assignment it makes is flagged `estimated` rather than presented as fact.

/**
 * The fallback for a class the table does not know.
 *
 * A gas boiler draws on the unlimited gas import, so it stays solvable where electric heating would exceed the
 * transformer capacity pylovo sized for ordinary electricity use. That reasoning is the legacy's, and it is
 * the reason this is not simply "the most efficient option".
 */
export const SIMPLE_DEFAULT_TECH = "gas_boiler";

/** f-class → heat technology type, as the legacy resolves it. */
const EXPECTED_FIT: Record<string, string> = {
  // residential
  sfh: "air_source_heat_pump",
  detached: "air_source_heat_pump",
  semidetached_house: "air_source_heat_pump",
  terrace: "air_source_heat_pump",
  townhouse: "air_source_heat_pump",
  house: "air_source_heat_pump",
  bungalow: "air_source_heat_pump",
  apartment: "gas_boiler",
  apartments: "gas_boiler",
  mfh: "gas_boiler",
  residential: "gas_boiler",
  dormitory: "gas_boiler",
  // commercial
  office: "air_source_heat_pump",
  commercial: "air_source_heat_pump",
  retail: "air_source_heat_pump",
  shop: "air_source_heat_pump",
  supermarket: "gas_boiler",
  warehouse: "gas_boiler",
  restaurant: "gas_boiler",
  hotel: "gas_boiler",
  // industrial
  industrial: "gas_boiler",
  factory: "gas_boiler",
  manufacture: "gas_boiler",
  workshop: "gas_boiler",
  // public
  school: "gas_boiler",
  university: "gas_boiler",
  church: "gas_boiler",
  library: "gas_boiler",
  hospital: "gas_boiler",
  clinic: "gas_boiler",
  // agriculture
  farm: "gas_boiler",
  barn: "gas_boiler",
  stable: "gas_boiler",
  // Solar thermal is not in the catalogue, so a greenhouse takes a heat pump instead.
  greenhouse: "air_source_heat_pump",
};

/** The class a resolved technology type would use — the whole set the table can produce. */
export function expectedFitTypes(): string[] {
  return Array.from(new Set(Object.values(EXPECTED_FIT)));
}

/**
 * The heat technology a building should be given, or undefined when there is nothing to resolve.
 *
 * Undefined for a class that *means* no heating demand (a shed, a garage) or a building with no heat demand —
 * so a zero-demand building never gets a bogus assignment.
 */
export function expectedFitTech(
  fClass: string | undefined,
  heatKwh: number | undefined,
): { techId: string; estimated: true } | undefined {
  if (isZeroHeatDemandClass(fClass) || (heatKwh ?? 0) <= 0) return undefined;
  const norm = normalizeFClass(fClass ?? "");
  return { techId: EXPECTED_FIT[norm] ?? SIMPLE_DEFAULT_TECH, estimated: true };
}

/** Normalisation, matching the backend's and the heat mirror's — the table is keyed this way. */
export function normalizeFClass(fClass: string): string {
  return fClass.toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Classes that mean no heating demand.
 *
 * Duplicated from `building-demand/heat.ts` rather than imported: a module is a package of its own, and this
 * direction of dependency would make `technologies` depend on `building-demand`'s internals. The list is
 * short and mirrors the backend, so the two copies are checkable against one source of truth — the backend.
 */
const ZERO_DEMAND_CLASSES: readonly string[] = [
  "shed",
  "roof",
  "ruins",
  "garage",
  "carport",
  "parking",
  "bunker",
  "collapsed",
];

export function isZeroHeatDemandClass(fClass: string | undefined): boolean {
  return ZERO_DEMAND_CLASSES.includes(normalizeFClass(fClass ?? ""));
}
