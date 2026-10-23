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
  Label as UILabel,
} from "@spatialhub/ui";
import {
  AlertTriangle,
  CalendarIcon,
  Loader2,
  CircuitBoard,
  Activity,
  MapPinned,
} from "lucide-react";
import { AdvancedParametersDrawer } from "../AdvancedParametersDrawer";
import { TechnologyDrawer } from "./TechnologyDrawer";
import { getDefaultAdvancedParameters } from "@/features/configurator/constants/area-select-params";
import { useModelStore, type CookingCarrier, type RunMode } from "@/features/configurator/store/modelStore";
import type { OperateIssue } from "@/features/configurator/hooks/useOperateSizes";
import { InfoIcon, TextInfoIcon } from "@/components/ui/InfoTooltip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useTranslation } from "@spatialhub/i18n";
import type { FC, ChangeEvent, ReactNode } from "react";
import type { AreaSelectState, AreaSelectActions } from "@/features/configurator/types/area-select";
import type { Technology } from "@/features/technologies/services/technologyService";

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
}

/** One setting on a single line: its name with the hint behind an info icon, and its control. */
const SettingRow: FC<{ label: string; hint: string; dataTour?: string; children: ReactNode }> = ({ label, hint, dataTour, children }) => (
  <div className="flex items-center justify-between gap-2" data-tour={dataTour}>
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <TextInfoIcon title={label} description={hint} position="fixed-left-anchored" />
    </div>
    {children}
  </div>
);

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
}) => {
  const { t, i18n } = useTranslation();
  const appLang = i18n.language?.split("-")[0] || "en";
  const cookingCarrier = useModelStore((s) => s.cookingCarrier);
  const setCookingCarrier = useModelStore((s) => s.setCookingCarrier);
  const runMode = useModelStore((s) => s.runMode);
  const setRunMode = useModelStore((s) => s.setRunMode);
  const siteMode = useModelStore((s) => s.siteMode);
  const gridStale = useModelStore((s) => s.gridStale);
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
                  <DateInput slot="start" unstyled className="text-xs pl-3 pr-1 py-2 flex-1" />
                  <span aria-hidden="true" className="text-muted-foreground/70 px-2 py-2">
                    -
                  </span>
                  <DateInput slot="end" unstyled className="text-xs pl-1 pr-10 py-2 flex-1" />
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
                />
              </Dialog>
            </Popover>
          </DateRangePicker>

          <div className="mt-2 text-xs text-muted-foreground">
            {t("simulation.duration")}:{" "}
            {state.fromDate && state.toDate
              ? Math.max(
                  0,
                  Math.ceil(
                    (new Date(state.toDate).getTime() - new Date(state.fromDate).getTime()) /
                      (1000 * 60 * 60 * 24)
                  )
                )
              : 0}{" "}
            {t("simulation.days")}
          </div>
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

        <SettingRow label={t("simulation.cooking.label")} hint={t("simulation.cooking.hint")}>
          <SegmentedControl
            aria-label={t("simulation.cooking.label")}
            value={cookingCarrier}
            onChange={(value) => setCookingCarrier(value as CookingCarrier)}
            options={[
              { value: "electric", label: t("simulation.cooking.electric") },
              { value: "gas", label: t("simulation.cooking.gas") },
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

        <div className="flex items-center justify-between p-3 bg-muted/50 dark:bg-gray-700/50 border border-border rounded-lg">
          <div className="flex items-center gap-2">
            <MapPinned className="w-4 h-4 text-foreground" />
            <UILabel htmlFor="site-mode-toggle" className="text-sm font-medium text-foreground cursor-pointer">
              {t("simulation.siteMode.label")}
            </UILabel>
            <TextInfoIcon
              title={t("simulation.siteMode.label")}
              description={t(siteModeLocked ? "simulation.siteMode.locked" : "simulation.siteMode.hint")}
              position="fixed-left-anchored"
            />
          </div>
          <Switch
            id="site-mode-toggle"
            disabled={siteModeLocked}
            checked={siteMode}
            onCheckedChange={setSiteMode}
          />
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
