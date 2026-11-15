/**
 * The `technologies` module — what each building is heated and supplied by.
 *
 * **This is the one step with no fetch at all.** In the legacy, placing a technology calls nothing: the
 * assignment is written onto the building's feature. So this is an interactive node, not an auto job — the
 * user is deciding, and the flow has nothing to derive. The only network call in this area belongs to loading
 * the catalogue, and that is picker data, not model data.
 *
 * **Two ways an assignment arrives.**
 *
 * 1. **The user assigns a type to every building** — one click per type, `source: "user"`. There is no
 *    per-building selection yet: `MapService` has no way to ask for one, and inventing a selection mechanism
 *    here would be a host concern solved in a module.
 * 2. **The expected-fit autoresolve** fills in heat for buildings that have heat demand and no supply, when
 *    the toggle is on. Those assignments are flagged `estimated`, because the heuristic is review-flagged and
 *    the user is meant to be able to disagree with it.
 *
 * **One heat supply per building**, enforced here: the legacy *skips* a second heat technology rather than
 * replacing it, and a building with two boilers is not a state worth being able to reach.
 *
 * **The redesign is the vector typing.** The legacy keys assignments by a type slug and knows nothing about
 * carriers; here an assignment carries `inputVector`/`outputVector`, so a heat pump is `electricity → heat`
 * rather than a special case. The cost is that the save must merge this port back into `config.buildings`,
 * which is the parity work G2 names.
 */

import { useEffect, useState } from "react";
import {
  defineModule,
  type BuilderModule,
  type ModelData,
  type ModuleViewProps,
  type TechAssignment,
  type ValidationIssue,
} from "@model-builder/core";
import { useTranslation } from "@spatialhub/i18n";
import {
  catalogueSource,
  defaultProduct,
  expectedFitTech,
  HEAT_SUPPLY_TYPES,
  productType,
  productsOfType,
  vectorsOfType,
  type CatalogueProduct,
} from "./catalogue";

/** The setting the autoresolve toggle writes, on the module's behalf. */
const AUTORESOLVE = "autoresolve";

/** The module's own model: what its controls collected, and the node they were collected for. */
const held: { nodeId: string | null; types: string[]; autoresolve: boolean | null } = {
  nodeId: null,
  types: [],
  autoresolve: null,
};

/** Hold a type for `nodeId`, dropping anything held for a different node. */
export function holdType(nodeId: string, type: string): void {
  if (held.nodeId !== nodeId) {
    held.types = [];
    held.autoresolve = null;
    held.nodeId = nodeId;
  }
  if (!held.types.includes(type)) held.types.push(type);
}

/** Hold the autoresolve toggle for `nodeId`. */
export function holdAutoresolve(nodeId: string, on: boolean): void {
  if (held.nodeId !== nodeId) {
    held.types = [];
    held.nodeId = nodeId;
  }
  held.autoresolve = on;
}

/** Take what is held and leave nothing behind. */
function takeHeld(): { types: string[]; autoresolve: boolean | null } {
  const values = { types: held.types, autoresolve: held.autoresolve };
  held.types = [];
  held.autoresolve = null;
  held.nodeId = null;
  return values;
}

/** The building's id — how every vector's params and assignments are keyed. */
export function osmIdOf(feature: GeoJSON.Feature): string | undefined {
  const id = feature.properties?.osm_id ?? feature.id;
  if (typeof id === "number") return String(id);
  return typeof id === "string" && id.trim().length > 0 ? id : undefined;
}

/** A string from a feature property, or undefined. */
function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Does this building already have a heat supply? */
export function hasHeatSupply(assignments: readonly TechAssignment[] | undefined): boolean {
  return (assignments ?? []).some((assignment) => HEAT_SUPPLY_TYPES.includes(assignment.techId));
}

/**
 * Add an assignment, honouring the one-heat-per-building rule.
 *
 * A second heat supply is a no-op rather than a replacement — the legacy's own behaviour. Assigning the same
 * type twice is also a no-op, so a repeated click cannot stack duplicates.
 */
export function assign(
  existing: readonly TechAssignment[] | undefined,
  next: TechAssignment,
): TechAssignment[] {
  const current = [...(existing ?? [])];
  if (current.some((assignment) => assignment.techId === next.techId)) return current;
  if (HEAT_SUPPLY_TYPES.includes(next.techId) && hasHeatSupply(current)) return current;
  return [...current, next];
}

/**
 * What this module stands behind (T22): every building with heat demand has a heat supply.
 *
 * A building whose heat demand is zero — a garage, or one the demand step found nothing for — is *not* asked
 * for a technology, so this stays silent rather than demanding supplies nobody needs.
 */
