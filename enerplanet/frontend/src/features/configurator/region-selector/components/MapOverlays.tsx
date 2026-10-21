import MapSearchBar from "@/features/interactive-map/MapSearchBar";
import { CopyrightFooter } from "@/components/app-layout/CopyrightFooter";
import { Building, CircuitBoard, Zap, Cable, Layers, Ruler, Calendar, Tag, Users, Home, Flame } from "lucide-react";
import { useEffect, useState, type FC, type ReactNode, type RefObject } from "react";
import { InfoIcon } from "@/components/ui/InfoTooltip";
import { useTranslation } from "@spatialhub/i18n";
import { useModelStore } from "@/features/configurator/store/modelStore";
import { formatFClassLabel } from "@/features/configurator/utils/fClassUtils";
import { getEnergyLabelColorClasses, normalizeEnergyLabel } from "@/features/configurator/utils/energyLabelUtils";

interface TooltipTransformer {
    x: number;
    y: number;
    ratedPowerKva: number;
    gridResultId: number;
    connectedBuildingCount?: number;
    connectedBuildingTypes?: string[];
}

interface TechData {
    alias: string;
    constraints: { key: string; value: number | string }[];
}

interface TooltipBuilding {
    disabled?: boolean;
    x: number;
    y: number;
    type: string;
    fClass?: string;
    fClasses?: string[];
    yearlyDemandKwh: number;
    yearlyHeatDemandKwh?: number;
    heatDemandEstimated?: boolean;
    techs?: Record<string, TechData>;
    gridResultId?: number;
    countryCode?: string;
    bagId?: string;
    floors3dBag?: number;
    floors?: number;
    heightMax?: number;
    heightMedian?: number;
    heightGround?: number;
    constructionYear?: number;
    energyLabel?: string;
    energyIndex?: number;
    labelDate?: string;
    cbsPopulation?: number;
    cbsHouseholds?: number;
    cbsAvgHouseholdSize?: number;
}

interface TooltipMvLine {
    x: number;
    y: number;
    voltage?: string;
    lengthM?: number;
    cableType?: string;
    normallyOpen?: boolean;
    fromBus?: string;
    toBus?: string;
}

interface MapOverlaysProps {
    /** Translation key of the drawing hint beside the cursor, or null for none. */
    drawHintKey?: string | null;
    /** Translation key of the warning shown beside the pointer when a modifier turns the click into a delete. */
    deleteHintKey?: string | null;
    /** The map element; the hints follow the pointer over it. */
    mapRef: RefObject<HTMLDivElement | null>;
    isDraggingTech?: boolean;
    isGeneratingGrid?: boolean;
    simulateEV?: boolean;
    gridIdToTrafoCapacity?: Record<number, number>;
    gridIdToPeakLoad?: Record<number, number>;
}

/**
 * A hint beside the pointer over the map. It keeps the pointer position in its
 * own state, so a mouse move re-renders only the hint.
 */
const CursorHint: FC<{ mapRef: RefObject<HTMLDivElement | null>; offsetY?: number; className: string; children: ReactNode }> = ({ mapRef, offsetY = 0, className, children }) => {
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
    useEffect(() => {
        const el = mapRef.current;
        if (!el) return;
        const onMove = (e: MouseEvent) => {
            const rect = el.getBoundingClientRect();
            setPos({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12 });
        };
        el.addEventListener("mousemove", onMove);
        return () => el.removeEventListener("mousemove", onMove);
    }, [mapRef]);
    if (!pos) return null;
    return (
        <div className={`absolute pointer-events-none ${className}`} style={{ left: pos.x, top: pos.y + offsetY }}>
            {children}
        </div>
    );
};

