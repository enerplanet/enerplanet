/**
 * `model-start` — the workflow's entry node: creates the model session (identity, metadata, region).
 *
 * Layout regions: `sidebar` (the form — name, period, region), `map` (frames the chosen region).
 * `seal: "per-commit"`.
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
import { optionFor, optionsFor, regionKey, useRegions, type RegionOption } from "./regions";

/** The module's region slot, re-exported so a host installs a source through the module's entry point. */
export { setRegionSource } from "./regions";
export type { RegionOption, RegionSource } from "./regions";

/** The model's resolution in minutes — fixed at 60; any other value is replaced on save. */
const RESOLUTION = 60;

/** The calendar year scenario dates carry — a non-leap year, so the days line up with the 365-day series. */
export const SCENARIO_DATE_YEAR = 2023;

/**
 * The quarters the user picks between, as month-day bounds onto `SCENARIO_DATE_YEAR`.
 * `label` is a literal i18n key (never a template, so the i18n scanner still sees these keys).
 */
const PERIOD_PARTS = [
  { key: "q1", start: "01-01", end: "03-31", label: "modelBuilder.model-start.period.q1" },
  { key: "q2", start: "04-01", end: "06-30", label: "modelBuilder.model-start.period.q2" },
  { key: "q3", start: "07-01", end: "09-30", label: "modelBuilder.model-start.period.q3" },
  { key: "q4", start: "10-01", end: "12-31", label: "modelBuilder.model-start.period.q4" },
] as const;

/** A quarter key from the table above — `q1`…`q4`. */
export type PeriodKey = (typeof PERIOD_PARTS)[number]["key"];

/** The two quarters a chosen period spans. A single quarter is `{ start: k, end: k }`. */
export interface PeriodRange {
  start: PeriodKey;
  end: PeriodKey;
}

/** The table entry for a quarter key, or `undefined` for a key that names no quarter. */
function partFor(key: string): (typeof PERIOD_PARTS)[number] | undefined {
  return PERIOD_PARTS.find((candidate) => candidate.key === key);
}

/** The `fromDate`/`toDate` a range spans, both bounds onto the scenario year; `undefined` if a key names no quarter. */
export function periodDates(fromKey: string, toKey: string): { fromDate: string; toDate: string } | undefined {
  const from = partFor(fromKey);
  const to = partFor(toKey);
  if (from === undefined || to === undefined) return undefined;
  const [first, last] =
    PERIOD_PARTS.indexOf(from) <= PERIOD_PARTS.indexOf(to) ? [from, to] : [to, from];
  return { fromDate: `${SCENARIO_DATE_YEAR}-${first.start}`, toDate: `${SCENARIO_DATE_YEAR}-${last.end}` };
}

/** The quarters a stored period covers, derived from `fromDate`/`toDate`; `undefined` if they land on no quarter's bounds. */
export function quartersIn(fromDate: string | undefined, toDate: string | undefined): PeriodRange | undefined {
  if (fromDate === undefined || toDate === undefined) return undefined;
  const start = PERIOD_PARTS.find((candidate) => `${SCENARIO_DATE_YEAR}-${candidate.start}` === fromDate);
  const end = PERIOD_PARTS.find((candidate) => `${SCENARIO_DATE_YEAR}-${candidate.end}` === toDate);
  if (start === undefined || end === undefined) return undefined;
  if (PERIOD_PARTS.indexOf(start) > PERIOD_PARTS.indexOf(end)) return undefined;
  return { start: start.key, end: end.key };
}

/**
 * The range a click produces: a clicked endpoint collapses to that quarter; a second click spans the two; anything else starts a new single quarter.
 */
export function nextRange(current: PeriodRange | undefined, clicked: PeriodKey): PeriodRange {
  if (current !== undefined && (clicked === current.start || clicked === current.end)) {
    return { start: clicked, end: clicked };
  }
  if (current !== undefined && current.start === current.end) {
    const anchor = PERIOD_PARTS.findIndex((candidate) => candidate.key === current.start);
    const target = PERIOD_PARTS.findIndex((candidate) => candidate.key === clicked);
    return anchor <= target
      ? { start: current.start, end: clicked }
      : { start: clicked, end: current.start };
  }
  return { start: clicked, end: clicked };
}

