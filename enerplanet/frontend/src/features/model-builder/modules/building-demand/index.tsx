/**
 * The `building-demand` module — per-building demand, one slice per energy vector.
 *
 * **This is a fetch, and a fetch is an auto job** (T23). It reads the buildings the grid node produced, turns
 * each into a request, and commits what came back. It gathers nothing of its own and holds no cursor: the
 * request is a pure function of the projection, so re-running it after an upstream change re-derives the same
 * calls. In a flow it is declared `auto`, which is why it has no button — there is nothing for a user to
 * decide here.
 *
 * **Two vectors, two sources, deliberately different.**
 *
 * - **Electricity** comes from the energy service (`POST /v1/pylovo/estimate-energy`), **one request per
 *   building**. The backend also offers a batch endpoint, but the legacy never calls it; the real behaviour is
 *   per building, and that is what this models. The service arrives through an injected slot, so this module
 *   knows nothing about the app's HTTP client.
 * - **Heat** is computed here, from the building's class and area — a *faithful mirror* of the backend's own
 *   TABULA-flavoured defaults, which the backend generates but does not persist. That mirror is the one
 *   deliberate duplicate in the codebase, and `heat.ts` explains why it is defensible.
 *
 * **No grid, no weather.** The estimate is a function of a building's own attributes. `grids` is not read
 * (earlier drafts had it as required) and `weatherSelection` is not an input either — weather shapes the
 * *run*, not a per-building annual figure. The module still *declares* `weatherSelection`, because it is
 * invalidated when the weather changes and a module must know every port it can affect.
 *
 * **Merged, not replaced.** Other vectors may already hold params from another module; this module writes only
 * electricity and heat, and reads the port first so the merge is a licensed rewrite rather than a clobber.
 */

import {
  defineModule,
  type BuilderModule,
  type BuildingParams,
  type ModelData,
  type ModuleViewProps,
  type ValidationIssue,
} from "@model-builder/core";
import { useTranslation } from "@spatialhub/i18n";
import { demandSource, type BuildingAttributes } from "./source";
import { estimateYearlyHeatDemand } from "./heat";

/**
 * The module's own surface, re-exported: a host installs a source through the same entry point it imports the
 * module from, so it never reaches into the module's files. Same shape as `setGridEngine` and
 * `setWeatherSource`.
 */
export { setDemandSource } from "./source";

/** The two vectors this module fills. The store's vector set is open (T9) — these are ours, not the limit. */
const ELECTRICITY = "electricity";
const HEAT = "heat";

