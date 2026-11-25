/**
 * The `weather` module — which backend weather dataset a model's runs use.
 *
 * It selects; it does not fetch. The one backend call it makes — listing archives and years — arrives through
 * a provider slot (`archives.ts`), not an import. `provider: null` means "the server's default archive".
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
import { useArchives } from "./archives";

/** The module's own surface, re-exported so a host installs a source through the module's entry point. */
export { setWeatherSource } from "./archives";
export type { WeatherArchives, WeatherSource } from "./archives";

/** The scenarios, low to high solar — the order the legacy shows them in. */
const SCENARIOS: readonly WeatherChoice[] = ["p10", "p50", "p90"];

/** Published names for the archives weather-serve lists, as the legacy renders them. */
const ARCHIVE_NAMES: Record<string, string> = {
  "merra-2": "MERRA-2",
  "era5-land": "ERA5-Land",
  "cosmo-rea6": "COSMO-REA6",
};

/** The module's own model: what its controls have collected, keyed by the node they were collected for. */
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

/** What this module stands behind — an issue only when a recorded year has no period to take it from. */
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

  // What it writes, plus what it reads and may invalidate. `fromDate` is required: it carries a recorded year.
  params: [{ port: "weatherSelection" }, { port: "fromDate", required: true }, { port: "buildingParams" }],

  // The direct edges only; invalidation is transitive. `fromDate` is named because a recorded year comes from the period.
  affect: { weatherSelection: ["buildingParams"], fromDate: ["weatherSelection"] },

  layout: ["sidebar"],

  run: (ctx) => {
    const collected = takeHeld();
    const chosen = collected.weatherSelection as WeatherSelection | undefined;
    if (chosen === undefined) return; // a bare run with nothing collected proposes nothing (the trace still lands)

    // Read before write, and this read is also what licenses the rewrite.
    const current = ctx.read("weatherSelection");

    // The year is the period's, from `fromDate`; only a `year` choice has one.
    const year = chosen.choice === "year" ? yearOf(ctx.read("fromDate")) : undefined;
    const resolved: WeatherSelection = { ...chosen, ...(year === undefined ? {} : { year }) };

    if (sameSelection(current, resolved)) return; // nothing changed — no op, no transaction
    ctx.commit({ weatherSelection: resolved });
  },

  validate: (ctx) => issuesFor(ctx.store),
});

/** A row of mutually exclusive choices — one click each. What a click *does* is the module's business. */
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
  const { archives } = useArchives();

  /** What the user has picked but not yet committed; a click collects, and one commit hands it all over. */
  const [typed, setTyped] = useState<WeatherSelection | null>(null);

  // A node change drops what was held; the panel shows the store's selection again.
  useEffect(() => {
    hold(nodeId, {});
    setTyped(null);
  }, [nodeId]);

  // Scenario only. The year mode reads a recorded year from the period and is not supported yet, so the row is gone.
  if (region !== "sidebar") return null;

  const stored = data.weatherSelection ?? DEFAULT_SELECTION;
  /** The selection on screen: what was picked here, or what the model holds. Never both. */
  const selection = typed ?? stored;

  const archiveNames = Object.keys(archives.archives);
  const shownArchive = selection.provider ?? archives.defaultProvider;

  // The gate reads the store's shape, so the pending selection is handed to it the same way a commit would.
  const issues = issuesFor({ weatherSelection: selection });
  const ready = issues.length === 0;

  /** One gesture, one commit: whatever the panel shows is handed over together, then the session moves on. */
  const commit = (): void => {
    hold(nodeId, { weatherSelection: selection });
    void run().finally(() => {
      // The store's value takes over again, so a failed run leaves the panel showing the truth.
      setTyped(null);
    });
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h3 className="text-base font-semibold">{t("modelBuilder.weather.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("modelBuilder.weather.description")}</p>
      </div>

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
          onChoose={(choice) => setTyped({ provider: selection.provider, choice: choice as WeatherChoice })}
        />
        <p className="text-xs text-muted-foreground">{t("modelBuilder.weather.scenarioHint")}</p>
      </div>

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
              setTyped({
                ...selection,
                // Choosing the default is choosing "none": the key is omitted on save, so the server default keeps applying.
                provider: name === archives.defaultProvider ? null : name,
              })
            }
          />
        </div>
      )}

      <button
        type="button"
        onClick={commit}
        disabled={!ready}
        className="w-full shrink-0 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t("modelBuilder.weather.continue")}
      </button>

      {/* A disabled button says what it waits for; the gate's own message. */}
      {ready ? null : (
        <p className="shrink-0 text-xs text-muted-foreground">{issues[0]?.message}</p>
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
  mock: {
    fromDate: "2025-01-01",
    toDate: "2025-12-31",
    weatherSelection: { provider: null, choice: "p50" },
  },
};

export default builderModule;