/** Parse an ISO `YYYY-MM-DD` as a local date, so `Intl` formats the day the bound names and not a UTC shift. */
function parseScenarioDate(iso: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** The period as the user reads it — the months it covers (`Intl`), no year; `undefined` when unset. */
export function periodPreview(
  fromDate: string | undefined,
  toDate: string | undefined,
  locale: string,
): string | undefined {
  const from = fromDate === undefined ? undefined : parseScenarioDate(fromDate);
  const to = toDate === undefined ? undefined : parseScenarioDate(toDate);
  if (from === undefined || to === undefined) return undefined;

  const month = new Intl.DateTimeFormat(locale, { month: "long" });
  return fromDate === toDate || month.format(from) === month.format(to)
    ? month.format(from)
    : `${month.format(from)} – ${month.format(to)}`;
}

/** The legacy's defaults for the three settings no step produces; `null` prices mean *not set*. */
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

/** The module's own model: values its regions have collected, keyed by the node they were collected for. */
const held: { nodeId: string | null; values: Partial<ModelData> } = { nodeId: null, values: {} };

/** Hold values for `nodeId`, dropping anything held for a different node; the only way a region hands values to `run()`. */
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

/** What is missing, or wrong, for a model to start. */
function issuesFor(projection: Readonly<ModelData>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const name = projection.modelName;

  if (name === undefined || name.trim().length === 0) {
    issues.push({ port: "modelName", message: "The model needs a name." });
  }

  if (projection.fromDate === undefined || projection.toDate === undefined) {
    issues.push({
      port: "fromDate",
      message: "The model needs a period: pick a quarter or a range of quarters.",
    });
  } else if (projection.fromDate > projection.toDate) {
    issues.push({ port: "fromDate", message: "The period starts after it ends." });
  }

  if (projection.region === undefined) {
    issues.push({ port: "region", message: "Choose the region the model is drawn in." });
  }

  return issues;
}

/** Fill the legacy's defaults for the settings no step produces, only where nothing is there yet. */
function seedDefaults(ctx: ModuleCtx, proposed: Partial<ModelData>): void {
  if (ctx.read("cookingCarrier") === undefined) proposed.cookingCarrier = DEFAULT_COOKING_CARRIER;
  if (ctx.read("mode") === undefined) proposed.mode = DEFAULT_RUN_MODE;
  if (ctx.read("electricityPrices") === undefined) proposed.electricityPrices = NO_OWN_PRICES;
}

const module = defineModule({
  id: "model-start",
  name: "Model start",

  // The module's whole store surface: identity + metadata, requiring nothing (it is the entry node).
  // `workspaceId`/`userId` are declared but never written — the session seeds them.
  // `cookingCarrier`/`mode`/`electricityPrices` are seeded with the legacy's defaults in `run()`.
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

  // Nothing feeds this module, so nothing can invalidate its work.
  affect: {},

  // Independent fields: each commit stands alone with field-level undo.
  seal: "per-commit",

  layout: ["sidebar", "map"],

  run: (ctx) => {
    const collected = takeHeld();
    const proposed: Partial<ModelData> = {};

    // Read before you write, and commit only what changes; proposing nothing still seals a zero-diff run.
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

    // 60 is the only supported step; written only when it differs, so an untouched form stays a zero-diff run.
    const resolution = ctx.read("resolution");
    if (resolution !== RESOLUTION) proposed.resolution = RESOLUTION;

    if (collected.region !== undefined) {
      ctx.read("region");
      proposed.region = collected.region;
    }

    // The legacy's defaults for the settings no step produces.
    seedDefaults(ctx, proposed);

    ctx.commit(proposed);
  },

  validate: (ctx: ModuleCtx) => issuesFor(ctx.store),
});

/** What the form is showing now: the typed values laid over the store's. */
function onScreen(
  data: Readonly<ModelData>,
  typedName: string | null,
  typedRegion: string | null,
  regions: readonly RegionOption[],
): Readonly<ModelData> {
  const chosen = regions.find((candidate) => regionKey(candidate) === typedRegion);
  return {
    ...data,
    ...(typedName === null ? {} : { modelName: typedName }),
    ...(chosen === undefined ? {} : { region: { country: chosen.country, state: chosen.state } }),
  };
}

const Component: React.FC<ModuleViewProps> = ({ region, data, run, nodeId, map }) => {
  const { t, i18n } = useTranslation();
  // What the user has collected since the last commit. Local on purpose: it is not state worth keeping.
  const [typedName, setTypedName] = useState<string | null>(null);
  const [typedRegion, setTypedRegion] = useState<string | null>(null);

  const { regions, loading, failed } = useRegions();
  const selected = optionFor(regions, data.region);

  // The frame can move the session to another node mid-edit. Nothing collected on one node may reach another,
  // so a node change drops the held values and clears what was collected locally.
  useEffect(() => {
    hold(nodeId, {});
    setTypedName(null);
    setTypedRegion(null);
  }, [nodeId]);

  // The map follows the region the model holds — an effect on the stored region, so apply, load and undo all frame it.
  useEffect(() => {
    if (region !== "map" || map === undefined || selected === undefined) return;
    map.fitTo(boundsGeometry(selected.bounds));
  }, [region, map, selected]);

  // ── map: framing the chosen region is the whole work (above), so there is nothing to render.
  if (region === "map") return null;

  // ── sidebar: the form. One gesture, one commit.

  // The quarters the stored dates cover — derived from the store, not kept locally.
  const committed = quartersIn(data.fromDate, data.toDate);

  // What the preview says: the stored period's months in the app's language, or nothing when unset.
  const periodText = periodPreview(data.fromDate, data.toDate, i18n.language);

  // The buttons a range spans, by table index; an unset period selects none. A single quarter spans one.
  const rangeStart = committed === undefined ? -1 : PERIOD_PARTS.findIndex((part) => part.key === committed.start);
  const rangeEnd = committed === undefined ? -1 : PERIOD_PARTS.findIndex((part) => part.key === committed.end);

  const apply = (): void => {
    const chosen = regions.find((candidate) => regionKey(candidate) === typedRegion);
    hold(nodeId, {
      ...(typedName === null ? {} : { modelName: typedName }),
      ...(chosen === undefined
        ? {}
        : { region: { country: chosen.country, state: chosen.state } satisfies RegionRef }),
    });

    void run().finally(() => {
      // The store's values take over again; the `map` region frames on its own when the commit moves the region.
      setTypedName(null);
      setTypedRegion(null);
    });
  };

  /** Choosing a region commits it at once, rather than waiting for Apply. */
  const chooseRegion = (key: string): void => {
    const chosen = regions.find((candidate) => regionKey(candidate) === key);
    setTypedRegion(key);
    // The empty option is "nothing chosen" — it clears the pending value and commits nothing, because a model
    // must be drawn in some region.
    hold(nodeId, chosen === undefined ? {} : { region: { country: chosen.country, state: chosen.state } });
    void run().finally(() => setTypedRegion(null));
  };

  /** Picking a period also commits at once: the click is turned into a range by `nextRange`. */
  const choosePeriod = (key: PeriodKey): void => {
    const next = nextRange(committed, key);
    const dates = periodDates(next.start, next.end);
    if (dates !== undefined) hold(nodeId, dates);
    void run();
  };

  // The options to offer: the loaded list plus the stored region when it has left the list.
  const stored = data.region;
  const options = optionsFor(regions, stored);

  /** The form as it stands, and whether Apply has anything to work with (readiness from the module's own gate). */
  const pending = onScreen(data, typedName, typedRegion, regions);
  const ready = issuesFor(pending).length === 0;

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

      <div className="shrink-0 space-y-2">
        <p className="text-sm text-muted-foreground">{t("modelBuilder.model-start.period.label")}</p>
        {/* Reads the store, so it names the period the model holds; `aria-live` so a screen reader hears changes. */}
        <p className="text-sm font-medium text-foreground" aria-live="polite">
          {periodText ?? t("modelBuilder.model-start.period.none")}
        </p>
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label={t("modelBuilder.model-start.period.label")}
        >
          {PERIOD_PARTS.map((part, index) => {
            // A quarter is selected when the range covers it: one for a single quarter, two or more for a span.
            const chosen = rangeStart !== -1 && index >= rangeStart && index <= rangeEnd;
            return (
              <button
                key={part.key}
                type="button"
                aria-pressed={chosen}
                onClick={() => choosePeriod(part.key)}
                className={`h-7 cursor-pointer rounded-md border border-border px-2 text-xs font-medium transition-colors ${
                  chosen
                    ? "border-primary bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {t(part.label)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 space-y-2">
        <label className="text-sm text-muted-foreground" htmlFor="model-start-region">
          {t("modelBuilder.model-start.regionLabel")}
        </label>
        {loading ? (
          <p className="text-xs text-muted-foreground">
            {t("modelBuilder.model-start.regionsLoading")}
          </p>
        ) : (
          <>
            {failed ? (
              <p className="text-xs text-muted-foreground">
                {t("modelBuilder.model-start.regionsUnavailable")}
              </p>
            ) : null}
            {/* No dropdown on a failed load unless the model already holds a region. */}
            {failed && options.length === 0 ? null : (
              <select
                id="model-start-region"
                value={typedRegion ?? (stored === undefined ? "" : regionKey(stored))}
                onChange={(event) => chooseRegion(event.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">{t("modelBuilder.model-start.regionNone")}</option>
                {options.map((candidate) => (
                  <option key={regionKey(candidate)} value={regionKey(candidate)}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        onClick={apply}
        disabled={!ready}
        className="w-full shrink-0 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t("modelBuilder.model-start.apply")}
      </button>

      {/* A disabled button says what it waits for; the gate's own first message. */}
      {ready ? null : (
        <p className="shrink-0 text-xs text-muted-foreground">{issuesFor(pending)[0]?.message}</p>
      )}

      <p className="shrink-0 border-t border-border pt-3 text-xs text-muted-foreground">
        {t("modelBuilder.model-start.rulesHint")}
      </p>
    </div>
  );
};

const builderModule: BuilderModule = {
  module,
  Component,
  // No test data: this module requires nothing, so its test store is empty — the state a model starts in.
};

export default builderModule;
