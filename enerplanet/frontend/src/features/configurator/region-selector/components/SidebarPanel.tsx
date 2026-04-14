import { DateRangePicker, Dialog, Group, Label, Popover, Button as Trigger } from "react-aria-components";
import { DateInput } from "@/components/ui/datefield-rac";
import { DATE_INPUT_STYLE } from "@/components/ui/datefield-rac.consts";
import { RangeCalendar } from "@/components/ui/calendar-rac";
import { parseDate } from "@internationalized/date";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button, Switch, Label as UILabel, Tooltip, TooltipContent, TooltipTrigger } from "@spatialhub/ui";
import { CheckCircle, CalendarIcon, Loader2, CircuitBoard, Activity, Ruler, Sun, Leaf, Zap, MapPin } from "lucide-react";
import { useMemo } from "react";
import area from "@turf/area";
import length from "@turf/length";
import { polygon, lineString } from "@turf/helpers";
import { AdvancedParametersDrawer } from "../AdvancedParametersDrawer";
import { TechnologyDrawer } from "./TechnologyDrawer";
import { getDefaultAdvancedParameters } from "@/features/configurator/constants/area-select-params";
import { GridStatsBadge } from "./GridStatsBadge";
import { InfoIcon } from "@/components/ui/InfoTooltip";
import { useTranslation } from "@spatialhub/i18n";
import type { FC, ChangeEvent } from "react";
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
    appliedTechKeys?: string[];
    gridResultIds?: number[];
    buildingsCount?: number;
    peakLoadKw?: number;
    customLocationsCount?: number;
    regionName?: string;
    polygonCoordinates?: [number, number][][];
}

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
    appliedTechKeys = [],
    gridResultIds = [],
    buildingsCount,
    peakLoadKw,
    customLocationsCount = 0,
    regionName,
    polygonCoordinates = [],
}) => {
    const { t } = useTranslation();

    // Calculate polygon area stats
    const areaStats = useMemo(() => {
        if (polygonCoordinates.length === 0) return null;

        const { totalArea, totalPerimeter } = polygonCoordinates.reduce(
            (acc, coords) => {
                if (!coords || coords.length < 3) return acc;
                try {
                    const closed = [...coords, coords[0]];
                    const poly = polygon([closed]);
                    const areaM2 = area(poly);
                    const perimeterKm = length(lineString(closed), { units: 'kilometers' });
                    return {
                        totalArea: acc.totalArea + areaM2,
                        totalPerimeter: acc.totalPerimeter + perimeterKm * 1000
                    };
                } catch {
                    return acc;
                }
            },
            { totalArea: 0, totalPerimeter: 0 }
        );

        if (totalArea === 0) return null;

        const formatArea = (areaM2: number) => {
            if (areaM2 >= 1000000) return `${(areaM2 / 1000000).toFixed(2)} km²`;
            if (areaM2 >= 10000) return `${(areaM2 / 10000).toFixed(2)} ha`;
            return `${areaM2.toFixed(0)} m²`;
        };

        const formatPerimeter = (m: number) => {
            if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
            return `${m.toFixed(0)} m`;
        };

        const solarKWp = Number((totalArea * 0.15 * 0.2).toFixed(0));
        const genMWh = Number((solarKWp * 1.1).toFixed(0));
        const co2Tonnes = (genMWh * 0.4).toFixed(1);

        return {
            area: formatArea(totalArea),
            perimeter: formatPerimeter(totalPerimeter),
            solarKWp,
            genMWh,
            co2Tonnes,
            regions: polygonCoordinates.length,
        };
    }, [polygonCoordinates]);

    return (
        <div className="relative h-full w-80 border-l border-border bg-background dark:bg-gray-800 flex flex-col">
            <div className="flex items-center px-3 pt-4">
                <h3 className="text-base font-semibold text-foreground mb-4">{t('simulation.title')}</h3>
            </div>

            <div className="flex-1 overflow-y-auto pb-4 space-y-3 px-3">
                {/* Grid Statistics - compact badge shown when grid data is available */}
                {gridResultIds.length > 0 && (
                    <GridStatsBadge gridResultIds={gridResultIds} buildingsCount={buildingsCount} peakLoadKw={peakLoadKw} />
                )}

                {/* Area Statistics */}
                {areaStats && (
                    <div className="rounded-lg border border-border bg-card overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
                            <MapPin className="w-3.5 h-3.5 text-foreground" />
                            <span className="text-xs font-semibold text-foreground">{t("areaStats.title")}</span>
                            {areaStats.regions > 1 && (
                                <span className="text-[10px] text-foreground/70 font-medium px-1.5 py-0.5 bg-muted rounded ml-auto">
                                    {areaStats.regions} {t("areaStats.regions")}
                                </span>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2.5 text-xs">
                            <div className="flex items-center gap-1.5">
                                <Ruler className="w-3 h-3 text-muted-foreground" />
                                <span className="text-muted-foreground">{t("areaStats.area")}</span>
                            </div>
                            <span className="font-medium text-foreground text-right">{areaStats.area}</span>

                            <div className="flex items-center gap-1.5">
                                <Ruler className="w-3 h-3 text-muted-foreground" />
                                <span className="text-muted-foreground">{t("areaStats.perimeter")}</span>
                            </div>
                            <span className="font-medium text-foreground text-right">{areaStats.perimeter}</span>

                            <div className="flex items-center gap-1.5">
                                <Sun className="w-3 h-3 text-muted-foreground" />
                                <span className="text-muted-foreground">{t("areaStats.solarPotential")}</span>
                            </div>
                            <span className="font-medium text-foreground text-right">~{areaStats.solarKWp} kWp</span>

                            <div className="flex items-center gap-1.5">
                                <Zap className="w-3 h-3 text-muted-foreground" />
                                <span className="text-muted-foreground">{t("areaStats.estGeneration")}</span>
                            </div>
                            <span className="font-medium text-foreground text-right">~{areaStats.genMWh} MWh/yr</span>

                            <div className="flex items-center gap-1.5">
                                <Leaf className="w-3 h-3 text-muted-foreground" />
                                <span className="text-muted-foreground">{t("areaStats.co2Offset")}</span>
                            </div>
                            <span className="font-medium text-foreground text-right">~{areaStats.co2Tonnes} t/yr</span>
                        </div>
                    </div>
                )}

                <div className="relative" data-tour="model-name">
                    <label htmlFor="model-name-input" className="block text-sm font-medium text-foreground mb-2">{t('simulation.modelName')}</label>
                    <input
                        id="model-name-input"
                        type="text"
                        value={state.modelName}
                        onChange={handleModelNameChange}
                        placeholder={t('simulation.modelNamePlaceholder')}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none bg-background dark:bg-gray-700 text-foreground text-sm transition-colors"
                    />
                    <div className="text-xs text-muted-foreground mt-1">{t('simulation.modelNameHint')}</div>
                </div>

                <div className="relative" data-tour="date-range">
                    <DateRangePicker
                        value={state.fromDate && state.toDate ? {
                            start: parseDate(state.fromDate),
                            end: parseDate(state.toDate),
                        } : null}
                        onChange={(range) => {
                            if (!range) return;
                            actions.handleUpdateRange({ start: range.start, end: range.end });
                        }}
                        className="*:not-first:mt-2"
                    >
                        <Label className="text-foreground text-sm font-medium">{t('simulation.simulationPeriod')}</Label>
                        <div className="flex">
                            <Group className={cn(DATE_INPUT_STYLE, "xl:px-0 lg:px-2 relative dark:bg-gray-700 dark:border-gray-600")}> 
                                <DateInput slot="start" unstyled className="text-xs pl-3 pr-1 py-2 flex-1" />
                                <span aria-hidden="true" className="text-muted-foreground/70 px-2 py-2">
                                    -
                                </span>
                                <DateInput slot="end" unstyled className="text-xs pl-1 pr-10 py-2 flex-1" />
                                <Trigger className="text-muted-foreground/80 hover:text-foreground data-focus-visible:border-ring data-focus-visible:ring-ring/50 absolute inset-0 flex items-center justify-end pr-3 transition-[color,box-shadow] outline-none data-focus-visible:ring-[3px] cursor-pointer">
                                    <CalendarIcon size={16} />
                                </Trigger>
                            </Group>
                        </div>
                        <Popover
                            className="bg-background dark:bg-gray-800 text-popover-foreground data-entering:animate-in data-exiting:animate-out data-[entering]:fade-in-0 data-[exiting]:fade-out-0 data-[entering]:zoom-in-95 data-[exiting]:zoom-out-95 data-[placement=bottom]:slide-in-from-top-2 data-[placement=left]:slide-in-from-right-2 data-[placement=right]:slide-in-from-left-2 data-[placement=top]:slide-in-from-bottom-2 z-50 rounded-md border border-border shadow-lg outline-hidden"
                            offset={4}
                        >
                            <Dialog className="max-h-[inherit] overflow-auto p-2">
                                <RangeCalendar
                                    onChange={(range) => actions.handleUpdateRange({ start: range.start, end: range.end })}
                                    minValue={getDateBounds().minValue}
                                    maxValue={getDateBounds().maxValue}
                                    minYear={getDateBounds().minYear}
                                    maxYear={getDateBounds().maxYear}
                                />
                            </Dialog>
                        </Popover>
                    </DateRangePicker>

                    <div className="mt-2 text-xs text-muted-foreground text-center">
                        {t('simulation.duration')}:{" "}
                        {state.fromDate && state.toDate ? Math.max(
                            0,
                            Math.ceil((new Date(state.toDate).getTime() - new Date(state.fromDate).getTime()) / (1000 * 60 * 60 * 24))
                        ) : 0}{" "}
                        {t('simulation.days')}
                    </div>
                </div>

                <div className="relative" data-tour="resolution">
                    <label htmlFor="resolution-select" className="block text-sm font-medium text-foreground mb-2">
                        {t('simulation.resolution')}
                    </label>
                    <Select
                        value={String(state.resolution)}
                        onValueChange={(value: any) => actions.setResolution(Number(value))}
                    >
                        <SelectTrigger id="resolution-select" className="w-full">
                            <SelectValue placeholder={t('simulation.resolutionPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span>
                                        <SelectItem value="30" disabled>30 {t('simulation.minutes')}</SelectItem>
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent>30-minute resolution coming in a future release</TooltipContent>
                            </Tooltip>
                            <SelectItem value="60">60 {t('simulation.minutes')}</SelectItem>
                        </SelectContent>
                    </Select>
                    <div className="text-xs text-muted-foreground mt-1">
                        {t('simulation.resolutionHint')}
                    </div>
                </div>

                <div className="flex gap-2" data-tour="technologies-parameters">
                    <Button
                        variant="outline"
                        onClick={onOpenTechDrawer}
                        className="flex-1 cursor-pointer flex items-center justify-center gap-2"
                    >
                        <CircuitBoard className="w-4 h-4" />
                        {t('simulation.technologies')}
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
                        <Activity className="w-4 h-4 text-foreground" />
                        <UILabel htmlFor="pypsa-toggle" className="text-sm font-medium text-foreground cursor-pointer">
                            {t('simulation.pypsaSimulation')}
                        </UILabel>
                        <InfoIcon tooltipKey="pypsaSimulation" position="fixed-left-anchored" />
                    </div>
                    <Switch
                        id="pypsa-toggle"
                        checked={advancedParams.pypsa_enabled}
                        onCheckedChange={(checked) => onAdvancedParamsChange({ ...advancedParams, pypsa_enabled: checked })}
                    />
                </div>

                <div className="bg-background dark:bg-gray-700 border border-border rounded-lg p-3">
                    <h4 className="text-sm font-semibold text-foreground mb-2">{t('simulation.summary.title')}</h4>
                    <div className="space-y-1 text-xs text-muted-foreground">
                        {regionName && (
                            <div className="flex justify-between">
                                <span>{t('simulation.summary.region')}:</span>
                                <span className="font-medium text-foreground">{regionName}</span>
                            </div>
                        )}
                        <div className="flex justify-between">
                            <span>{t('simulation.summary.areaDefined')}:</span>
                            <span className={`font-medium ${allPolygonsCount > 0 ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                                {allPolygonsCount > 0 ? `✓ ${t('simulation.summary.drawn')}` : t('simulation.summary.notDrawn')}
                            </span>
                        </div>
                        {customLocationsCount > 0 && (
                            <div className="flex justify-between">
                                <span>{t('simulation.summary.customLocations')}:</span>
                                <span className="font-medium text-purple-600 dark:text-purple-400">
                                    {customLocationsCount} {t('simulation.summary.found')}
                                </span>
                            </div>
                        )}
                        <div className="flex justify-between">
                            <span>{t('simulation.summary.from')}:</span>
                            <span className="font-medium text-foreground">{state.fromDate}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>{t('simulation.summary.to')}:</span>
                            <span className="font-medium text-foreground">{state.toDate}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>{t('simulation.summary.resolution')}:</span>
                            <span className="font-medium text-foreground">{state.resolution} min</span>
                        </div>
                    </div>
                </div>

                <div className="space-y-3">
                    <Button
                        onClick={actions.handleSave}
                        disabled={!state.fromDate || !state.toDate || !state.modelName.trim() || state.isSaving || allPolygonsCount === 0}
                        variant="default"
                        className="w-full cursor-pointer bg-gradient-to-br from-gray-800 to-black hover:from-gray-700 hover:to-gray-900 border-0"
                        data-tour="save-button"
                    >
                        {state.isSaving ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {editMode ? t('simulation.actions.updating') : t('simulation.actions.creating')}
                            </>
                        ) : (
                            <>
                                <CheckCircle className="w-4 h-4" />
                                {editMode ? t('simulation.actions.update') : t('simulation.actions.create')}
                            </>
                        )}
                    </Button>

                    <Button variant="destructive" onClick={actions.handleCancel} className="w-full cursor-pointer">
                        {t('simulation.actions.cancel')}
                    </Button>
                </div>

                <div className="mt-4 p-3 bg-muted dark:bg-gray-700 border border-border rounded-lg">
                    <div className="text-xs text-foreground">
                        {t('simulation.tip')}
                    </div>
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
                appliedTechKeys={appliedTechKeys}
            />
        </div>
    );
};
