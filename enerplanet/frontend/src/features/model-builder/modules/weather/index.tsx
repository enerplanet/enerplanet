/**
 * The `weather` module — **which** backend weather dataset a model's runs use.
 *
 * It selects; it does not fetch. The config *references* a dataset and the backend retrieves the series at
 * run time (`modules/weather.md`). The one backend call this module makes is listing the archives and years
 * it can choose from (`GET /weather/years` in the legacy) — and even that arrives through a **provider
 * slot**, not an import, so the module knows nothing about the app's HTTP client and every case below runs
 * against a fake.
 *
 * **The shape is the legacy's, on purpose.** Its `WeatherSettings` is `{ provider: string | null; choice }`
 * and its `isScenario(weather)` is `choice !== "year"`. An explicit `mode` field would be a second way to
 * say what the choice already says — the module spec had one, and the legacy is why it does not now.
 * `provider: null` means "the server's default archive", **not** "unset": that is what makes a save omit the
 * key rather than write a default value, so the default can change server-side without rewriting models.
 *
 * Two consequences of that shape are easy to get wrong, so both are stated here:
 *
 * - **A scenario has no calendar year.** The legacy pins scenario dates to a non-leap year so its 365-day
 *   series stays aligned; the year a model runs on belongs to *its period*, not to the scenario. This
 *   module therefore stores no year for a scenario rather than inventing one.
 * - **A recorded year needs a period to come from.** The year is the period's, so it is read from
 *   `fromDate` when the choice is `year`. Until a period exists the choice cannot be finished — and that is
 *   what this module's own gate reports (T22), so the node stays unfinished instead of the flow walking on
 *   with a half-specified dataset.
 */

import { useEffect, useState } from "react";
import {
  defineModule,
  type BuilderModule,
  type ModelData,
  type ModuleViewProps,
  type ValidationIssue,
  type WeatherChoice,
  type WeatherSelection,
} from "@model-builder/core";
import { useTranslation } from "@spatialhub/i18n";

/** The scenarios, low to high solar — the order the legacy shows them in. */
const SCENARIOS: readonly WeatherChoice[] = ["p10", "p50", "p90"];

/** Published names for the archives weather-serve lists, as the legacy renders them. */
const ARCHIVE_NAMES: Record<string, string> = {
  "merra-2": "MERRA-2",
  "era5-land": "ERA5-Land",
  "cosmo-rea6": "COSMO-REA6",
};

/** What the backend says about its weather archives. */
export interface WeatherArchives {
  /** The archive runs use when a model chooses none; null until known. */
  defaultProvider: string | null;
  /** Archives with at least one year, each ascending. */
  archives: Record<string, number[]>;
}

/**
 * What this module needs from a host: the archives it may choose from.
 *
 * One method, and deliberately not a year-by-archive lookup: the choice is *stored*, never fetched, and the
 * years are here only so the picker is honest about what the backend can actually serve.
 */
export interface WeatherSource {
  listArchives(): Promise<WeatherArchives>;
}

let source: WeatherSource | null = null;

/** Install the source. The frame calls this at startup, the way it installs the grid engine. */
export function setWeatherSource(next: WeatherSource | null): void {
  source = next;
}

/**
 * The module's own model: what its controls have collected, and the node they were collected for.
 *
 * A module's UI gathers values that only `run()` can commit, so it keeps them itself. `nodeId` matters for
 * the same reason it does everywhere: the frame can move the session while a choice is half-made, and a
 * value collected on one node must never be committed against another.
 */
const held: { nodeId: string | null; values: Partial<ModelData> } = { nodeId: null, values: {} };

/** Hold these values for `nodeId`, dropping anything held for a different node. */
export function hold(nodeId: string, values: Partial<ModelData> = {}): void {
  if (held.nodeId !== nodeId) {
    held.values = {};
    held.nodeId = nodeId;
  }
  Object.assign(held.values, values);
}

/** Take what is held and leave nothing: a hold describes one gesture, not a pending state. */
function takeHeld(): Partial<ModelData> {
  const values = held.values;
  held.values = {};
  held.nodeId = null;
  return values;
}

/** The calendar year an ISO date carries, or undefined when there is no usable date. */
export function yearOf(fromDate: string | undefined): number | undefined {
  if (fromDate === undefined) return undefined;
  const year = Number.parseInt(fromDate.slice(0, 4), 10);
  return Number.isInteger(year) && year > 0 ? year : undefined;
}

