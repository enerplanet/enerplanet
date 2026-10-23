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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
  Switch,
  Label as UILabel,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@spatialhub/ui";
import {
  AlertTriangle,
  CalendarIcon,
  Loader2,
  CircuitBoard,
  Activity,
  MapPinned,
  Building2,
} from "lucide-react";
import { AdvancedParametersDrawer } from "../AdvancedParametersDrawer";
import { TechnologyDrawer } from "./TechnologyDrawer";
import { getDefaultAdvancedParameters } from "@/features/configurator/constants/area-select-params";
import { useModelStore, type CookingCarrier, type RunMode } from "@/features/configurator/store/modelStore";
import type { OperateIssue } from "@/features/configurator/hooks/useOperateSizes";
import { InfoIcon } from "@/components/ui/InfoTooltip";
import { useTranslation } from "@spatialhub/i18n";
import type { FC, ChangeEvent } from "react";
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
  getDateBounds: () => { minValue: any; maxValue: any; minYear: number; maxYear: number };
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
  getDateBounds,
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
  const cookingCarrier = useModelStore((s) => s.cookingCarrier);
  const setCookingCarrier = useModelStore((s) => s.setCookingCarrier);
  const runMode = useModelStore((s) => s.runMode);
  const setRunMode = useModelStore((s) => s.setRunMode);
  const siteMode = useModelStore((s) => s.siteMode);
  const gridStale = useModelStore((s) => s.gridStale);
  const missingInputs = !state.fromDate || !state.toDate || !state.modelName.trim();
  const setSiteMode = useModelStore((s) => s.setSiteMode);
  // A drawn grid was made in one mode; switching would leave it labelled with the other.
  const siteModeLocked = state.allPolygons.length > 0;

  return (
    <div className="md-scope md-rise relative h-full w-full border-l border-border bg-background dark:bg-gray-800 flex flex-col">
      <div className="flex items-center px-3 pt-4">
        <h3 className="text-base font-semibold text-foreground mb-4">{t("simulation.title")}</h3>
      </div>

      {isModified && state.fromDate && state.toDate && state.modelName.trim() && (
        <div className="md-fade-in mx-3 mb-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
              {t("simulation.unsavedChanges.title")}
            </span>
            <Button
              onClick={actions.handleCancel}
              className="ml-auto cursor-pointer shrink-0 h-7 text-red-600 dark:text-red-400"
              aria-label={t("simulation.actions.cancel")}
              variant="outline"
            >
              <span>{t("simulation.actions.cancel")}</span>
            </Button>
          </div>
          <div className="flex gap-8">
            <Button
              onClick={actions.handleSave}
              disabled={
                !state.fromDate ||
                !state.toDate ||
                !state.modelName.trim() ||
                state.isSaving ||
                allPolygonsCount === 0 ||
                gridStale
              }
              title={gridStale ? t("simulation.actions.regenerateFirst") : undefined}
              variant="default"
              className="flex-1 shrink-0 h-7 cursor-pointer bg-gradient-to-br from-gray-800 to-black hover:from-gray-700 hover:to-gray-900 border-0"
              data-tour="save-button"
            >
              {state.isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {editMode ? t("simulation.actions.updating") : t("simulation.actions.creating")}
                </>
              ) : (
                <>{t("simulation.actions.saveAndExit")}</>
              )}
            </Button>
            <Button
              onClick={actions.handleQuickSave}
              disabled={
                !state.fromDate ||
                !state.toDate ||
                !state.modelName.trim() ||
                state.isSaving ||
                allPolygonsCount === 0 ||
                gridStale
              }
              title={gridStale ? t("simulation.actions.regenerateFirst") : undefined}
              variant="outline"
              className="ml-auto cursor-pointer shrink-0 h-7 px-5.5"
              aria-label={t("common.save")}
            >
              {state.isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>{t("common.save")}</>
              )}
            </Button>
          </div>
        </div>
      )}

      {allPolygonsCount > 0 && (
        <div className="mx-3 mb-2 space-y-1.5">
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

      <div className="flex-1 overflow-y-auto pb-4 space-y-3 px-3">
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
                  <DateInput slot="start" unstyled className="text-xs pl-3 py-2" />
                  <span aria-hidden="true" className="text-muted-foreground/70 px-2 py-2">
                    -
                  </span>
                  <DateInput slot="end" unstyled className="text-xs pr-10 py-2" />
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
                  minValue={getDateBounds().minValue}
                  maxValue={getDateBounds().maxValue}
                  minYear={getDateBounds().minYear}
                  maxYear={getDateBounds().maxYear}
                  withinStartYear
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
        </div>

        <div className="relative" data-tour="resolution">
          <label
            htmlFor="resolution-select"
            className="block text-sm font-medium text-foreground mb-2"
          >
            {t("simulation.resolution")}
          </label>
          <Select
            value={String(state.resolution)}
            onValueChange={(value: any) => actions.setResolution(Number(value))}
          >
            <SelectTrigger id="resolution-select" className="w-full">
              <SelectValue placeholder={t("simulation.resolutionPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <SelectItem value="30" disabled>
                      30 {t("simulation.minutes")}
                    </SelectItem>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("simulation.resolutionComingSoon")}</TooltipContent>
              </Tooltip>
              <SelectItem value="60">60 {t("simulation.minutes")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground mt-1">{t("simulation.resolutionHint")}</div>
        </div>

        <div className="relative">
          <label htmlFor="cooking-select" className="block text-sm font-medium text-foreground mb-2">
            {t("simulation.cooking.label")}
          </label>
          <Select value={cookingCarrier} onValueChange={(value: string) => setCookingCarrier(value as CookingCarrier)}>
            <SelectTrigger id="cooking-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="electric">{t("simulation.cooking.electric")}</SelectItem>
              <SelectItem value="gas">{t("simulation.cooking.gas")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground mt-1">{t("simulation.cooking.hint")}</div>
        </div>

        <div className="relative">
          <label htmlFor="run-mode-select" className="block text-sm font-medium text-foreground mb-2">
            {t("simulation.runMode.label")}
          </label>
          <Select value={runMode} onValueChange={(value: string) => setRunMode(value as RunMode)}>
            <SelectTrigger id="run-mode-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="plan">{t("simulation.runMode.plan")}</SelectItem>
              <SelectItem value="operate">{t("simulation.runMode.operate")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground mt-1">{t(`simulation.runMode.${runMode}Hint`)}</div>
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

        <div className="flex gap-2" data-tour="technologies-parameters">
          <Button
            variant="outline"
            onClick={onOpenTechDrawer}
            className="flex-1 cursor-pointer flex items-center justify-center gap-2"
          >
            <CircuitBoard className="w-4 h-4" />
            {t("simulation.technologies")}
          </Button>
          {/* <Button
                        variant="outline"
                        onClick={onOpenAdvancedParams}
                        className="flex-1 cursor-pointer flex items-center justify-center gap-2"
                    >
                        <Sliders className="w-4 h-4" />
                        {t('simulation.parameters')}
                    </Button> */}
        </div>

        <div className="p-3 bg-muted/50 dark:bg-gray-700/50 border border-border rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPinned className="w-4 h-4 text-foreground" />
              <UILabel htmlFor="site-mode-toggle" className="text-sm font-medium text-foreground cursor-pointer">
                {t("simulation.siteMode.label")}
              </UILabel>
            </div>
            <Switch
              id="site-mode-toggle"
              disabled={siteModeLocked}
              checked={siteMode}
              onCheckedChange={setSiteMode}
            />
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {t(siteModeLocked ? "simulation.siteMode.locked" : "simulation.siteMode.hint")}
          </div>
        </div>

        <div className="flex items-center justify-between p-3 bg-muted/50 dark:bg-gray-700/50 border border-border rounded-lg">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-foreground" />
            <UILabel
              htmlFor="pypsa-toggle"
              className="text-sm font-medium text-foreground cursor-pointer"
            >
              {t("simulation.pypsaSimulation")}
            </UILabel>
            <InfoIcon tooltipKey="pypsaSimulation" position="fixed-left-anchored" />
          </div>
          <Switch
            id="pypsa-toggle"
            disabled
            checked={advancedParams.pypsa_enabled}
            onCheckedChange={(checked) =>
              onAdvancedParamsChange({ ...advancedParams, pypsa_enabled: checked })
            }
          />
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