export const MapOverlays: FC<MapOverlaysProps> = ({
    drawHintKey = null,
    deleteHintKey = null,
    mapRef,
    isDraggingTech = false,
    isGeneratingGrid = false,
    simulateEV = false,
    gridIdToTrafoCapacity = {},
    gridIdToPeakLoad = {}
}) => {
    const { t } = useTranslation();
    const transformerTooltip: TooltipTransformer | null = useModelStore((s) => s.transformerTooltip);
    const buildingTooltip: TooltipBuilding | null = useModelStore((s) => s.buildingTooltip);
    const mvLineTooltip: TooltipMvLine | null = useModelStore((s) => s.mvLineTooltip);
    const techEntries = buildingTooltip?.techs ? Object.entries(buildingTooltip.techs) : [];
    const hasFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

    const getEvHostingCapacity = () => {
        if (!simulateEV || !buildingTooltip?.gridResultId) return null;

        const gridId = buildingTooltip.gridResultId;
        const trafoCapKva = gridIdToTrafoCapacity[gridId] || 0;
        const peakLoadKw = gridIdToPeakLoad[gridId] || 0;

        if (trafoCapKva === 0) return null;

        // Constants per paper methodology
        const CHARGER_POWER_KW = 11;  // Level 2 charger
        const SIMULTANEITY_FACTOR = 0.8;
        const POWER_FACTOR_GRID = 0.95;
        const POWER_FACTOR_EV = 0.99;  // EV chargers have near-unity power factor

        // Transformer Thermal Constraint (deterministic method)
        const currentLoadKva = peakLoadKw / POWER_FACTOR_GRID;
        const remainingKva = trafoCapKva - currentLoadKva;
        const utilizationPercent = (currentLoadKva / trafoCapKva) * 100;

        if (remainingKva <= 0) {
            return {
                count: 0,
                status: 'critical',
                label: t("tooltips.gridConstrained.title"),
                utilization: Math.round(utilizationPercent)
            };
        }

        const chargerKva = CHARGER_POWER_KW / POWER_FACTOR_EV;
        const effectiveLoad = chargerKva * SIMULTANEITY_FACTOR;

        const count = Math.floor(remainingKva / effectiveLoad);
        const projectedUtilization = ((currentLoadKva + count * effectiveLoad) / trafoCapKva) * 100;

        let status = 'safe';
        let label = t("simulation.mapOverlay.canHostChargers", { count });

        if (count === 0) {
            status = 'critical';
            label = t("tooltips.gridConstrained.title");
        } else if (count <= 2 || projectedUtilization >= 95) {
            status = 'warning';
            label = t("simulation.mapOverlay.limitedChargers", { count });
        }

        return {
            count,
            status,
            label,
            utilization: Math.round(utilizationPercent),
            projectedUtilization: Math.round(projectedUtilization)
        };
    };

    const evCapacity = getEvHostingCapacity();

    return (
        <>
            <MapSearchBar />

            {/* Grid Generation Loader - minimal floating pill at top center */}
            {isGeneratingGrid && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40">
                    <div className="md-rise flex items-center gap-3 bg-card/95 backdrop-blur-md border border-border/50 rounded-full px-5 py-2.5 shadow-lg">
                        {/* Spinning icon */}
                        <div className="relative w-5 h-5">
                            <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
                        </div>

                        {/* Text */}
                        <span className="text-sm font-medium text-foreground whitespace-nowrap">{t("simulation.mapOverlay.analyzingArea")}</span>

                        {/* Animated dots */}
                        <span className="flex items-center gap-0.5">
                            <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                    </div>
                </div>
            )}

            {drawHintKey && (
                <CursorHint mapRef={mapRef} className="z-20">
                    <div className="md-fade-in bg-background/90 dark:bg-gray-800/90 backdrop-blur-sm border border-border rounded px-2 py-1 shadow-sm text-xs text-foreground opacity-90">
                        {t(drawHintKey)}
                    </div>
                </CursorHint>
            )}

            {/* Above the pointer, clear of the feature tooltips, which are hidden meanwhile. */}
            {deleteHintKey && (
                <CursorHint mapRef={mapRef} offsetY={-48} className="z-30">
                    <div className="md-fade-in bg-red-600 text-white rounded px-2 py-1 shadow-md text-xs font-medium">
                        {t(deleteHintKey)}
                    </div>
                </CursorHint>
            )}

            {transformerTooltip && !deleteHintKey && (
                <div
                    className="absolute pointer-events-none z-30"
                    style={{
                        left: transformerTooltip.x + 15,
                        top: transformerTooltip.y - 10
                    }}
                >
                    <div className="md-fade-in bg-background/95 dark:bg-gray-800/95 backdrop-blur-sm border border-border rounded-md px-3 py-2 shadow-lg text-xs">
                        <div className="font-semibold text-foreground flex items-center gap-1.5">
                            <img src="/images/transformer-icon-dark.svg" alt="" className="w-4 h-4 dark:invert" />{" "}
                            {t("results.grid.transformer")}
                        </div>
                        <div className="text-muted-foreground mt-1">
                            <span className="font-medium text-foreground">{transformerTooltip.ratedPowerKva} kVA</span>
                            <span className="mx-1">•</span>
                            <span>20kV / 0.4kV</span>
                        </div>
                        {transformerTooltip.connectedBuildingCount !== undefined && transformerTooltip.connectedBuildingCount > 0 && (
                            <div className="mt-2 pt-2 border-t border-border">
                                <div className="flex items-center gap-1.5 text-muted-foreground">
                                    <Building className="w-3.5 h-3.5" />
                                    <span>{t("simulation.mapOverlay.connectedBuildings")}:</span>
                                    <span className="font-medium text-foreground">{transformerTooltip.connectedBuildingCount}</span>
                                </div>
                                {transformerTooltip.connectedBuildingTypes && transformerTooltip.connectedBuildingTypes.length > 0 && (
                                    <div className="mt-1 text-[10px] text-muted-foreground">
                                        {t("simulation.mapOverlay.types")}: {transformerTooltip.connectedBuildingTypes.slice(0, 3).map(formatFClassLabel).join(', ')}
                                        {transformerTooltip.connectedBuildingTypes.length > 3 && ` ${t("simulation.mapOverlay.moreCount", { count: transformerTooltip.connectedBuildingTypes.length - 3 })}`}
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="text-muted-foreground mt-1.5 text-[10px]">
                            {t("simulation.mapOverlay.clickForDetails")}
                        </div>
                    </div>
                </div>
            )}

            {buildingTooltip && !deleteHintKey && (
                <div
                    className="absolute pointer-events-none z-30"
                    style={{
                        left: buildingTooltip.x + 15,
                        top: buildingTooltip.y - 10
                    }}
                >
                    <div className="md-fade-in bg-background/95 dark:bg-gray-800/95 backdrop-blur-sm border border-border rounded-md px-3 py-2 shadow-lg text-xs">
                        <div className="font-semibold text-foreground flex items-center gap-1.5">
                            <Building className="w-3.5 h-3.5" />
                            {t("results.building")}
                            {buildingTooltip.disabled && (
                                <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    {t("simulation.mapOverlay.disabled")}
                                </span>
                            )}
                        </div>
                        <div className="text-muted-foreground mt-1">
                            <span className="font-medium text-foreground">{formatFClassLabel(buildingTooltip.type)}</span>
                        </div>
                        {(buildingTooltip.fClasses?.length || buildingTooltip.fClass) && (
                            <div className="text-muted-foreground mt-0.5">
                                {t("simulation.mapOverlay.class")}:{' '}
                                <span className="font-medium text-foreground">
                                    {(buildingTooltip.fClasses && buildingTooltip.fClasses.length > 0
                                        ? buildingTooltip.fClasses
                                        : buildingTooltip.fClass
                                            ? [buildingTooltip.fClass]
                                            : []
                                    ).map(formatFClassLabel).join(', ')}
                                </span>
                            </div>
                        )}
                        <div className="text-muted-foreground mt-0.5 flex items-center gap-1">
                            <Zap className="w-3 h-3 text-sky-500" />
                            {buildingTooltip.yearlyDemandKwh.toLocaleString()} kWh/yr
                        </div>
                        {buildingTooltip.yearlyHeatDemandKwh != null && buildingTooltip.yearlyHeatDemandKwh > 0 && (
                            <div className="text-muted-foreground mt-0.5 flex items-center gap-1">
                                <Flame className="w-3 h-3 text-orange-500" />
                                {buildingTooltip.yearlyHeatDemandKwh.toLocaleString()} kWh/yr
                                {buildingTooltip.heatDemandEstimated && (
                                    <span className="text-[9px] px-1 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium">
                                        {t("simulation.mapOverlay.estimatedShort")}
                                    </span>
                                )}
                            </div>
                        )}
                        {(buildingTooltip.floors3dBag || buildingTooltip.floors || hasFiniteNumber(buildingTooltip.heightMax) || hasFiniteNumber(buildingTooltip.heightMedian) || hasFiniteNumber(buildingTooltip.heightGround) || buildingTooltip.constructionYear || buildingTooltip.energyLabel || hasFiniteNumber(buildingTooltip.energyIndex) || buildingTooltip.labelDate || buildingTooltip.bagId || hasFiniteNumber(buildingTooltip.cbsPopulation) || hasFiniteNumber(buildingTooltip.cbsHouseholds) || hasFiniteNumber(buildingTooltip.cbsAvgHouseholdSize)) && (
                            <div className="mt-2 pt-2 border-t border-border space-y-0.5 text-[10px] text-muted-foreground">
                                <div className="font-semibold text-foreground/90 flex items-center gap-1.5">
                                    <span>{buildingTooltip.countryCode === 'NL' ? '3D BAG / EP / CBS' : buildingTooltip.countryCode === 'CZ' ? 'CUZK LiDAR / EUBUCCO' : 'EUBUCCO'}</span>
                                    <span className="pointer-events-auto inline-flex scale-90">
                                        <InfoIcon tooltipKey="buildingEnrichment" position="top" />
                                    </span>
                                </div>
                                {(buildingTooltip.floors3dBag || buildingTooltip.floors) && (
                                    <div className="flex items-center gap-1.5">
                                        <Layers className="w-3 h-3" />
                                        <span>{t("simulation.mapOverlay.floors")}:</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.floors3dBag || buildingTooltip.floors}</span>
                                    </div>
                                )}
                                {hasFiniteNumber(buildingTooltip.heightMax) && (
                                    <div className="flex items-center gap-1.5">
                                        <Ruler className="w-3 h-3" />
                                        <span>{t("simulation.mapOverlay.height")}:</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.heightMax.toFixed(1)} m</span>
                                    </div>
                                )}
                                {!hasFiniteNumber(buildingTooltip.heightMax) && hasFiniteNumber(buildingTooltip.heightMedian) && (
                                    <div className="flex items-center gap-1.5">
                                        <Ruler className="w-3 h-3" />
                                        <span>{t("simulation.mapOverlay.heightMedian")}:</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.heightMedian.toFixed(1)} m</span>
                                    </div>
                                )}
                                {buildingTooltip.constructionYear && (
                                    <div className="flex items-center gap-1.5">
                                        <Calendar className="w-3 h-3" />
                                        <span>{t("simulation.mapOverlay.built")}:</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.constructionYear}</span>
                                    </div>
                                )}
                                {buildingTooltip.countryCode === 'NL' && (buildingTooltip.energyLabel || hasFiniteNumber(buildingTooltip.energyIndex) || buildingTooltip.labelDate) && (
                                    <div className="flex items-center gap-1.5">
                                        <Tag className="w-3 h-3" />
                                        <span className="inline-flex items-center gap-1">
                                            {t("simulation.mapOverlay.label")}:
                                            <span className="pointer-events-auto inline-flex scale-75">
                                                <InfoIcon tooltipKey="energyLabel" position="top" />
                                            </span>
                                        </span>
                                        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${buildingTooltip.energyLabel ? getEnergyLabelColorClasses(buildingTooltip.energyLabel) : 'bg-muted text-muted-foreground border-border'}`}>
                                            {buildingTooltip.energyLabel ? normalizeEnergyLabel(buildingTooltip.energyLabel) : t("common.na")}
                                        </span>
                                        {hasFiniteNumber(buildingTooltip.energyIndex) && (
                                            <span className="text-muted-foreground">(EI {buildingTooltip.energyIndex.toFixed(2)})</span>
                                        )}
                                    </div>
                                )}
                                {buildingTooltip.countryCode === 'NL' && !buildingTooltip.energyLabel && hasFiniteNumber(buildingTooltip.energyIndex) && (
                                    <div className="flex items-center gap-1.5">
                                        <Tag className="w-3 h-3" />
                                        <span>{t("simulation.mapOverlay.energyIndex")}:</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.energyIndex.toFixed(2)}</span>
                                    </div>
                                )}
                                {buildingTooltip.countryCode === 'NL' && buildingTooltip.labelDate && (
                                    <div className="flex items-center gap-1.5">
                                        <Calendar className="w-3 h-3" />
                                        <span>{t("simulation.mapOverlay.labelDate")}:</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.labelDate}</span>
                                    </div>
                                )}
                                {buildingTooltip.countryCode === 'NL' && hasFiniteNumber(buildingTooltip.cbsPopulation) && (
                                    <div className="flex items-center gap-1.5">
                                        <Users className="w-3 h-3" />
                                        <span>{t("simulation.mapOverlay.population")} (PC6/PC4):</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.cbsPopulation.toLocaleString()}</span>
                                    </div>
                                )}
                                {buildingTooltip.countryCode === 'NL' && hasFiniteNumber(buildingTooltip.cbsHouseholds) && (
                                    <div className="flex items-center gap-1.5">
                                        <Home className="w-3 h-3" />
                                        <span>{t("simulation.mapOverlay.households")} (PC6/PC4):</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.cbsHouseholds.toLocaleString()}</span>
                                    </div>
                                )}
                                {buildingTooltip.countryCode === 'NL' && hasFiniteNumber(buildingTooltip.cbsAvgHouseholdSize) && (
                                    <div className="flex items-center gap-1.5">
                                        <span>{t("simulation.mapOverlay.avgHouseholdSize")} (PC6/PC4):</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.cbsAvgHouseholdSize.toFixed(2)}</span>
                                    </div>
                                )}
                                {buildingTooltip.countryCode === 'NL' && buildingTooltip.bagId && (
                                    <div className="truncate">
                                        BAG ID: <span className="font-mono text-foreground">{buildingTooltip.bagId}</span>
                                    </div>
                                )}
                                {buildingTooltip.countryCode === 'NL' && (hasFiniteNumber(buildingTooltip.cbsPopulation) || hasFiniteNumber(buildingTooltip.cbsHouseholds) || hasFiniteNumber(buildingTooltip.cbsAvgHouseholdSize)) && (
                                    <div className="text-[9px] text-muted-foreground/90 pt-0.5">
                                        {t("simulation.mapOverlay.cbsNote")}
                                    </div>
                                )}
                                {buildingTooltip.countryCode && buildingTooltip.countryCode !== 'NL' && (
                                    <div className="text-[9px] text-muted-foreground/90 pt-0.5">
                                        {t("simulation.mapOverlay.source", { source: "EUBUCCO v0.1 (CC BY 4.0)" })}
                                    </div>
                                )}
                                {buildingTooltip.countryCode === 'NL' && (buildingTooltip.energyLabel || hasFiniteNumber(buildingTooltip.cbsPopulation) || hasFiniteNumber(buildingTooltip.cbsHouseholds) || hasFiniteNumber(buildingTooltip.cbsAvgHouseholdSize)) && (
                                    <div className="text-[9px] text-muted-foreground/90 pt-0.5">
                                        {t("simulation.mapOverlay.sourcesNl", { epOnline: "EP-Online", cbs: "CBS Open Data (CC BY 4.0)" })}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* EV Hosting Capacity Badge */}
                        {simulateEV && evCapacity && (
                            <div className={`mt-2 px-2 py-1 rounded border text-[10px] font-medium flex items-center justify-between ${
                                (() => {
                                    if (evCapacity.status === 'safe') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800';
                                    if (evCapacity.status === 'warning') return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800';
                                    return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800';
                                })()
                            }`}>
                                <div className="flex items-center gap-1.5">
                                    <Zap className="w-3 h-3" />
                                    <span>{evCapacity.label}</span>
                                    {evCapacity.status === 'critical' && (
                                        <span className="pointer-events-auto">
                                            <InfoIcon tooltipKey="gridConstrained" position="top" />
                                        </span>
                                    )}
                                </div>
                                {evCapacity.status === 'safe' && <span className="text-[9px] opacity-80">(11kW)</span>}
                            </div>
                        )}

                        {/* Show technologies if present */}
                        {techEntries.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-border">
                                <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                                    <CircuitBoard className="w-3 h-3" />
                                    {t("simulation.mapOverlay.technologiesCount", { count: techEntries.length })}
                                </div>
                                <div className="flex flex-col gap-0.5">
                                    {techEntries.map(([key, tech]) => (
                                        <div
                                            key={key}
                                            className="flex items-center gap-1.5 text-[10px]"
                                        >
                                            <span className="w-4 h-4 rounded-full bg-foreground flex items-center justify-center flex-shrink-0">
                                                <span className="text-[8px] font-bold text-background leading-none">{tech.alias.charAt(0).toUpperCase()}</span>
                                            </span>
                                            <span className="text-foreground">{tech.alias}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="text-muted-foreground mt-1.5 text-[10px]">
                            {isDraggingTech ? t("simulation.mapOverlay.dropToAddTech") : t("simulation.mapOverlay.clickToEdit")}
                        </div>
                    </div>
                </div>
            )}

            {mvLineTooltip && !deleteHintKey && (
                <div
                    className="absolute pointer-events-none z-30"
                    style={{
                        left: mvLineTooltip.x + 15,
                        top: mvLineTooltip.y - 10
                    }}
                >
                    <div className="bg-background/95 dark:bg-gray-800/95 backdrop-blur-sm border border-orange-400/50 rounded-md px-3 py-2 shadow-lg text-xs">
                        <div className="font-semibold text-foreground flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5 text-orange-500" />
                            <span className="text-orange-600 dark:text-orange-400">{t("simulation.mapOverlay.mvLine")}</span>
                            {mvLineTooltip.normallyOpen && (
                                <span className="ml-1 px-1.5 py-0.5 text-[9px] bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded">
                                    {t("simulation.mapOverlay.normallyOpen")}
                                </span>
                            )}
                        </div>
                        <div className="text-muted-foreground mt-1.5 space-y-0.5">
                            <div className="flex items-center gap-2">
                                <Cable className="w-3 h-3 text-orange-400" />
                                <span className="font-medium text-foreground">{mvLineTooltip.voltage || '20 kV'}</span>
                            </div>
                            {mvLineTooltip.lengthM !== undefined && mvLineTooltip.lengthM > 0 && (
                                <div>
                                    {t("simulation.mapOverlay.length")}: <span className="font-medium text-foreground">{mvLineTooltip.lengthM.toFixed(1)} m</span>
                                </div>
                            )}
                            {mvLineTooltip.cableType && (
                                <div>
                                    {t("simulation.mapOverlay.type")}: <span className="font-medium text-foreground">{mvLineTooltip.cableType}</span>
                                </div>
                            )}
                        </div>
                        {(mvLineTooltip.fromBus || mvLineTooltip.toBus) && (
                            <div className="mt-2 pt-2 border-t border-orange-200 dark:border-orange-800/50 text-[10px]">
                                <div className="flex items-center gap-1 text-muted-foreground">
                                    <span className="w-2 h-2 rounded-full bg-green-500"></span>{" "}
                                    {t("common.from")}: <span className="text-foreground">{mvLineTooltip.fromBus || t("simulation.mapOverlay.bus")}</span>
                                </div>
                                <div className="flex items-center gap-1 text-muted-foreground mt-0.5">
                                    <span className="w-2 h-2 rounded-full bg-red-500"></span>{" "}
                                    {t("common.to")}: <span className="text-foreground">{mvLineTooltip.toBus || t("simulation.mapOverlay.bus")}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <CopyrightFooter position="bottom-left-sidebar" />
        </>
    );
};
