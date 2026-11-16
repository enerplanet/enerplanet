/**
 * `model-start` — the workflow's **entry node**: it creates the model session.
 *
 * `Modules.md` §3: *"create the model session. Seeds identity + metadata and an empty store."* It is the only
 * module a workflow can start from, and it requires nothing — which is what makes it an entry node rather than
 * a step that happens to come first.
 *
 * It replaces the name/date/resolution/region portion of the legacy flow
 * (`configurator/hooks/useAreaSelect/helpers/modelSettings.ts` + `SidebarPanel.tsx` + `RegionSelector.tsx`).
 * Region selection is **entered here** — there is no separate `region-select` module (`modules/model-start.md`)
 * — and the map **follows the region the model holds**: applying frames the region just committed, and so do
 * loading a model and undoing a change, because all three move the same stored value.
 *
 * Two regions, on purpose (most modules want two or three — declare what you use):
 *
 *   sidebar   the form: name, period, resolution, region. One gesture, one commit.
 *   map       what this module does to the map: frame the chosen region, as an effect on the store. It renders
 *             nothing — the framing *is* the work. The baselayer itself is the `map-provider` module's
 *             business, never this one's.
 *
 * `seal: "per-commit"` — the fields are independent, so a partial state is one this module stands behind
 * (`spec/core.md` T16), and the form still hands over everything it owns in a single `commit()`.
 */

import { useEffect, useState } from "react";
import {
  defineModule,
  type BuilderModule,
  type ModelData,
  type ModuleCtx,
  type ModuleViewProps,
  type RegionRef,
  type ValidationIssue,
} from "@model-builder/core";
import { useTranslation } from "@spatialhub/i18n";

/** One region a model can be drawn in. */
interface RegionOption {
  country: string;
  state: string;
  label: string;
  /** `[west, south, east, north]` — enough to frame the region on the map. */
  bounds: [number, number, number, number];
}

/**
 * The regions this module offers, until the real source is wired.
 *
 * The legacy fetches these (`useAvailableRegions`); this list is the honest stand-in, kept in the module so it
 * runs in isolation and its tests need no backend. When the region source lands it moves behind the feature's
 * gateway and this module consumes it instead — **the port (`region`) does not change**, which is the point of
 * a port: the swap is invisible downstream (`Modules.md` §2, the swap rule).
 */
const REGIONS: readonly RegionOption[] = [
  { country: "DE", state: "BW", label: "Baden-Württemberg", bounds: [7.5, 47.5, 10.5, 49.8] },
  { country: "DE", state: "BY", label: "Bayern", bounds: [8.9, 47.2, 13.9, 50.6] },
  { country: "DE", state: "NW", label: "Nordrhein-Westfalen", bounds: [5.8, 50.3, 9.5, 52.6] },
  { country: "NL", state: "ZH", label: "Zuid-Holland", bounds: [3.9, 51.6, 5.0, 52.3] },
];

/** The resolutions a building model is usually drawn at, in minutes. */
const RESOLUTIONS = [1, 5, 15, 30, 60] as const;

/**
 * The legacy's defaults for the three settings **no step produces**.
 *
 * They are seeded here rather than left to the save because the save must write what the store holds, and a
 * key that is absent from the store has no honest value to write. `null` prices mean *not set* — the backend
 * substitutes a market price — so it is the default and not a zero.
 *
 * Read off the legacy's own store (`modelStore.ts`: `cookingCarrier: "electric"`, `runMode: "plan"`,
 * `NO_OWN_PRICES`).
 */
export const DEFAULT_COOKING_CARRIER = "electric" as const;
export const DEFAULT_RUN_MODE = "plan" as const;
export const NO_OWN_PRICES = { import_ct_per_kwh: null, export_ct_per_kwh: null };

