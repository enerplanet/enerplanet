import MapSearchBar from "@/features/interactive-map/MapSearchBar";
import { CopyrightFooter } from "@/components/app-layout/CopyrightFooter";
import { Building, CircuitBoard, Zap, Cable, Layers, Ruler, Calendar, Tag, Users, Home } from "lucide-react";
import type { FC } from "react";
import { InfoIcon } from "@/components/ui/InfoTooltip";
import { useTranslation } from "@spatialhub/i18n";
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
    x: number;
    y: number;
    type: string;
    fClass?: string;
    fClasses?: string[];
    yearlyDemandKwh: number;
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
    showDrawHint: boolean;
    cursorPos: { x: number; y: number } | null;
    transformerTooltip: TooltipTransformer | null;
    buildingTooltip: TooltipBuilding | null;
    mvLineTooltip?: TooltipMvLine | null;
    isDraggingTech?: boolean;
    isGeneratingGrid?: boolean;
    simulateEV?: boolean;
    gridIdToTrafoCapacity?: Record<number, number>;
    gridIdToPeakLoad?: Record<number, number>;
}

export const MapOverlays: FC<MapOverlaysProps> = ({
    showDrawHint,
    cursorPos,
    transformerTooltip,
    buildingTooltip,
    mvLineTooltip,
    isDraggingTech = false,
    isGeneratingGrid = false,
    simulateEV = false,
    gridIdToTrafoCapacity = {},
    gridIdToPeakLoad = {}
}) => {
    const { t } = useTranslation();
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
                label: 'Grid Constrained',
                utilization: Math.round(utilizationPercent)
            };
        }

        const chargerKva = CHARGER_POWER_KW / POWER_FACTOR_EV;
        const effectiveLoad = chargerKva * SIMULTANEITY_FACTOR;

        const count = Math.floor(remainingKva / effectiveLoad);
        const projectedUtilization = ((currentLoadKva + count * effectiveLoad) / trafoCapKva) * 100;

        let status = 'safe';
        let label = `Can host ${count} Chargers`;

        if (count === 0) {
            status = 'critical';
            label = 'Grid Constrained';
        } else if (count <= 2 || projectedUtilization >= 95) {
            status = 'warning';
            label = `Limited: ${count} Chargers`;
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
                    <div className="flex items-center gap-3 bg-card/95 backdrop-blur-md border border-border/50 rounded-full px-5 py-2.5 shadow-lg">
                        {/* Spinning icon */}
                        <div className="relative w-5 h-5">
                            <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
                        </div>

                        {/* Text */}
                        <span className="text-sm font-medium text-foreground whitespace-nowrap">Analyzing area</span>

                        {/* Animated dots */}
                        <span className="flex items-center gap-0.5">
                            <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                    </div>
                </div>
            )}

            {showDrawHint && cursorPos && (
                <div
                    className="absolute pointer-events-none z-20"
                    style={{ left: cursorPos.x, top: cursorPos.y }}
                >
                    <div className="bg-background/90 dark:bg-gray-800/90 backdrop-blur-sm border border-border rounded px-2 py-1 shadow-sm text-xs text-foreground opacity-90">
                        {t("drawing.clickToDraw")}
                    </div>
                </div>
            )}

            {transformerTooltip && (
                <div
                    className="absolute pointer-events-none z-30"
                    style={{
                        // Fixed position at top-left to avoid overlapping map features and bottom controls
                        left: 16,
                        top: 16
                    }}
                >
                    <div className="bg-background/95 dark:bg-gray-800/95 backdrop-blur-sm border border-border rounded-md px-3 py-2 shadow-lg text-xs">
                        <div className="font-semibold text-foreground flex items-center gap-1.5">
                            <img src="/images/transformer-icon-dark.svg" alt="" className="w-4 h-4 dark:invert" />{" "}
                            Transformer
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
                                    <span className="font-medium text-foreground">{transformerTooltip.connectedBuildingCount}</span>
                                    <span>connected building{transformerTooltip.connectedBuildingCount === 1 ? '' : 's'}</span>
                                </div>
                                {transformerTooltip.connectedBuildingTypes && transformerTooltip.connectedBuildingTypes.length > 0 && (
                                    <div className="mt-1 text-[10px] text-muted-foreground">
                                        Types: {transformerTooltip.connectedBuildingTypes.slice(0, 3).map(formatFClassLabel).join(', ')}
                                        {transformerTooltip.connectedBuildingTypes.length > 3 && ` +${transformerTooltip.connectedBuildingTypes.length - 3} more`}
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="text-muted-foreground mt-1.5 text-[10px]">
                            Click for more details
                        </div>
                    </div>
                </div>
            )}

            {buildingTooltip && (
                <div
                    className="absolute pointer-events-none z-30"
                    style={{
                        left: buildingTooltip.x + 15,
                        top: buildingTooltip.y - 10
                    }}
                >
                    <div className="bg-background/95 dark:bg-gray-800/95 backdrop-blur-sm border border-border rounded-md px-3 py-2 shadow-lg text-xs">
                        <div className="font-semibold text-foreground flex items-center gap-1.5">
                            <Building className="w-3.5 h-3.5" />
                            Building
                        </div>
                        <div className="text-muted-foreground mt-1">
                            <span className="font-medium text-foreground">{formatFClassLabel(buildingTooltip.type)}</span>
                        </div>
                        {(buildingTooltip.fClasses?.length || buildingTooltip.fClass) && (
                            <div className="text-muted-foreground mt-0.5">
                                Class:{' '}
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
                        <div className="text-muted-foreground mt-0.5">
                            {buildingTooltip.yearlyDemandKwh.toLocaleString()} kWh/yr
                        </div>
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
                                        <span>Floors:</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.floors3dBag || buildingTooltip.floors}</span>
                                    </div>
                                )}
                                {hasFiniteNumber(buildingTooltip.heightMax) && (
                                    <div className="flex items-center gap-1.5">
                                        <Ruler className="w-3 h-3" />
                                        <span>Height:</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.heightMax.toFixed(1)} m</span>
                                    </div>
                                )}
                                {!hasFiniteNumber(buildingTooltip.heightMax) && hasFiniteNumber(buildingTooltip.heightMedian) && (
                                    <div className="flex items-center gap-1.5">
                                        <Ruler className="w-3 h-3" />
                                        <span>Height (median):</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.heightMedian.toFixed(1)} m</span>
                                    </div>
                                )}
                                {buildingTooltip.constructionYear && (
                                    <div className="flex items-center gap-1.5">
                                        <Calendar className="w-3 h-3" />
                                        <span>Built:</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.constructionYear}</span>
                                    </div>
                                )}
                                {buildingTooltip.countryCode === 'NL' && (buildingTooltip.energyLabel || hasFiniteNumber(buildingTooltip.energyIndex) || buildingTooltip.labelDate) && (
                                    <div className="flex items-center gap-1.5">
                                        <Tag className="w-3 h-3" />
                                        <span className="inline-flex items-center gap-1">
                                            Label:
                                            <span className="pointer-events-auto inline-flex scale-75">
                                                <InfoIcon tooltipKey="energyLabel" position="top" />
                                            </span>
                                        </span>
                                        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${buildingTooltip.energyLabel ? getEnergyLabelColorClasses(buildingTooltip.energyLabel) : 'bg-muted text-muted-foreground border-border'}`}>
                                            {buildingTooltip.energyLabel ? normalizeEnergyLabel(buildingTooltip.energyLabel) : 'N/A'}
                                        </span>
                                        {hasFiniteNumber(buildingTooltip.energyIndex) && (
                                            <span className="text-muted-foreground">(EI {buildingTooltip.energyIndex.toFixed(2)})</span>
                                        )}
                                    </div>
                                )}
                                {buildingTooltip.countryCode === 'NL' && !buildingTooltip.energyLabel && hasFiniteNumber(buildingTooltip.energyIndex) && (
                                    <div className="flex items-center gap-1.5">
                                        <Tag className="w-3 h-3" />
                                        <span>Energy Index:</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.energyIndex.toFixed(2)}</span>
                                    </div>
                                )}
                                {buildingTooltip.countryCode === 'NL' && buildingTooltip.labelDate && (
                                    <div className="flex items-center gap-1.5">
                                        <Calendar className="w-3 h-3" />
                                        <span>Label date:</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.labelDate}</span>
                                    </div>
                                )}
                                {buildingTooltip.countryCode === 'NL' && hasFiniteNumber(buildingTooltip.cbsPopulation) && (
                                    <div className="flex items-center gap-1.5">
                                        <Users className="w-3 h-3" />
                                        <span>Population (PC6/PC4):</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.cbsPopulation.toLocaleString()}</span>
                                    </div>
                                )}
                                {buildingTooltip.countryCode === 'NL' && hasFiniteNumber(buildingTooltip.cbsHouseholds) && (
                                    <div className="flex items-center gap-1.5">
                                        <Home className="w-3 h-3" />
                                        <span>Households (PC6/PC4):</span>
                                        <span className="font-medium text-foreground">{buildingTooltip.cbsHouseholds.toLocaleString()}</span>
                                    </div>
                                )}
                                {buildingTooltip.countryCode === 'NL' && hasFiniteNumber(buildingTooltip.cbsAvgHouseholdSize) && (
                                    <div className="flex items-center gap-1.5">
                                        <span>Avg household size (PC6/PC4):</span>
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
                                        CBS values are postcode-area statistics (PC6 preferred, PC4 fallback), not single-building values.
                                    </div>
                                )}
                                {buildingTooltip.countryCode && buildingTooltip.countryCode !== 'NL' && (
                                    <div className="text-[9px] text-muted-foreground/90 pt-0.5">
                                        Source: EUBUCCO v0.1 (CC BY 4.0).
                                    </div>
                                )}
                                {buildingTooltip.countryCode === 'NL' && (buildingTooltip.energyLabel || hasFiniteNumber(buildingTooltip.cbsPopulation) || hasFiniteNumber(buildingTooltip.cbsHouseholds) || hasFiniteNumber(buildingTooltip.cbsAvgHouseholdSize)) && (
                                    <div className="text-[9px] text-muted-foreground/90 pt-0.5">
                                        Sources: EP-Online (terms apply) and CBS Open Data (CC BY 4.0).
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
                                    Technologies ({techEntries.length})
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
                            {isDraggingTech ? "Drop to add technology" : "Click to edit details"}
                        </div>
                    </div>
                </div>
            )}

            {mvLineTooltip && (
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
                            <span className="text-orange-600 dark:text-orange-400">MV Line</span>
                            {mvLineTooltip.normallyOpen && (
                                <span className="ml-1 px-1.5 py-0.5 text-[9px] bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded">
                                    Normally Open
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
                                    Length: <span className="font-medium text-foreground">{mvLineTooltip.lengthM.toFixed(1)} m</span>
                                </div>
                            )}
                            {mvLineTooltip.cableType && (
                                <div>
                                    Type: <span className="font-medium text-foreground">{mvLineTooltip.cableType}</span>
                                </div>
                            )}
                        </div>
                        {(mvLineTooltip.fromBus || mvLineTooltip.toBus) && (
                            <div className="mt-2 pt-2 border-t border-orange-200 dark:border-orange-800/50 text-[10px]">
                                <div className="flex items-center gap-1 text-muted-foreground">
                                    <span className="w-2 h-2 rounded-full bg-green-500"></span>{" "}
                                    From: <span className="text-foreground">{mvLineTooltip.fromBus || 'Bus'}</span>
                                </div>
                                <div className="flex items-center gap-1 text-muted-foreground mt-0.5">
                                    <span className="w-2 h-2 rounded-full bg-red-500"></span>{" "}
                                    To: <span className="text-foreground">{mvLineTooltip.toBus || 'Bus'}</span>
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
