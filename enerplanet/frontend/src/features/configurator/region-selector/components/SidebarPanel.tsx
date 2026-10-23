import {
  DateRangePicker,
  Dialog,
  Group,
  I18nProvider,
  Label,
  Popover,
  Button as Trigger,
} from "react-aria-components";
import { DateInput } from "@/components/ui/datefield-rac";
import { DATE_INPUT_STYLE } from "@/components/ui/datefield-rac.consts";
import { RangeCalendar } from "@/components/ui/calendar-rac";
import { parseDate } from "@internationalized/date";
import { cn } from "@/lib/utils";
import {
  Button,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@spatialhub/ui";
import {
  AlertTriangle,
  CalendarIcon,
  Loader2,
  ChevronRight,
  CircuitBoard,
  Activity,
  MapPinned,
  Building2,
  Info,
} from "lucide-react";
import { AdvancedParametersDrawer } from "../AdvancedParametersDrawer";
import { useConfirm } from "@/hooks/useConfirmDialog";
import { TechnologyDrawer } from "./TechnologyDrawer";
import { getDefaultAdvancedParameters } from "@/features/configurator/constants/area-select-params";
import { useModelStore, type RunMode } from "@/features/configurator/store/modelStore";
import type { OperateIssue } from "@/features/configurator/hooks/useOperateSizes";
import { TextInfoIcon } from "@/components/ui/InfoTooltip";
import { TOOLTIP_CONTENTS } from "@/components/shared/tooltip-contents";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useTranslation } from "@spatialhub/i18n";
import { useEffect, useRef, type FC, type ChangeEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useWeatherYears } from "@/features/configurator/hooks/useWeatherYears";
import { useAuthStore } from "@/store/auth-store";
import { WeatherSettings } from "./WeatherSettings";
import { SCENARIO_DATE_YEAR, isScenario } from "@/features/configurator/hooks/useAreaSelect/helpers/weatherSettings";
import type { AreaSelectState, AreaSelectActions } from "@/features/configurator/types/area-select";
import type { Technology } from "@/features/technologies/services/technologyService";
import type { AnalysisProgress } from "@/features/configurator/building-config/modelDemandProfiles";

interface SidebarPanelProps {
  state: AreaSelectState;
  actions: AreaSelectActions;
  allPolygonsCount: number;
  showAdvancedParams: boolean;
  onOpenAdvancedParams: () => void;
  onCloseAdvancedParams: () => void;
  advancedParams: ReturnType<typeof getDefaultAdvancedParameters>;
  onAdvancedParamsChange: (params: ReturnType<typeof getDefaultAdvancedParameters>) => void;
  onResetAdvancedParams: () => void;
  handleModelNameChange: (e: ChangeEvent<HTMLInputElement>) => void;
  editMode: boolean;
  showTechDrawer: boolean;
  onOpenTechDrawer: () => void;
  onCloseTechDrawer: () => void;
  onTechDragStart: (tech: Technology) => void;
  onTechDragEnd: () => void;
  onAddTechToAll?: (tech: Technology) => void;
  onRemoveTechFromAll?: (tech: Technology) => void;
  onRemoveAllTechs?: () => void;
  techBuildingCount?: number;
  appliedTechKeys?: string[];
  isModified?: boolean;
  /** Buildings whose technologies lack a size for operate mode. */
  operateIssues?: OperateIssue[];
  onFixOperateIssue?: (issue: OperateIssue, techKey: string) => void;
  /** The analysis of the saved model's buildings; null before the model is saved. */
  analysisProgress: AnalysisProgress | null;
  isStartingAnalysis: boolean;
  onAnalyse: () => void;
}

/** The message key saying why the model cannot be saved yet, or null when it can. */
const saveBlocker = (complete: boolean, gridStale: boolean): string | null => {
  if (!complete) return "simulation.actions.completeFirst";
  if (gridStale) return "simulation.actions.regenerateFirst";
  return null;
};

/** A titled group of settings, set off from the group above by a line. */
const PanelSection: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <section className="space-y-3 border-t border-border py-4 first:border-t-0 first:pt-0">
    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
    {children}
  </section>
);