/** A region's bounds as a rectangle — the geometry the map service frames. */
function boundsGeometry(bounds: [number, number, number, number]): {
  type: "Polygon";
  coordinates: [number, number][][];
} {
  const [west, south, east, north] = bounds;
  return {
    type: "Polygon",
    coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
  };
}

/** The option for a stored region, if it is one of ours. */
function optionFor(region: RegionRef | undefined): RegionOption | undefined {
  if (region === undefined) return undefined;
  return REGIONS.find((candidate) => candidate.country === region.country && candidate.state === region.state);
}

/**
 * The module's own model: the values its regions have collected, and the node they were collected for.
 *
 * A module's UI gathers values that only `run()` can commit, so it keeps them itself — that is the design, not
 * a hole in the contract (see "Where a module's work comes from" in `modules/README.md`). `nodeId` is the part
 * that matters: the frame can move the session to another node while a form is half-filled, and a value
 * collected on one node must never be committed against another.
 */
const held: { nodeId: string | null; values: Partial<ModelData> } = { nodeId: null, values: {} };

/**
 * Hold these values for `nodeId`, **dropping anything held for a different node**.
 *
 * The only way a region hands values to `run()`, and the path a test drives the module through. Holding an
 * *empty* set is meaningful: it is how a region says "the node changed, nothing of the last one applies here".
 */
export function hold(nodeId: string, values: Partial<ModelData> = {}): void {
  if (held.nodeId !== nodeId) {
    held.values = {};
    held.nodeId = nodeId;
  }
  Object.assign(held.values, values);
}

/** Take what is held and leave nothing behind: a hold describes one gesture, not a pending state. */
function takeHeld(): Partial<ModelData> {
  const values = held.values;
  held.values = {};
  held.nodeId = null;
  return values;
}

/**
 * What is missing, or wrong, for a model to start.
 *
 * The period comparison is a string comparison on purpose: `fromDate`/`toDate` are ISO dates (`YYYY-MM-DD`),
 * and ISO dates sort as strings — the format is what makes that comparison correct, not an accident.
 */
function issuesFor(projection: Readonly<ModelData>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const name = projection.modelName;

  if (name === undefined || name.trim().length === 0) {
    issues.push({ port: "modelName", message: "The model needs a name." });
  }

  if (projection.fromDate === undefined || projection.toDate === undefined) {
    issues.push({ port: "fromDate", message: "The model needs a period: a start and an end date." });
  } else if (projection.fromDate > projection.toDate) {
    issues.push({ port: "fromDate", message: "The period starts after it ends." });
  }

  if (projection.region === undefined) {
    issues.push({ port: "region", message: "Choose the region the model is drawn in." });
  }

  return issues;
}

/**
 * Fill the legacy's defaults for the three settings **no step produces**, only where nothing is there yet.
 *
 * "Only where nothing is there" is the whole rule: a loaded model has its own values and a re-run must not
 * overwrite them with the defaults — which is also what keeps a second run from sealing a transaction it has
 * nothing to say about.
 */
function seedDefaults(ctx: ModuleCtx, proposed: Partial<ModelData>): void {
  if (ctx.read("cookingCarrier") === undefined) proposed.cookingCarrier = DEFAULT_COOKING_CARRIER;
  if (ctx.read("mode") === undefined) proposed.mode = DEFAULT_RUN_MODE;
  if (ctx.read("electricityPrices") === undefined) proposed.electricityPrices = NO_OWN_PRICES;
}