export function issuesFor(projection: Readonly<ModelData>): ValidationIssue[] {
  const buildings = projection.buildings;
  const heat = projection.buildingParams?.heat;
  if (buildings === undefined || heat === undefined) return [];

  const wanted = buildings.features.filter((feature) => {
    const id = osmIdOf(feature);
    if (id === undefined) return false;
    return (heat[id]?.yearlyKwh ?? 0) > 0 && !hasHeatSupply(projection.technologies?.[id]);
  });

  if (wanted.length === 0) return [];
  return [{ port: "technologies", message: `${wanted.length} building(s) have heat demand but no supply.` }];
}

/** Apply each collected type to every building — the "assign to all" gesture. */
function applyToAll(
  buildings: GeoJSON.FeatureCollection,
  types: readonly string[],
  next: Record<string, TechAssignment[]>,
): void {
  for (const type of types) {
    const vectors = vectorsOfType(type);
    if (vectors === undefined) continue;
    for (const feature of buildings.features) {
      const osmId = osmIdOf(feature);
      if (osmId === undefined) continue;
      next[osmId] = assign(next[osmId], { techId: type, ...vectors, source: "user" });
    }
  }
}

/**
 * The expected-fit pass: heat for every building that has demand and nothing supplying it.
 *
 * A building whose heat demand is zero — a garage, or one the demand step found nothing for — resolves to
 * nothing, so it is left alone rather than given a supply it does not need.
 */
function autoresolveHeat(
  buildings: GeoJSON.FeatureCollection,
  params: Readonly<ModelData>["buildingParams"],
  next: Record<string, TechAssignment[]>,
): void {
  for (const feature of buildings.features) {
    const osmId = osmIdOf(feature);
    if (osmId === undefined || hasHeatSupply(next[osmId])) continue;

    const fit = expectedFitTech(fClassOf(params, osmId, feature), params?.heat?.[osmId]?.yearlyKwh);
    if (fit === undefined) continue;

    const vectors = vectorsOfType(fit.techId);
    if (vectors === undefined) continue;
    next[osmId] = assign(next[osmId], { techId: fit.techId, ...vectors, source: "estimated" });
  }
}

/**
 * The module's own surface, re-exported: a host installs a source through the same entry point it imports the
 * module from, so it never reaches into the module's files. Same shape as `setGridEngine` and
 * `setWeatherSource`.
 */
export { setCatalogueSource } from "./catalogue";

const module = defineModule({
  id: "technologies",
  name: "Technologies",

  // The grid (assignments hang off its buildings and its transformers), the demand it resolves, and the
  // settings port the autoresolve toggle is written to.
  params: [
    { port: "buildings", required: true },
    { port: "transformers", required: true },
    { port: "buildingParams", required: true },
    { port: "technologies" },
    { port: "advancedParams" },
  ],

  // Both edges are real: a new grid or new transformer assignment means these technologies were chosen for a
  // network that no longer exists, and a demand change means they were sized for a different demand.
  affect: { buildings: ["technologies"], buildingParams: ["technologies"] },

  layout: ["sidebar"],

  run: (ctx) => {
    const collected = takeHeld();
    const buildings = ctx.read("buildings");
    const params = ctx.read("buildingParams");
    const advanced = ctx.read("advancedParams");
    const current = ctx.read("technologies") ?? {};

    if (buildings === undefined || params === undefined) return; // the flow gate keeps this from happening

    const next: Record<string, TechAssignment[]> = { ...current };

    // 1. What the user asked for, then 2. the expected-fit fill. Each pass is simpler than the run that
    //    composes them, which is the only reason this stays readable.
    applyToAll(buildings, collected.types, next);

    const autoresolve = collected.autoresolve ?? advanced?.[AUTORESOLVE] === true;
    if (autoresolve === true) autoresolveHeat(buildings, params, next);

    // The toggle is a setting, so it lives in the settings port — read above, so this rewrite is licensed.
    const settings =
      collected.autoresolve === null
        ? advanced
        : { ...(advanced ?? {}), [AUTORESOLVE]: collected.autoresolve };

    ctx.commit({
      technologies: next,
      ...(settings === undefined ? {} : { advancedParams: settings }),
    });
  },

  validate: (ctx) => issuesFor(ctx.store),
});

/** The class a building's demand was estimated from — what the expected-fit table is keyed on. */
function fClassOf(
  params: Readonly<ModelData>["buildingParams"],
  osmId: string,
  feature: GeoJSON.Feature,
): string | undefined {
  return params?.electricity?.[osmId]?.fClass ?? stringOf(feature.properties?.building_type);
}