/** One setting on a single line: its name with the hint behind an info icon, and its control. */
const SettingRow: FC<{ label: string; hint: string; icon?: LucideIcon; dataTour?: string; children: ReactNode }> = ({ label, hint, icon: Icon, dataTour, children }) => (
  <div className="flex items-center justify-between gap-2" data-tour={dataTour}>
    <div className="flex min-w-0 items-center gap-1.5">
      {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <span className="text-sm font-medium text-foreground">{label}</span>
      <TextInfoIcon title={label} description={hint} position="fixed-left-anchored" />
    </div>
    {children}
  </div>
);

// The period lies in one year. With historic weather the year is chosen from the
// archive's years, and a saved model keeps its year listed even when the archive
// no longer has it. With scenario weather the year is not the user's: new dates
// take SCENARIO_DATE_YEAR, and a saved model keeps the year it has. Day and month
// are typed either way.
function usePeriodYear(state: AreaSelectState, actions: AreaSelectActions, editMode: boolean | undefined) {
  const weather = useModelStore((s) => s.weather);
  const setWeather = useModelStore((s) => s.setWeather);
  const provider = weather.provider;
  const scenario = isScenario(weather);
  const weatherYears = useWeatherYears(provider);
  const periodYear = state.fromDate ? Number(state.fromDate.slice(0, 4)) : undefined;
  let yearOptions = weatherYears;
  if (scenario) yearOptions = [periodYear ?? SCENARIO_DATE_YEAR];
  else if (periodYear && !weatherYears.includes(periodYear)) yearOptions = [...weatherYears, periodYear].sort((a, b) => a - b);
  const fullYear = (year: number) => ({ start: parseDate(`${year}-01-01`), end: parseDate(`${year}-12-31`) });
  const choosePeriodYear = (year: number) => {
    if (!state.fromDate || !state.toDate) return actions.handleUpdateRange(fullYear(year));
    actions.handleUpdateRange({ start: parseDate(state.fromDate).set({ year }), end: parseDate(state.toDate).set({ year }) });
  };
  const latestYear = weatherYears.at(-1);
  const defaultYear = scenario ? SCENARIO_DATE_YEAR : latestYear;
  // A new model's empty period is filled after every render, because the
  // configurator's store reset on mount runs after this component's effects.
  useEffect(() => {
    if (!editMode && !state.fromDate && defaultYear) actions.handleUpdateRange(fullYear(defaultYear));
  });
  // Switching to an archive without the period's year moves the period to that
  // archive's latest year, keeping day and month. Opening a saved model does not.
  const lastProvider = useRef(provider);
  useEffect(() => {
    if (lastProvider.current === provider) return;
    lastProvider.current = provider;
    if (!scenario && latestYear && periodYear && !weatherYears.includes(periodYear)) choosePeriodYear(latestYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);
  // The calendar's first and last selectable days.
  const yearBounds = yearOptions.length
    ? { start: fullYear(yearOptions[0]).start, end: fullYear(yearOptions[yearOptions.length - 1]).end }
    : undefined;
  // Sets day and month to a part of the period's year; the year itself stays.
  const choosePeriodPart = (part: PeriodPart) => {
    const year = periodYear ?? latestYear;
    if (!year) return;
    actions.handleUpdateRange({ start: parseDate(`${year}-${part.start}`), end: parseDate(`${year}-${part.end}`) });
  };
  // Switching the weather mode moves the period into a year that mode allows,
  // keeping day and month: the scenario year, or the archive's latest year.
  const chooseWeatherMode = (toScenario: boolean) => {
    setWeather({ ...weather, choice: toScenario ? "p50" : "year" });
    const year = toScenario ? SCENARIO_DATE_YEAR : latestYear;
    if (year) choosePeriodYear(year);
  };
  return { scenario, periodYear, yearOptions, yearBounds, choosePeriodYear, choosePeriodPart, chooseWeatherMode };
}

/** Stands in for the year select while the period uses scenario weather, which has no calendar year. */
const ScenarioYearLabel: FC = () => {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex h-full shrink-0 cursor-help items-center gap-1 border-r border-border pl-3 pr-2 text-xs font-medium text-muted-foreground">
          {t("simulation.periodScenarioYear")}
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{t("simulation.periodScenarioHint")}</TooltipContent>
    </Tooltip>
  );
};

interface PeriodPart { key: string; start: string; end: string }

// Whole year and quarters as month-day bounds; the year is the period's.
const PERIOD_PARTS: PeriodPart[] = [
  { key: "year", start: "01-01", end: "12-31" },
  { key: "q1", start: "01-01", end: "03-31" },
  { key: "q2", start: "04-01", end: "06-30" },
  { key: "q3", start: "07-01", end: "09-30" },
  { key: "q4", start: "10-01", end: "12-31" },
];

/** One-click periods within the period's year: the whole year or a quarter. */
const PeriodParts: FC<{ onPick: (part: PeriodPart) => void }> = ({ onPick }) => {
  const { t } = useTranslation();
  return (
    <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t("simulation.periodParts.label")}>
      {PERIOD_PARTS.map((part) => (
        <button
          key={part.key}
          type="button"
          onClick={() => onPick(part)}
          className="h-6 cursor-pointer rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {t(`simulation.periodParts.${part.key}`)}
        </button>
      ))}
    </div>
  );
};

/** The simulation period's year, chosen from the years with weather data. */
const PeriodYearSelect: FC<{ year: number | undefined; years: number[]; onChange: (year: number) => void }> = ({ year, years, onChange }) => {
  const { t } = useTranslation();
  return (
    <select
      aria-label={t("simulation.periodYear")}
      value={year ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-full shrink-0 cursor-pointer border-r border-border bg-transparent pl-3 pr-1 text-xs font-medium text-foreground outline-none"
    >
      {year === undefined && <option value="">{t("simulation.periodYear")}</option>}
      {years.map((y) => (
        <option key={y} value={y}>{y}</option>
      ))}
    </select>
  );
};

// Hides a date field's year segment and the separator before it, in every locale's order.
const HIDE_YEAR_SEGMENT = "[&_[data-type=year]]:hidden [&_[data-type=literal]:has(+[data-type=year])]:hidden";

/** The analysis state under the Analyse buildings button. */
const analysisText = (progress: AnalysisProgress | null, t: (key: string, opts?: Record<string, unknown>) => string): string => {
  if (progress?.status === "resolving") return t("simulation.analysis.running", { done: progress.done, total: progress.total });
  if (progress?.status === "completed") {
    const done = t("simulation.analysis.done", { count: progress.done - progress.failed });
    return progress.failed > 0 ? `${done} · ${t("simulation.analysis.failed", { count: progress.failed })}` : done;
  }
  return t("simulation.analysis.notYet");
};

export const SidebarPanel: FC<SidebarPanelProps> = ({
  state,
  actions,
  allPolygonsCount,
  showAdvancedParams,
  // onOpenAdvancedParams,
  onCloseAdvancedParams,
  advancedParams,
  onAdvancedParamsChange,
  onResetAdvancedParams,
  handleModelNameChange,
  editMode,
  showTechDrawer,
  onOpenTechDrawer,
  onCloseTechDrawer,
  onTechDragStart,
  onTechDragEnd,
  onAddTechToAll,
  onRemoveTechFromAll,
  onRemoveAllTechs,
  techBuildingCount = 0,
  appliedTechKeys = [],
  isModified = false,
  operateIssues = [],
  onFixOperateIssue,
  analysisProgress,
  isStartingAnalysis,
  onAnalyse,
}) => {
  const { t, i18n } = useTranslation();
  const appLang = i18n.language?.split("-")[0] || "en";
  const runMode = useModelStore((s) => s.runMode);
  const setRunMode = useModelStore((s) => s.setRunMode);
  const siteMode = useModelStore((s) => s.siteMode);
  const gridStale = useModelStore((s) => s.gridStale);
  const missingInputs = !state.fromDate || !state.toDate || !state.modelName.trim();

  const { scenario, periodYear, yearOptions, yearBounds, choosePeriodYear, choosePeriodPart, chooseWeatherMode } = usePeriodYear(state, actions, editMode);
  const isExpert = useAuthStore((s) => s.user?.access_level === "expert");
  const confirm = useConfirm();
  const hasArea = state.allPolygons.length > 0;
  // Leaving a custom grid drops its placed transformers, so that switch asks first.
  const switchGridMode = (on: boolean) => {
    if (on || !hasArea) return void actions.handleSwitchGridMode(on);
    void confirm({
      type: "warning",
      title: t("simulation.siteMode.leaveTitle"),
      description: t("simulation.siteMode.leaveDescription"),
      confirmLabel: t("simulation.siteMode.leaveConfirm"),
      cancelLabel: t("common.cancel"),
      onConfirm: async () => void actions.handleSwitchGridMode(false),
    });
  };
  // A model is saved only with a name, a period and an area, and never with a grid older than its edits.
  const complete = Boolean(state.fromDate && state.toDate && state.modelName.trim()) && allPolygonsCount > 0;
  const canSave = complete && !state.isSaving && !gridStale;
  const saveBlockedKey = saveBlocker(complete, gridStale);
  const saveBlockedReason = saveBlockedKey ? t(saveBlockedKey) : undefined;
  const [searchParams] = useSearchParams();
  const buildingOpen = searchParams.has("building");

  // Ctrl+S / Cmd+S saves without leaving the page. The browser's own save is always
  // suppressed here; an open building configurator keeps the shortcut to itself.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (canSave && !buildingOpen) actions.handleQuickSave();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canSave, buildingOpen, actions]);

  return (
    <div className="md-scope md-rise relative h-full w-full border-l border-border bg-background dark:bg-gray-800 flex flex-col">
      <div className="flex items-center px-3 pt-4">
        <h3 className="text-base font-semibold text-foreground mb-4">{t("simulation.title")}</h3>
      </div>

      <div className="flex-1 overflow-y-auto pb-4 px-3">
        <PanelSection title={t("simulation.sections.grid")}>
          <SettingRow
            label={t("simulation.siteMode.label")}
            hint={hasArea ? `${t("simulation.siteMode.hint")} ${t("simulation.siteMode.switchHint")}` : t("simulation.siteMode.hint")}
            icon={MapPinned}
          >
            <Switch
              id="site-mode-toggle"
              aria-label={t("simulation.siteMode.label")}
              disabled={state.isGeneratingGrid}
              checked={siteMode}
              onCheckedChange={switchGridMode}
            />
          </SettingRow>
        </PanelSection>

        <PanelSection title={t("simulation.sections.model")}>
          <div className="relative" data-tour="model-name">
            <label
              htmlFor="model-name-input"
              className="block text-sm font-medium text-foreground mb-2"
            >
              {t("simulation.modelName")}
            </label>
            <input
              id="model-name-input"
              type="text"
              value={state.modelName}
              onChange={handleModelNameChange}
              placeholder={t("simulation.modelNamePlaceholder")}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none bg-background dark:bg-gray-700 text-foreground text-sm transition-colors duration-150 hover:border-muted-foreground/40"
            />
            <div className="text-xs text-muted-foreground mt-1">{t("simulation.modelNameHint")}</div>
          </div>
          <WeatherSettings isExpert={isExpert} onModeChange={chooseWeatherMode} />
          <div className="relative" data-tour="date-range">
            <DateRangePicker
              value={
                state.fromDate && state.toDate
                  ? {
                      start: parseDate(state.fromDate),
                      end: parseDate(state.toDate),
                    }
                  : null
              }
              onChange={(range) => {
                if (!range) return;
                actions.handleUpdateRange({ start: range.start, end: range.end });
              }}
              className="*:not-first:mt-2"
            >
              <Label className="text-foreground text-sm font-medium">
                {t("simulation.simulationPeriod")}
              </Label>
              <div className="flex">
                {/* English uses en-CH for DD.MM.YYYY fields; other languages keep their own date order. */}
                <I18nProvider locale={appLang === "en" ? "en-CH" : appLang}>
                  <Group
                    className={cn(
                      DATE_INPUT_STYLE,
                      "xl:px-0 lg:px-2 relative dark:bg-gray-700 dark:border-gray-600"
                    )}
                  >
                    {scenario ? <ScenarioYearLabel /> : <PeriodYearSelect year={periodYear} years={yearOptions} onChange={choosePeriodYear} />}
                    {/* Day and month are typed; the year comes from the weather mode. */}
                    <DateInput slot="start" unstyled className={cn("text-xs pl-3 py-2", HIDE_YEAR_SEGMENT)} />
                    <span aria-hidden="true" className="text-muted-foreground/70 px-2 py-2">
                      -
                    </span>
                    <DateInput slot="end" unstyled className={cn("text-xs pr-10 py-2", HIDE_YEAR_SEGMENT)} />
                    <Trigger className="text-muted-foreground/80 hover:text-foreground data-focus-visible:ring-ring/50 absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-e-md transition-[color,box-shadow] outline-none data-focus-visible:ring-[3px] cursor-pointer">
                      <CalendarIcon size={16} />
                    </Trigger>
                  </Group>
                </I18nProvider>
              </div>
              <Popover
                className="bg-background dark:bg-gray-800 text-popover-foreground data-entering:animate-in data-exiting:animate-out data-[entering]:fade-in-0 data-[exiting]:fade-out-0 data-[entering]:zoom-in-95 data-[exiting]:zoom-out-95 data-[placement=bottom]:slide-in-from-top-2 data-[placement=left]:slide-in-from-right-2 data-[placement=right]:slide-in-from-left-2 data-[placement=top]:slide-in-from-bottom-2 z-50 rounded-md border border-border shadow-lg outline-hidden"
                offset={4}
              >
                <Dialog className="max-h-[inherit] overflow-auto p-2">
                  <RangeCalendar
                    onChange={(range) =>
                      actions.handleUpdateRange({ start: range.start, end: range.end })
                    }
                    minValue={yearBounds?.start}
                    maxValue={yearBounds?.end}
                    years={yearOptions}
                    withinStartYear
                    yearLabel={scenario ? t("simulation.periodScenarioYear") : undefined}
                  />
                </Dialog>
              </Popover>
            </DateRangePicker>

            <div className="mt-2 text-xs text-muted-foreground">
              {t("simulation.duration")}:{" "}
              {/* Both the first and the last day are simulated. */}
              {state.fromDate && state.toDate
                ? Math.max(
                    0,
                    Math.round(
                      (new Date(state.toDate).getTime() - new Date(state.fromDate).getTime()) /
                        (1000 * 60 * 60 * 24)
                    ) + 1
                  )
                : 0}{" "}
              {t("simulation.days")}
            </div>
            <PeriodParts onPick={choosePeriodPart} />
          </div>
          <SettingRow label={t("simulation.resolution")} hint={t("simulation.resolutionHint")} dataTour="resolution">
            <SegmentedControl
              aria-label={t("simulation.resolution")}
              value={String(state.resolution)}
              onChange={(value) => actions.setResolution(Number(value))}
              options={[
                { value: "30", label: "30 min", disabled: true, title: t("simulation.resolutionComingSoon") },
                { value: "60", label: "60 min" },
              ]}
            />
          </SettingRow>
          <div>
            <SettingRow label={t("simulation.runMode.label")} hint={`${t("simulation.runMode.plan")}: ${t("simulation.runMode.planHint")}. ${t("simulation.runMode.operate")}: ${t("simulation.runMode.operateHint")}.`}>
              <SegmentedControl
                aria-label={t("simulation.runMode.label")}
                value={runMode}
                onChange={(value) => setRunMode(value as RunMode)}
                options={[
                  { value: "plan", label: t("simulation.runMode.plan"), title: t("simulation.runMode.planHint") },
                  { value: "operate", label: t("simulation.runMode.operate"), title: t("simulation.runMode.operateHint") },
                ]}
              />
            </SettingRow>
            {runMode === "operate" && operateIssues.length > 0 && (
              <div className="mt-2 rounded-md border border-red-300 bg-red-50 p-2 dark:border-red-800 dark:bg-red-950/40">
                <p className="text-xs font-medium text-red-700 dark:text-red-300">
                  {t("simulation.runMode.unsized", { count: operateIssues.length })}
                </p>
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                  {operateIssues.flatMap((issue) => issue.techs.map((tech) => (
                    <li key={`${issue.osmId}:${tech.techKey}`}>
                      <button
                        type="button"
                        onClick={() => onFixOperateIssue?.(issue, tech.techKey)}
                        className="w-full cursor-pointer text-left text-xs text-red-700 hover:underline dark:text-red-300"
                      >
                        {t("simulation.runMode.unsizedEntry", {
                          building: issue.osmId,
                          tech: t(`technologies.types.${tech.techKey}`, { defaultValue: tech.techKey }),
                          fields: tech.fields.map((field) => t(`simulation.runMode.fields.${field}`)).join(", "),
                        })}
                      </button>
                    </li>
                  )))}
                </ul>
              </div>
            )}
          </div>
        </PanelSection>

        <PanelSection title={t("simulation.sections.energySystem")}>
          <div className="flex gap-2" data-tour="technologies-parameters">
            <Button
              variant="outline"
              onClick={onOpenTechDrawer}
              className="h-auto flex-1 cursor-pointer justify-start gap-3 border-border px-3 py-2 text-left dark:border-gray-500 dark:bg-gray-700 dark:hover:bg-gray-600"
            >
              <CircuitBoard className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{t("simulation.technologies")}</span>
                <span className="block whitespace-normal text-xs font-normal text-muted-foreground">{t("technologies.dragInstruction")}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Button>
          </div>
          <SettingRow
            label={t("simulation.pypsaSimulation")}
            hint={t("tooltips.pypsaSimulation.description", { defaultValue: TOOLTIP_CONTENTS.pypsaSimulation.description })}
            icon={Activity}
          >
            <Switch
              id="pypsa-toggle"
              aria-label={t("simulation.pypsaSimulation")}
              disabled
              checked={advancedParams.pypsa_enabled}
              onCheckedChange={(checked) =>
                onAdvancedParamsChange({ ...advancedParams, pypsa_enabled: checked })
              }
            />
          </SettingRow>
        </PanelSection>
      </div>

      <div className="space-y-2 border-t border-border px-3 py-3">
        {allPolygonsCount > 0 && (
          <div className="space-y-1.5">
            <Button
              onClick={onAnalyse}
              disabled={
                missingInputs ||
                state.isSaving ||
                gridStale ||
                isStartingAnalysis ||
                analysisProgress?.status === "resolving"
              }
              title={gridStale ? t("simulation.actions.regenerateFirst") : undefined}
              variant="outline"
              className="h-8 w-full cursor-pointer"
            >
              {isStartingAnalysis || analysisProgress?.status === "resolving" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Building2 className="h-4 w-4" aria-hidden="true" />
              )}
              {t("simulation.analysis.button")}
            </Button>
            <p className="text-xs text-muted-foreground" aria-live="polite">{missingInputs ? t("simulation.analysis.needsInputs") : analysisText(analysisProgress, t)}</p>
          </div>
        )}
        {isModified && (
          <p className="md-fade-in flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("simulation.unsavedChanges.title")}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={actions.handleCancel} className="h-8 cursor-pointer">
            {t("simulation.actions.cancel")}
          </Button>
          <Button
            variant="outline"
            onClick={actions.handleQuickSave}
            disabled={!canSave}
            title={saveBlockedReason ?? t("simulation.actions.saveShortcut")}
            className="h-8 cursor-pointer"
          >
            {state.isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("common.save")}
          </Button>
          <Button
            onClick={actions.handleSave}
            disabled={!canSave}
            title={saveBlockedReason}
            className="h-8 flex-1 cursor-pointer"
            data-tour="save-button"
          >
            {state.isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {editMode ? t("simulation.actions.updating") : t("simulation.actions.creating")}
              </>
            ) : (
              t("simulation.actions.saveAndExit")
            )}
          </Button>
        </div>
      </div>

      <AdvancedParametersDrawer
        isOpen={showAdvancedParams}
        onClose={onCloseAdvancedParams}
        parameters={advancedParams}
        onParametersChange={onAdvancedParamsChange}
        onReset={onResetAdvancedParams}
      />

      <TechnologyDrawer
        isOpen={showTechDrawer}
        onClose={onCloseTechDrawer}
        onTechDragStart={onTechDragStart}
        onTechDragEnd={onTechDragEnd}
        onAddTechToAll={onAddTechToAll}
        onRemoveTechFromAll={onRemoveTechFromAll}
        onRemoveAllTechs={onRemoveAllTechs}
        techBuildingCount={techBuildingCount}
        appliedTechKeys={appliedTechKeys}
      />
    </div>
  );
};