const module = defineModule({
  id: "model-start",
  name: "Model start",

  // The module's whole store surface (`Modules.md` §3). It requires **nothing** — that is what makes it the
  // entry node — and it writes the identity and metadata a model needs before anything else can run.
  //
  // `workspaceId`/`userId` are declared but never written: they are the *session's* identity, seeded by the
  // host (the loader), not something a form invents. Declaring them says this module owns the model's identity
  // surface; leaving them untouched is what keeps it from clobbering what the session already knows.
  //
  // `cookingCarrier`/`mode`/`electricityPrices` are the settings **no step produces** — the legacy exposes
  // them in a settings panel and writes them on every save. This module seeds them with the legacy's defaults
  // (`run()` below), which is what gives the save something honest to write.
  params: [
    { port: "modelName" },
    { port: "fromDate" },
    { port: "toDate" },
    { port: "resolution" },
    { port: "region" },
    { port: "workspaceId" },
    { port: "userId" },
    { port: "cookingCarrier" },
    { port: "mode" },
    { port: "electricityPrices" },
  ],

  // Nothing can invalidate this module's work, because nothing feeds it: it has no inputs at all.
  affect: {},

  // Independent fields, so each commit stands alone and the user gets field-level undo (`spec/core.md` T16).
  seal: "per-commit",

  layout: ["sidebar", "map"],

  run: (ctx) => {
    const collected = takeHeld();
    const proposed: Partial<ModelData> = {};

    // Read before you write — the anti-clobber rule — and commit only what actually changes, so a run with
    // nothing to say seals nothing at all.
    if (collected.modelName !== undefined) {
      const current = ctx.read("modelName");
      const trimmed = collected.modelName.trim();
      const name = trimmed.length > 0 ? trimmed : "Untitled model";
      if (name !== current) proposed.modelName = name;
    }

    if (collected.fromDate !== undefined) {
      const current = ctx.read("fromDate");
      if (collected.fromDate !== current) proposed.fromDate = collected.fromDate;
    }

    if (collected.toDate !== undefined) {
      const current = ctx.read("toDate");
      if (collected.toDate !== current) proposed.toDate = collected.toDate;
    }

    if (collected.resolution !== undefined) {
      const current = ctx.read("resolution");
      if (collected.resolution !== current) proposed.resolution = collected.resolution;
    }

    if (collected.region !== undefined) {
      ctx.read("region");
      proposed.region = collected.region;
    }

    // The legacy's defaults, for the settings no step produces. See `seedDefaults`.
    seedDefaults(ctx, proposed);

    ctx.commit(proposed);
  },

  validate: (ctx: ModuleCtx) => issuesFor(ctx.store),
});

