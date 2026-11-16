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
 *   sidebar   the form: name, period, resolution, region. The period parts and the region commit on a click
 *             (`weather`'s choices); name and resolution wait for Apply, which hands over everything it owns
 *             at once.
 *   map       what this module does to the map: frame the chosen region, as an effect on the store. It renders
 *             nothing — the framing *is* the work. The baselayer itself is the `map-provider` module's
 *             business, never this one's.
 *
 * `seal: "per-commit"` — the fields are independent, so a partial state is one this module stands behind
 * (`spec/core.md` T16), and each click or Apply still lands in its own sealed transaction.
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

/**
 * The module's region slot, re-exported: a host installs a source through the same entry point it imports the
 * module from, so it never reaches into the module's files. Same shape as `setWeatherSource`.
 */
export { setRegionSource } from "./regions";
export type { RegionOption, RegionSource } from "./regions";

/** The resolutions a building model is usually drawn at, in minutes. */
const RESOLUTIONS = [1, 5, 15, 30, 60] as const;

/**
 * The year a scenario's dates carry.
 *
 * Scenario weather has no calendar year, but the simulation engine needs one, and a non-leap year keeps the
 * dates' days in line with the 365-day scenario series. Ported with the table below — the legacy's
 * `SCENARIO_DATE_YEAR` (`useAreaSelect/helpers/weatherSettings.ts`), which is the behaviour being reproduced.
 */
export const SCENARIO_DATE_YEAR = 2023;

/**
 * The quarters the user picks between, as month-day bounds. Only the scenario mode is supported, so a quarter
 * is the bounds onto `SCENARIO_DATE_YEAR` — the year is the scenario's, not the user's.
 *
 * Ported from the legacy's own `PERIOD_PARTS` (`region-selector/components/SidebarPanel.tsx`); `label` is the
 * i18n key the button renders. The legacy's separate "whole year" part is gone: a range whose ends are Q1 and
 * Q4 *is* the whole year, so keeping it would be a second way to name one state.
 *
 * `label` stays a literal key string, never a template — the i18n scanner derives dynamic families from
 * templates and rejects a dashed segment in the prefix, so a built label would hide these keys from the check.
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

/**
 * The `fromDate`/`toDate` a range spans: the earlier quarter's `start` bound to the later quarter's `end`
 * bound, both onto the scenario's fixed year. Either argument order yields the same range — chronological
 * order belongs to the range, not to the click. `undefined` if a key names no quarter.
 */
export function periodDates(fromKey: string, toKey: string): { fromDate: string; toDate: string } | undefined {
  const from = partFor(fromKey);
  const to = partFor(toKey);
  if (from === undefined || to === undefined) return undefined;
  const [first, last] =
    PERIOD_PARTS.indexOf(from) <= PERIOD_PARTS.indexOf(to) ? [from, to] : [to, from];
  return { fromDate: `${SCENARIO_DATE_YEAR}-${first.start}`, toDate: `${SCENARIO_DATE_YEAR}-${last.end}` };
}

/**
 * The quarters a **stored** period covers, derived from `fromDate`/`toDate` so the buttons reflect the model
 * rather than a local guess. `undefined` when the dates are unset or land on no quarter's bounds — a period
 * loaded from the legacy, for instance, is one these buttons cannot honestly claim.
 */
export function quartersIn(fromDate: string | undefined, toDate: string | undefined): PeriodRange | undefined {
  if (fromDate === undefined || toDate === undefined) return undefined;
  const start = PERIOD_PARTS.find((candidate) => `${SCENARIO_DATE_YEAR}-${candidate.start}` === fromDate);
  const end = PERIOD_PARTS.find((candidate) => `${SCENARIO_DATE_YEAR}-${candidate.end}` === toDate);
  if (start === undefined || end === undefined) return undefined;
  if (PERIOD_PARTS.indexOf(start) > PERIOD_PARTS.indexOf(end)) return undefined;
  return { start: start.key, end: end.key };
}

/**
 * The range a click produces, given the current one.
 *
 * The decision, stated once here so the buttons and the tests share it: clicking a quarter that is an endpoint
 * of the current range collapses to that quarter alone; clicking a *different* quarter while a single one is
 * set spans the two, chronologically (whichever was clicked first); anything else begins a new single quarter.
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

/**
 * The period as the user reads it: the months it covers, in the app's current language.
 *
 * Rendered from the stored `fromDate`/`toDate`, so it always tells the truth about the model rather than a
 * local guess. Month names come from `Intl`, which already knows every locale the app ships — hence no
 * month-name i18n keys. `undefined` when no period is set, so the caller can say so instead of an empty line.
 *
 * **No year.** A scenario year is assembled month by month from historical weather, so it has no calendar year
 * of its own — the dates carry one only because the simulation engine needs a calendar date to run against.
 * Printing it would claim a year the weather does not have.
 */
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

    // Read before you write — the anti-clobber rule — and commit only what actually changes. Proposing nothing
    // is fine: the run still seals its zero-diff trace, which is what lets a jumped-back node be left alone.
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

/**
 * What the form is showing right now: the typed values laid over the store's.
 *
 * The button's readiness is asked about this rather than about the store, because a form whose fields are
 * filled but not yet committed is a form the user can act on. `apply` commits only the typed values — what the
 * store already holds does not need re-writing — so this is strictly the *view*, not the payload.
 */
function onScreen(
  data: Readonly<ModelData>,
  typedName: string | null,
  typedResolution: number | null,
  typedRegion: string | null,
  regions: readonly RegionOption[],
): Readonly<ModelData> {
  const chosen = regions.find((candidate) => regionKey(candidate) === typedRegion);
  return {
    ...data,
    ...(typedName === null ? {} : { modelName: typedName }),
    ...(typedResolution === null ? {} : { resolution: typedResolution }),
    ...(chosen === undefined ? {} : { region: { country: chosen.country, state: chosen.state } }),
  };
}

const Component: React.FC<ModuleViewProps> = ({ region, data, run, nodeId, map }) => {
  const { t, i18n } = useTranslation();
  // What the user has collected since the last commit. Local on purpose: it is not state worth keeping.
  const [typedName, setTypedName] = useState<string | null>(null);
  const [typedResolution, setTypedResolution] = useState<number | null>(null);
  const [typedRegion, setTypedRegion] = useState<string | null>(null);

  const { regions, loading, failed } = useRegions();
  const selected = optionFor(regions, data.region);

  // The frame can move the session to another node mid-edit. Nothing collected on one node may reach another,
  // so a node change drops the held values and clears what was collected locally.
  useEffect(() => {
    hold(nodeId, {});
    setTypedName(null);
    setTypedResolution(null);
    setTypedRegion(null);
  }, [nodeId]);

  // The map follows the region the **model holds** — not the select, and not a button. Framing is an effect on
  // the stored region rather than a click, so applying frames the map, and so do loading a model and undoing:
  // they are the same promise. Only the `map` region is handed the service, hence the guard.
  //
  // `selected` is a reference into the loaded list, so its identity is stable while the list is, and this
  // fires when the region changes — not on every render.
  useEffect(() => {
    if (region !== "map" || map === undefined || selected === undefined) return;
    map.fitTo(boundsGeometry(selected.bounds));
  }, [region, map, selected]);

  // ── map: what this module does to the map. The baselayer belongs to `map-provider`, and framing the chosen
  //    region is the whole of this module's work here — it happens in the effect above. So there is nothing to
  //    render: a card here would sit over the map it just framed and hide the result.
  if (region === "map") return null;

  // ── sidebar: the form. One gesture, one commit: everything the form owns is handed over together.

  // The quarters the model's stored dates cover: the committed state the buttons and `nextRange` read. Derived
  // from the store, not kept locally, so the buttons tell the truth about the model — the same rule the region
  // select follows by reading `data.region`.
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
      ...(typedResolution === null ? {} : { resolution: typedResolution }),
      ...(chosen === undefined
        ? {}
        : { region: { country: chosen.country, state: chosen.state } satisfies RegionRef }),
    });

    void run().finally(() => {
      // The store's values take over again. The map needs no call here: the `map` region watches the stored
      // region and frames when it moves — which is exactly what this commit does.
      setTypedName(null);
      setTypedResolution(null);
      setTypedRegion(null);
    });
  };

  /**
   * Choosing a region commits it at once, rather than waiting for Apply.
   *
   * The map is how the user sees that a choice landed, and the rest of the flow already works this way — a
   * click *is* the commit (`weather`'s choices, `technologies`' assign). Holding the region back until Apply
   * made the one control that narrows to a place the one control that did nothing visible.
   */
  const chooseRegion = (key: string): void => {
    const chosen = regions.find((candidate) => regionKey(candidate) === key);
    setTypedRegion(key);
    // The empty option is "nothing chosen" — it clears the pending value and commits nothing, because a model
    // must be drawn in some region.
    hold(nodeId, chosen === undefined ? {} : { region: { country: chosen.country, state: chosen.state } });
    void run().finally(() => setTypedRegion(null));
  };

  /**
   * Picking a period also commits at once: the period is the model's, and a click *is* the commit — there is
   * nothing else to fill in first.
   *
   * The click is turned into a range by `nextRange` (the documented decision), and the range's outer bounds
   * onto the scenario's fixed year are held and written as `fromDate`/`toDate` exactly as a single part was.
   */
  const choosePeriod = (key: PeriodKey): void => {
    const next = nextRange(committed, key);
    const dates = periodDates(next.start, next.end);
    if (dates !== undefined) hold(nodeId, dates);
    void run();
  };

  // The stored region, and the options to offer: the loaded list plus the stored region when it has left the
  // list, so a model drawn in a region the backend no longer serves still shows its own value rather than
  // reading as unset.
  const stored = data.region;
  const options = optionsFor(regions, stored);

  /**
   * The form as it stands, and whether Apply has anything to work with.
   *
   * Readiness comes from the module's own gate rather than a second list of conditions: two copies of "what
   * makes a model start" would drift, and the button would then disagree with the gate that decides whether
   * this node is finished.
   */
  const pending = onScreen(data, typedName, typedResolution, typedRegion, regions);
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
        {/* The preview sits above the buttons and reads the store, so it always names the period the model
            actually holds — not what a button was last clicked. `aria-live` so a screen reader hears the change
            a sighted user sees. */}
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
            {/* No dropdown on a failed load, unless the model already holds a region — an empty one would
                claim there are no regions, and a full one would claim regions we could not fetch. */}
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

      {/* A disabled button has to say what it is waiting for, or it reads as broken. The gate's own first
          message is the honest one — it is the same sentence the save node would report. */}
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
  // No test data, deliberately: this module requires nothing, so in test mode its store is *empty* — which is
  // exactly the state a model starts in. Seeding it would hide the very thing this module exists to produce.
};

export default builderModule;