/** The same dataset? Field by field — it is an object, so identity comparison would be a lie. */
export function sameSelection(
  a: WeatherSelection | undefined,
  b: WeatherSelection | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.provider === b.provider && a.choice === b.choice && a.year === b.year;
}

/** The default the legacy opens with: the typical scenario on the server's default archive. */
export const DEFAULT_SELECTION: WeatherSelection = { provider: null, choice: "p50" };

/**
 * What this module stands behind, asked of any projection so `validate()` and the panel agree (T22).
 *
 * Silence means either "nothing chosen yet" — the node is `pending`, not stale — or "the choice is usable".
 * An issue means the choice cannot be finished as it stands: a recorded year with no period to take it from.
 */
export function issuesFor(projection: Readonly<ModelData>): ValidationIssue[] {
  const selection = projection.weatherSelection;
  if (selection === undefined) return [];

  if (selection.choice === "year" && selection.year === undefined) {
    return [
      {
        port: "weatherSelection",
        message: "Set the model's period before running on a recorded year.",
      },
    ];
  }
  return [];
}

const module = defineModule({
  id: "weather",
  name: "Weather",

  // What it writes, plus what it reads and what it may invalidate. `fromDate` is deliberately *not* required:
  // a scenario needs no period at all, so demanding one would make this node unplaceable before `model-start`
  // — which is not true of the legacy, where weather is chosen independently. When a *recorded year* is
  // chosen and the period is missing, that is this module's own gate's business (T22), not the flow gate's.
  //
  // `buildingParams` is declared without being written: a module must *know* every port it can affect, and
  // declaring one is not a claim to write it (the engine still refuses an undeclared write). This module
  // never touches it — the cascade removes it (T7).
  params: [{ port: "weatherSelection" }, { port: "fromDate" }, { port: "buildingParams" }],

  // The direct edges only; invalidation is transitive (T7), so `building-demand`'s own declaration carries
  // the choice onward to `technologies`. Writing that far edge here would be claiming someone else's coupling.
  //
  // `fromDate` is named because the module genuinely reads it: a recorded year *comes from* the period, so
  // changing the period invalidates the selection this module wrote. The influence prober (T8) is what found
  // that, and it is right — without the edge, a period change would leave a stale year behind.
  affect: { weatherSelection: ["buildingParams"], fromDate: ["weatherSelection"] },

  layout: ["sidebar"],

  run: (ctx) => {
    const collected = takeHeld();
    const chosen = collected.weatherSelection as WeatherSelection | undefined;
    if (chosen === undefined) return; // a bare run with nothing collected proposes nothing (the trace still lands)

    // Read before write — the anti-clobber rule — and this read is also what licenses the rewrite.
    const current = ctx.read("weatherSelection");

    // The year is the *period's*, so it comes from `fromDate` rather than from the picker. Only a `year`
    // choice has one: a scenario has no calendar year of its own, and storing a fake one is how the legacy's
    // non-leap-year convention would end up in the wrong place.
    const year = chosen.choice === "year" ? yearOf(ctx.read("fromDate")) : undefined;
    const resolved: WeatherSelection = { ...chosen, ...(year === undefined ? {} : { year }) };

    if (sameSelection(current, resolved)) return; // nothing changed — no op, no transaction
    ctx.commit({ weatherSelection: resolved });
  },

  validate: (ctx) => issuesFor(ctx.store),
});

