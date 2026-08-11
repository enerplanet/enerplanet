import { useCallback, useEffect } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import type { ConfiguratorContext, SimulationSettings, ScenarioType } from "../../types/context";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@spatialhub/ui";

/**
 * Simulation Settings module.
 *
 * Fully self-contained — does not reuse any configurator component or constant.
 * Lets the user configure the simulation/optimisation parameters (scenario,
 * cable types, transformer, solver, CO2 limit, battery hours, autarky, PyPSA)
 * and writes them to the shared context under `simulationSettings`.
 */

// ---------------------------------------------------------------------------
// Types (re-exported from context.ts to avoid circular dependency)
// ---------------------------------------------------------------------------

export type { ScenarioType, SimulationSettings } from "../../types/context";

export interface SimulationScenario {
  /** Category of the scenario. */
  type: ScenarioType;
  /** Machine-readable value within the category. */
  value: string;
}

interface SelectOption {
  value: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Defaults (module-local)
// ---------------------------------------------------------------------------

/**
 * Scenario options grouped by type.
 *
 * - **Season** — representative seasonal periods (winter / spring / summer / autumn).
 * - **Duration** — length of the modelled time horizon (1 / 5 / 10 years).
 * - **Calliope** — scenario dimensions commonly used in Calliope energy-system
 *   models: representative periods, climate years, policy/technology pathways,
 *   demand levels, and cost assumptions.
 */
export const SCENARIO_TYPES: { value: ScenarioType; label: string }[] = [
  { value: "season", label: "Season" },
  { value: "duration", label: "Duration" },
  { value: "calliope", label: "Calliope" },
];

export const SCENARIO_OPTIONS: Record<ScenarioType, SelectOption[]> = {
  season: [
    { value: "winter", label: "Winter" },
    { value: "spring", label: "Spring" },
    { value: "summer", label: "Summer" },
    { value: "autumn", label: "Autumn" },
  ],
  duration: [
    { value: "1y", label: "1 Year" },
    { value: "5y", label: "5 Years" },
    { value: "10y", label: "10 Years" },
  ],
  calliope: [
    // Representative periods
    { value: "typical-day", label: "Typical Day" },
    { value: "typical-week", label: "Typical Week" },
    { value: "full-year", label: "Full Year (8760 h)" },
    // Climate / weather years
    { value: "climate-2015", label: "Climate Year 2015" },
    { value: "climate-2019", label: "Climate Year 2019" },
    { value: "climate-2030", label: "Climate Year 2030" },
    { value: "climate-2050", label: "Climate Year 2050" },
    // Policy / technology pathways
    { value: "net-zero-2050", label: "Net-Zero 2050" },
    { value: "high-renewables", label: "High Renewables" },
    { value: "business-as-usual", label: "Business-as-Usual" },
    // Demand levels
    { value: "high-demand", label: "High Demand" },
    { value: "low-demand", label: "Low Demand" },
    // Cost assumptions
    { value: "high-fuel-prices", label: "High Fuel Prices" },
    { value: "low-capex", label: "Low CAPEX" },
  ],
};

/**
 * Convert a scenario to a concrete date range.
 *
 * All years use the same normalised dataset, so a scenario maps to a window
 * within (or spanning) a reference year:
 *
 * - **Season** — a seasonal window within the reference year.
 * - **Duration** — a full-year window spanning 1 / 5 / 10 years.
 * - **Calliope** — representative periods (day / week / full year), climate
 *   years, or a default full year for non-time-based policy/cost scenarios.
 */
export function scenarioToDateRange(scenario: SimulationScenario): {
  fromDate: string;
  toDate: string;
} {
  const REF_YEAR = 2024;
  const fullYear = (year: number) => ({
    fromDate: `${year}-01-01`,
    toDate: `${year}-12-31`,
  });

  switch (scenario.type) {
    case "season": {
      const ranges: Record<string, { fromDate: string; toDate: string }> = {
        winter: { fromDate: `${REF_YEAR}-12-01`, toDate: `${REF_YEAR + 1}-02-28` },
        spring: { fromDate: `${REF_YEAR}-03-01`, toDate: `${REF_YEAR}-05-31` },
        summer: { fromDate: `${REF_YEAR}-06-01`, toDate: `${REF_YEAR}-08-31` },
        autumn: { fromDate: `${REF_YEAR}-09-01`, toDate: `${REF_YEAR}-11-30` },
      };
      return ranges[scenario.value] ?? fullYear(REF_YEAR);
    }
    case "duration": {
      const years: Record<string, number> = { "1y": 1, "5y": 5, "10y": 10 };
      const n = years[scenario.value] ?? 1;
      return {
        fromDate: `${REF_YEAR}-01-01`,
        toDate: `${REF_YEAR + n - 1}-12-31`,
      };
    }
    case "calliope": {
      switch (scenario.value) {
        case "typical-day":
          return { fromDate: `${REF_YEAR}-01-01`, toDate: `${REF_YEAR}-01-01` };
        case "typical-week":
          return { fromDate: `${REF_YEAR}-01-01`, toDate: `${REF_YEAR}-01-07` };
        case "full-year":
          return fullYear(REF_YEAR);
        case "climate-2015":
          return fullYear(2015);
        case "climate-2019":
          return fullYear(2019);
        case "climate-2030":
          return fullYear(2030);
        case "climate-2050":
          return fullYear(2050);
        default:
          // Policy / cost / demand scenarios are not time-based — default to a
          // full reference year.
          return fullYear(REF_YEAR);
      }
    }
    default:
      return fullYear(REF_YEAR);
  }
}

const LV_CABLE_TYPES: SelectOption[] = [
  { value: "NAYY 4x185 SE", label: "NAYY 4x185 SE (33 €/m)" },
  { value: "NAYY 4x150 SE", label: "NAYY 4x150 SE (24 €/m)" },
  { value: "NAYY 4x120 SE", label: "NAYY 4x120 SE (19 €/m)" },
  { value: "NAYY 4x95 SE", label: "NAYY 4x95 SE (16 €/m)" },
  { value: "NAYY 4x50 SE", label: "NAYY 4x50 SE (11 €/m)" },
  { value: "NYY 4x70 SE", label: "NYY 4x70 SE (28 €/m)" },
  { value: "NYY 4x35 SE", label: "NYY 4x35 SE (16 €/m)" },
  { value: "NYY 4x16 SE", label: "NYY 4x16 SE (7 €/m)" },
];

const MV_CABLE_TYPES: SelectOption[] = [
  { value: "NA2XS2Y 1x185 RM/25 12/20 kV", label: "NA2XS2Y 1x185 RM/25 12/20 kV" },
  { value: "NA2XS2Y 1x150 RM/25 12/20 kV", label: "NA2XS2Y 1x150 RM/25 12/20 kV" },
  { value: "NA2XS2Y 1x120 RM/25 12/20 kV", label: "NA2XS2Y 1x120 RM/25 12/20 kV" },
  { value: "NA2XS2Y 3x1x150", label: "NA2XS2Y 3x1x150" },
];

/**
 * Named CO₂ limit presets (tonnes / year). Each preset is labelled by the
 * impact it has on the optimised system, from fully unconstrained to net-zero.
 */
export const CO2_PRESETS: { value: number; label: string; description: string }[] = [
  {
    value: 1e12,
    label: "Unconstrained",
    description: "No CO₂ cap — the optimiser is free to plan any emissions.",
  },
  {
    value: 50000000,
    label: "Relaxed (50 Mt)",
    description: "Loose cap — allows most conventional generation.",
  },
  {
    value: 20000000,
    label: "Moderate (20 Mt)",
    description: "Balanced — encourages some low-carbon generation.",
  },
  {
    value: 5000000,
    label: "Strict (5 Mt)",
    description: "Tight cap — forces significant renewables and storage.",
  },
  {
    value: 0,
    label: "Net-Zero",
    description: "No net emissions allowed — fully decarbonised system.",
  },
];

export function getDefaultSimulationSettings(): SimulationSettings {
  const scenario: SimulationScenario = { type: "season", value: "winter" };
  const { fromDate, toDate } = scenarioToDateRange(scenario);
  return {
    modelName: "My Energy Model",
    scenario,
    fromDate,
    toDate,
    line_type_lv: "NAYY 4x150 SE",
    line_type_mv: "NA2XS2Y 1x185 RM/25 12/20 kV",
    co2_limit: 20000000,
    max_hours: 72,
    autarky: 0,
    pypsa_enabled: true,
  };
}

// ---------------------------------------------------------------------------
// Module definition
// ---------------------------------------------------------------------------

export class SimulationSettingsModule extends BaseModule {
  readonly meta = {
    id: "simulation-settings",
    name: "Simulation Settings",
    description:
      "Configure the simulation and optimisation parameters: scenario, cable and transformer types, solver, and limits.",
    icon: "settings",
    category: "input" as const,
    defaultComplexity: "expert" as const,
  };