const Component: React.FC<ModuleViewProps> = ({ region, data, run, nodeId, map }) => {
  const { t } = useTranslation();
  // What the user has collected since the last commit. Local on purpose: it is not state worth keeping.
  const [typedName, setTypedName] = useState<string | null>(null);
  const [typedFrom, setTypedFrom] = useState<string | null>(null);
  const [typedTo, setTypedTo] = useState<string | null>(null);
  const [typedResolution, setTypedResolution] = useState<number | null>(null);
  const [typedRegion, setTypedRegion] = useState<string | null>(null);

  const selected = optionFor(data.region);

  // The frame can move the session to another node mid-edit. Nothing collected on one node may reach another,
  // so a node change drops the held values and clears what was collected locally.
  useEffect(() => {
    hold(nodeId, {});
    setTypedName(null);
    setTypedFrom(null);
    setTypedTo(null);
    setTypedResolution(null);
    setTypedRegion(null);
  }, [nodeId]);

  // The map follows the region the **model holds** — not the select, and not a button. Framing is an effect on
  // the stored region rather than a click, so applying frames the map, and so do loading a model and undoing:
  // they are the same promise. Only the `map` region is handed the service, hence the guard.
  //
  // `selected` is a reference into `REGIONS`, so its identity is stable and this fires when the region changes —
  // not on every render.
  useEffect(() => {
    if (region !== "map" || map === undefined || selected === undefined) return;
    map.fitTo(boundsGeometry(selected.bounds));
  }, [region, map, selected]);

  // ── map: what this module does to the map. The baselayer belongs to `map-provider`, and framing the chosen
  //    region is the whole of this module's work here — it happens in the effect above. So there is nothing to
  //    render: a card here would sit over the map it just framed and hide the result.
  if (region === "map") return null;

  // ── sidebar: the form. One gesture, one commit: everything the form owns is handed over together.
  const apply = (): void => {
    const chosen = REGIONS.find((candidate) => `${candidate.country}-${candidate.state}` === typedRegion);
    hold(nodeId, {
      ...(typedName === null ? {} : { modelName: typedName }),
      ...(typedFrom === null ? {} : { fromDate: typedFrom }),
      ...(typedTo === null ? {} : { toDate: typedTo }),
      ...(typedResolution === null ? {} : { resolution: typedResolution }),
      ...(chosen === undefined
        ? {}
        : { region: { country: chosen.country, state: chosen.state } satisfies RegionRef }),
    });

    void run().finally(() => {
      // The store's values take over again. The map needs no call here: the `map` region watches the stored
      // region and frames when it moves — which is exactly what this commit does.
      setTypedName(null);
      setTypedFrom(null);
      setTypedTo(null);
      setTypedResolution(null);
      setTypedRegion(null);
    });
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h3 className="text-base font-semibold">{t("modelBuilder.model-start.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("modelBuilder.model-start.description")}
        </p>
      </div>

      <div className="shrink-0 space-y-2">
        <label className="text-sm text-muted-foreground" htmlFor="model-start-name">
          {t("modelBuilder.model-start.nameLabel")}
        </label>
        <input
          id="model-start-name"
          value={typedName ?? String(data.modelName ?? "")}
          onChange={(event) => setTypedName(event.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="flex shrink-0 gap-3">
        <div className="flex-1 space-y-2">
          <label className="text-sm text-muted-foreground" htmlFor="model-start-from">
            {t("modelBuilder.model-start.fromLabel")}
          </label>
          <input
            id="model-start-from"
            type="date"
            value={typedFrom ?? String(data.fromDate ?? "")}
            onChange={(event) => setTypedFrom(event.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1 space-y-2">
          <label className="text-sm text-muted-foreground" htmlFor="model-start-to">
            {t("modelBuilder.model-start.toLabel")}
          </label>
          <input
            id="model-start-to"
            type="date"
            value={typedTo ?? String(data.toDate ?? "")}
            onChange={(event) => setTypedTo(event.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="shrink-0 space-y-2">
        <label className="text-sm text-muted-foreground" htmlFor="model-start-resolution">
          {t("modelBuilder.model-start.resolutionLabel")}
        </label>
        <select
          id="model-start-resolution"
          value={typedResolution ?? Number(data.resolution ?? 60)}
          onChange={(event) => setTypedResolution(Number(event.target.value))}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          {RESOLUTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {t("modelBuilder.model-start.resolutionUnit", "{{minutes}} min", { minutes })}
            </option>
          ))}
        </select>
      </div>

      <div className="shrink-0 space-y-2">
        <label className="text-sm text-muted-foreground" htmlFor="model-start-region">
          {t("modelBuilder.model-start.regionLabel")}
        </label>
        <select
          id="model-start-region"
          value={typedRegion ?? (selected === undefined ? "" : `${selected.country}-${selected.state}`)}
          onChange={(event) => setTypedRegion(event.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">{t("modelBuilder.model-start.regionNone")}</option>
          {REGIONS.map((candidate) => (
            <option key={`${candidate.country}-${candidate.state}`} value={`${candidate.country}-${candidate.state}`}>
              {candidate.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={apply}
        className="w-full shrink-0 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
      >
        {t("modelBuilder.model-start.apply")}
      </button>

      <p className="shrink-0 border-t border-border pt-3 text-xs text-muted-foreground">
        {t("modelBuilder.model-start.rulesHint")}
      </p>
    </div>
  );
};

const builderModule: BuilderModule = {
  module,
  Component,
  // No test data, deliberately: this module requires nothing, so in test mode its store is *empty* — which is
  // exactly the state a model starts in. Seeding it would hide the very thing this module exists to produce.
};

export default builderModule;