/** The archives the picker may offer. Fetched once — the list is a property of the backend, not the model. */
function useArchives(): { archives: WeatherArchives; failed: boolean } {
  const [state, setState] = useState<WeatherArchives>({ defaultProvider: null, archives: {} });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    source
      ?.listArchives()
      .then((next) => {
        if (live) setState(next);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  return { archives: state, failed };
}

/** A row of mutually exclusive choices — one click each, and the click *is* the commit. */
const ChoiceRow: React.FC<{
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChoose: (value: string) => void;
}> = ({ label, value, options, onChoose }) => (
  <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-md bg-muted p-1">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={value === option.value}
        onClick={() => value !== option.value && onChoose(option.value)}
        className={`h-7 flex-1 cursor-pointer rounded px-2 text-xs font-medium transition-colors ${
          value === option.value
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {option.label}
      </button>
    ))}
  </div>
);

const Component: React.FC<ModuleViewProps> = ({ region, data, run, nodeId }) => {
  const { t } = useTranslation();
  const { archives, failed } = useArchives();

  // The frame can move the session mid-choice. Nothing collected on one node may reach another, so a node
  // change drops what was held and the panel shows the store's selection again.
  useEffect(() => {
    hold(nodeId, {});
  }, [nodeId]);

  if (region !== "sidebar") return null;

  const selection = data.weatherSelection ?? DEFAULT_SELECTION;
  const scenario = selection.choice !== "year";
  const periodYear = yearOf(data.fromDate);

  const archiveNames = Object.keys(archives.archives);
  const shownArchive = selection.provider ?? archives.defaultProvider;
  const years = shownArchive === null ? [] : archives.archives[shownArchive] ?? [];

  /** One click, one commit — held for *this* node and handed to `run()` immediately. */
  const choose = (next: WeatherSelection): void => {
    hold(nodeId, { weatherSelection: next });
    void run();
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h3 className="text-base font-semibold">{t("modelBuilder.weather.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("modelBuilder.weather.description")}</p>
      </div>

      <div className="shrink-0 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{t("modelBuilder.weather.modeLabel")}</p>
        <ChoiceRow
          label={t("modelBuilder.weather.modeLabel")}
          value={scenario ? "scenario" : "year"}
          options={[
            { value: "scenario", label: t("modelBuilder.weather.modeScenario") },
            { value: "year", label: t("modelBuilder.weather.modeYear") },
          ]}
          onChoose={(mode) =>
            mode === "scenario"
              ? // Back to the typical scenario, keeping the archive.
                choose({ provider: selection.provider, choice: "p50" })
              : // A recorded year takes the period's, when there is one to take.
                choose({
                  provider: selection.provider,
                  choice: "year",
                  ...(periodYear === undefined ? {} : { year: periodYear }),
                })
          }
        />
      </div>

      {scenario ? (
        <div className="shrink-0 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {t("modelBuilder.weather.scenarioLabel")}
          </p>
          <ChoiceRow
            label={t("modelBuilder.weather.scenarioLabel")}
            value={selection.choice}
            options={SCENARIOS.map((choice) => ({
              value: choice,
              label: t(`modelBuilder.weather.scenario.${choice}`),
            }))}
            onChoose={(choice) => choose({ provider: selection.provider, choice: choice as WeatherChoice })}
          />
          <p className="text-xs text-muted-foreground">{t("modelBuilder.weather.scenarioHint")}</p>
        </div>
      ) : (
        <div className="shrink-0 space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="weather-year">
            {t("modelBuilder.weather.yearLabel")}
          </label>
          {years.length === 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {failed ? t("modelBuilder.weather.yearsUnavailable") : t("modelBuilder.weather.yearsLoading")}
            </p>
          ) : (
            <select
              id="weather-year"
              value={String(selection.year ?? "")}
              onChange={(event) =>
                choose({ provider: selection.provider, choice: "year", year: Number(event.target.value) })
              }
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="" disabled>
                {t("modelBuilder.weather.yearPlaceholder")}
              </option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          )}
          <p className="text-xs text-muted-foreground">{t("modelBuilder.weather.yearHint")}</p>
        </div>
      )}

      {archiveNames.length > 1 && (
        <div className="shrink-0 space-y-1 border-t border-border pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            {t("modelBuilder.weather.archiveLabel")}
          </p>
          <ChoiceRow
            label={t("modelBuilder.weather.archiveLabel")}
            value={shownArchive ?? ""}
            options={archiveNames.map((name) => ({ value: name, label: ARCHIVE_NAMES[name] ?? name }))}
            onChoose={(name) =>
              choose({
                ...selection,
                // Choosing the default *is* choosing "none": the key is omitted on save, so the server's
                // default keeps applying even if it changes later.
                provider: name === archives.defaultProvider ? null : name,
              })
            }
          />
        </div>
      )}

      <p className="shrink-0 border-t border-border pt-3 text-xs text-muted-foreground">
        {t("modelBuilder.weather.noFetchHint")}
      </p>
    </div>
  );
};

const builderModule: BuilderModule = {
  module,
  Component,
  // The test data: the period (so a `year` choice has something to resolve from) and a starting selection.
  // Both are what a session would already hold by the time this node is reached.
  mock: {
    fromDate: "2025-01-01",
    toDate: "2025-12-31",
    weatherSelection: { provider: null, choice: "p50" },
  },
};

export default builderModule;