  readonly io = {
    inputs: [],
    outputs: ["simulationSettings"],
    required: [],
  };

  readonly component = SimulationSettingsComponent;

  override validate(context: ConfiguratorContext) {
    if (!context.simulationSettings) {
      return { valid: false, errors: ["Simulation settings not configured."] };
    }
    return { valid: true };
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function SimulationSettingsComponent({ context, onUpdate }: ModuleProps) {
  const settings: SimulationSettings = context.simulationSettings ?? getDefaultSimulationSettings();

  // Seed the defaults into the shared context on mount so validation passes
  // even if the user advances without changing anything.
  useEffect(() => {
    if (!context.simulationSettings) {
      onUpdate({ simulationSettings: getDefaultSimulationSettings() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback(
    (patch: Partial<SimulationSettings>) => {
      onUpdate({
        simulationSettings: { ...settings, ...patch },
      });
    },
    [onUpdate, settings]
  );

  return (
    <div className="space-y-5 p-4">
      <div className="text-sm text-muted-foreground">
        These settings control how the grid is generated and optimised. They are applied to the
        current model.
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Model Name</Label>
          <Input
            value={settings.modelName}
            placeholder="e.g. My Energy Model"
            onChange={(e) => {
              update({ modelName: e.target.value });
              // Also surface the name at the top-level context so downstream
              // modules (e.g. model-save) can read it directly.
              onUpdate({ modelName: e.target.value });
            }}
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label>Scenario</Label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              value={settings.scenario.type}
              onValueChange={(type) => {
                const scenario: SimulationScenario = {
                  type: type as ScenarioType,
                  value: SCENARIO_OPTIONS[type as ScenarioType][0].value,
                };
                const { fromDate, toDate } = scenarioToDateRange(scenario);
                update({ scenario, fromDate, toDate });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select scenario type" />
              </SelectTrigger>
              <SelectContent>
                {SCENARIO_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={settings.scenario.value}
              onValueChange={(value) => {
                const scenario: SimulationScenario = { ...settings.scenario, value };
                const { fromDate, toDate } = scenarioToDateRange(scenario);
                update({ scenario, fromDate, toDate });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select scenario" />
              </SelectTrigger>
              <SelectContent>
                {SCENARIO_OPTIONS[settings.scenario.type].map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Simulation period: {settings.fromDate} → {settings.toDate}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>LV Cable Type</Label>
          <Select value={settings.line_type_lv} onValueChange={(v) => update({ line_type_lv: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Select LV cable" />
            </SelectTrigger>
            <SelectContent>
              {LV_CABLE_TYPES.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>MV Cable Type</Label>
          <Select value={settings.line_type_mv} onValueChange={(v) => update({ line_type_mv: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Select MV cable" />
            </SelectTrigger>
            <SelectContent>
              {MV_CABLE_TYPES.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>CO2 Limit</Label>
          <Select
            value={String(settings.co2_limit)}
            onValueChange={(v) => update({ co2_limit: Number(v) })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select CO2 limit" />
            </SelectTrigger>
            <SelectContent>
              {CO2_PRESETS.map((p) => (
                <SelectItem key={p.value} value={String(p.value)}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {CO2_PRESETS.find((p) => p.value === settings.co2_limit)?.description ??
              "Maximum total CO₂ emissions the optimiser may plan for in one year."}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Max Battery Hours</Label>
          <Input
            type="number"
            value={settings.max_hours}
            min={0}
            step={1}
            onChange={(e) => update({ max_hours: Number(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">
            Longest storage duration the optimiser may size batteries for — the number of hours a
            fully charged battery can supply full load.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Self Sufficiency (0–1)</Label>
          <Input
            type="number"
            value={settings.autarky}
            min={0}
            max={1}
            step={0.01}
            onChange={(e) => update({ autarky: Number(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">
            Target share of demand covered by local generation: 0 = no target, 1 = aim to cover all
            demand locally.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
          <div>
            <Label className="text-sm font-medium">PyPSA Optimisation</Label>
            <p className="text-xs text-muted-foreground">
              Enable the PyPSA energy system optimisation.
            </p>
          </div>
          <Switch
            checked={settings.pypsa_enabled}
            onCheckedChange={(checked) => update({ pypsa_enabled: checked })}
          />
        </div>
      </div>
    </div>
  );
}

export const simulationSettingsModule = new SimulationSettingsModule();