/** A number from a feature property, or undefined — the pylovo features are untrusted JSON. */
function numberOf(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** A string from a feature property, or undefined. */
function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** The building's OpenStreetMap id — how every vector's params are keyed. */
export function osmIdOf(feature: GeoJSON.Feature): string | undefined {
  const id = feature.properties?.osm_id ?? feature.id;
  if (typeof id === "number") return String(id);
  return stringOf(id);
}

/**
 * What the estimate is computed from, read off the feature.
 *
 * Undefined when the building has no usable area: the service has nothing to scale, and inventing an area
 * would put a number in the store that nobody can trace. Such a building is simply left out, and the module's
 * gate reports it as unfinished.
 */
export function attributesOf(feature: GeoJSON.Feature): BuildingAttributes | undefined {
  const props = feature.properties ?? {};
  const areaM2 = numberOf(props.area_m2) ?? numberOf(props.area);
  if (areaM2 === undefined || areaM2 <= 0) return undefined;

  const yearOfConstruction = numberOf(props.construction_year) ?? numberOf(props.year_of_construction);
  const householdSize = numberOf(props.household_size);
  const numFloors = numberOf(props.num_floors) ?? numberOf(props.floors);
  const energyLabel = stringOf(props.energy_label);

  return {
    buildingType: stringOf(props.building_type) ?? stringOf(props.f_class) ?? "unknown",
    areaM2,
    ...(yearOfConstruction === undefined ? {} : { yearOfConstruction }),
    ...(householdSize === undefined ? {} : { householdSize }),
    ...(numFloors === undefined ? {} : { numFloors }),
    ...(energyLabel === undefined ? {} : { energyLabel }),
  };
}

/**
 * What this module stands behind (T22): every building the grid wrote has demand for both vectors.
 *
 * Silence before anything is written — the node is `pending`, not stale. After a run, a building with no
 * params means the estimate was skipped for it (no area) or the flow was interrupted, and either way this
 * module is not finished with it.
 */
export function issuesFor(projection: Readonly<ModelData>): ValidationIssue[] {
  const buildings = projection.buildings;
  if (buildings === undefined) return [];

  const params = projection.buildingParams;
  const missing = buildings.features.filter((feature) => {
    const id = osmIdOf(feature);
    if (id === undefined) return false;
    return params?.[ELECTRICITY]?.[id] === undefined || params?.[HEAT]?.[id] === undefined;
  });

  if (missing.length === 0) return [];
  return [{ port: "buildingParams", message: `${missing.length} building(s) have no demand yet.` }];
}

const module = defineModule({
  id: "building-demand",
  name: "Building demand",

  // What it writes, what it reads, and what it can affect. `buildings` is required — without the grid there is
  // nothing to estimate. `weatherSelection` is declared without being read: a weather change invalidates these
  // params, and a module must know every port its writes can affect.
  params: [
    { port: "buildings", required: true },
    { port: "buildingParams" },
    { port: "weatherSelection" },
  ],

  // Both edges are real. A new grid means these params describe buildings that no longer exist; a different
  // weather dataset means the model's demand basis moved. `technologies` is *not* named here — that edge
  // belongs to the module that owns it, and T7's closure carries this one onward on its own.
  affect: { buildings: ["buildingParams"], weatherSelection: ["buildingParams"] },

  layout: ["sidebar", "bottom"],

  run: async (ctx) => {
    const source = demandSource();
    if (source === null) {
      throw new Error(
        "building-demand has no estimate source: a host installs one with setDemandSource() (shell/demandSource.ts)",
      );
    }

    const buildings = ctx.read("buildings");
    if (buildings === undefined) {
      throw new Error("building-demand needs the grid's buildings before it can estimate");
    }

    // Read before write, and read for the *merge*: other vectors may already hold params from another module,
    // and the vector set is open (T9), so replacing the whole port would throw someone else's work away.
    const current = ctx.read("buildingParams") ?? {};
    const electricity: Record<string, BuildingParams> = {};
    const heat: Record<string, BuildingParams> = {};

    for (const feature of buildings.features) {
      const osmId = osmIdOf(feature);
      const attributes = attributesOf(feature);
      if (osmId === undefined || attributes === undefined) continue;

      // One request per building — the legacy's real behaviour, not the batch endpoint it never calls.
      const estimate = await source.estimate(attributes);

      electricity[osmId] = {
        fClass: estimate.fClass,
        yearlyKwh: estimate.yearlyKwh,
        peakKw: estimate.peakKw,
        byClass: [
          { fClass: estimate.fClass, yearlyKwh: estimate.yearlyKwh, peakKw: estimate.peakKw },
        ],
        source: "estimate",
      };

      // The heat mirror: a function of the class and the area, flagged as an estimate. No peak — the backend
      // sizes heat at run time, and inventing one here would be a number with no author.
      const mirror = estimateYearlyHeatDemand(estimate.fClass, attributes.areaM2);
      heat[osmId] = {
        fClass: estimate.fClass,
        yearlyKwh: mirror.kwh,
        peakKw: 0,
        byClass: [{ fClass: estimate.fClass, yearlyKwh: mirror.kwh, peakKw: 0 }],
        source: mirror.estimated ? "mirror" : "user",
      };
    }

    ctx.commit({
      buildingParams: { ...current, [ELECTRICITY]: electricity, [HEAT]: heat },
    });
  },

  validate: (ctx) => issuesFor(ctx.store),
});

/** The totals one vector adds up to, for the panel and the strip. */
function totalsOf(params: Record<string, BuildingParams> | undefined): { count: number; kwh: number } {
  const entries = Object.values(params ?? {});
  return {
    count: entries.length,
    kwh: entries.reduce((sum, entry) => sum + (entry.yearlyKwh ?? 0), 0),
  };
}

const Component: React.FC<ModuleViewProps> = ({ region, data }) => {
  const { t } = useTranslation();
  const electricity = totalsOf(data.buildingParams?.[ELECTRICITY]);
  const heat = totalsOf(data.buildingParams?.[HEAT]);

  if (region === "bottom") {
    return (
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{t("modelBuilder.building-demand.title")}</span>
        <span>
          <span className="font-mono text-xs text-muted-foreground">{ELECTRICITY}</span>{" "}
          {Math.round(electricity.kwh).toLocaleString()} kWh
        </span>
        <span>
          <span className="font-mono text-xs text-muted-foreground">{HEAT}</span>{" "}
          {Math.round(heat.kwh).toLocaleString()} kWh
        </span>
      </div>
    );
  }

  if (region !== "sidebar") return null;

  const rows = [
    { vector: ELECTRICITY, source: "modelBuilder.building-demand.sourceEstimate", totals: electricity },
    { vector: HEAT, source: "modelBuilder.building-demand.sourceMirror", totals: heat },
  ];

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h3 className="text-base font-semibold">{t("modelBuilder.building-demand.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("modelBuilder.building-demand.description")}
        </p>
      </div>

      <table className="w-full shrink-0 text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pb-1 font-medium">{t("modelBuilder.building-demand.vector")}</th>
            <th className="pb-1 text-right font-medium">{t("modelBuilder.building-demand.buildings")}</th>
            <th className="pb-1 text-right font-medium">{t("modelBuilder.building-demand.totalKwh")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.vector} className="border-t border-border/60">
              <td className="py-1 font-mono text-xs">{row.vector}</td>
              <td className="py-1 text-right">{row.totals.count}</td>
              <td className="py-1 text-right">{Math.round(row.totals.kwh).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.map((row) => (
        <p key={row.vector} className="shrink-0 text-xs text-muted-foreground">
          <span className="font-mono">{row.vector}</span>: {t(row.source)}
        </p>
      ))}

      <p className="shrink-0 border-t border-border pt-3 text-xs text-muted-foreground">
        {t("modelBuilder.building-demand.autoHint")}
      </p>
    </div>
  );
};

const builderModule: BuilderModule = {
  module,
  Component,
  // The test data: buildings with the attributes the estimate reads, so the module can be run in isolation.
  // The source is injected, not mocked here — a host installs one, and the module's tests install a fake.
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
  },
};

export default builderModule;