/** A hosted catalogue, or empty until one answers. */
function useCatalogue(): { products: readonly CatalogueProduct[]; failed: boolean } {
  const [products, setProducts] = useState<readonly CatalogueProduct[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const source = catalogueSource();
    if (source === null) return;
    source
      .load()
      .then((next) => {
        if (live) setProducts(next);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  return { products, failed };
}

/** One catalogue type: what it converts, and the button that applies it to every building. */
const TypeRow: React.FC<{
  alias: string;
  vectors: ReturnType<typeof vectorsOfType>;
  busy: boolean;
  assignLabel: string;
  onAssign: () => void;
}> = ({ alias, vectors, busy, assignLabel, onAssign }) => (
  <li className="flex items-center justify-between gap-3">
    <span className="min-w-0">
      <span className="block truncate text-sm">{alias}</span>
      {vectors !== undefined && (
        <span className="block font-mono text-[0.65rem] text-muted-foreground">
          {vectors.inputVector === undefined
            ? vectors.outputVector
            : `${vectors.inputVector} → ${vectors.outputVector}`}
        </span>
      )}
    </span>
    <button
      type="button"
      disabled={busy}
      onClick={onAssign}
      className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
    >
      {assignLabel}
    </button>
  </li>
);

const Component: React.FC<ModuleViewProps> = ({ data, run, nodeId }) => {
  const { t } = useTranslation();
  const { products, failed } = useCatalogue();
  const [busy, setBusy] = useState(false);

  // The frame can move the session mid-selection. Nothing collected on one node may reach another.
  useEffect(() => {
    held.nodeId = nodeId;
    held.types = [];
    held.autoresolve = null;
    return () => {
      held.nodeId = null;
    };
  }, [nodeId]);

  const assigned = Object.values(data.technologies ?? {}).reduce(
    (total, list) => total + (list.length > 0 ? 1 : 0),
    0,
  );
  const total = data.buildings?.features.length ?? 0;
  const autoresolve = data.advancedParams?.[AUTORESOLVE] === true;

  // The types the catalogue actually has products for, in a stable order.
  const types = Array.from(new Set(products.map(productType))).sort();

  /** One click: assign this type everywhere, then run. */
  const assignEverywhere = (type: string): void => {
    holdType(nodeId, type);
    setBusy(true);
    void run().finally(() => setBusy(false));
  };

  const toggleAutoresolve = (): void => {
    holdAutoresolve(nodeId, !autoresolve);
    setBusy(true);
    void run().finally(() => setBusy(false));
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h3 className="text-base font-semibold">{t("modelBuilder.technologies.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("modelBuilder.technologies.description")}</p>
      </div>

      <p className="shrink-0 text-sm">
        {t("modelBuilder.technologies.assigned", "{{assigned}} of {{total}} buildings", {
          assigned,
          total,
        })}
      </p>

      <label className="flex shrink-0 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={autoresolve}
          disabled={busy}
          onChange={toggleAutoresolve}
          className="h-4 w-4"
        />
        {t("modelBuilder.technologies.autoresolve")}
      </label>
      <p className="shrink-0 text-xs text-muted-foreground">{t("modelBuilder.technologies.autoresolveHint")}</p>

      <div className="flex min-h-0 flex-1 flex-col gap-2 border-t border-border pt-3">
        <h4 className="shrink-0 text-sm font-medium">{t("modelBuilder.technologies.assign")}</h4>

        {types.length === 0 ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {failed ? t("modelBuilder.technologies.unavailable") : t("modelBuilder.technologies.loading")}
          </p>
        ) : (
          <ul className="min-h-0 space-y-1 overflow-auto">
            {types.map((type) => (
              <TypeRow
                key={type}
                alias={defaultProduct(productsOfType(products, type), type)?.alias ?? type}
                vectors={vectorsOfType(type)}
                busy={busy}
                assignLabel={t("modelBuilder.technologies.assignAll")}
                onAssign={() => assignEverywhere(type)}
              />
            ))}
          </ul>
        )}
      </div>

      <p className="shrink-0 border-t border-border pt-3 text-xs text-muted-foreground">
        {t("modelBuilder.technologies.noSelectionHint")}
      </p>
    </div>
  );
};

const builderModule: BuilderModule = {
  module,
  Component,
  // The test data: a grid, a demand figure with heat, and the settings the module writes.
  mock: {
    buildings: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { osm_id: "b1", building_type: "residential", area_m2: 120 },
          geometry: { type: "Point", coordinates: [8.6, 49.4] },
        },
      ],
    },
    transformers: { type: "FeatureCollection", features: [] },
    buildingParams: {
      electricity: { b1: { fClass: "residential", yearlyKwh: 12_000, peakKw: 4 } },
      heat: { b1: { fClass: "residential", yearlyKwh: 10_800, peakKw: 0 } },
    },
  },
};

export default builderModule;
