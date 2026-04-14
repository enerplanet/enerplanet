import { useState, useEffect, type FC } from "react";
import { Building2, Zap, Cable, Activity, Euro, Loader2, Info } from "lucide-react";
import { pylovoService, type GridStatistics } from "@/features/configurator/services/pylovoService";
import { cn } from "@/lib/utils";
import { useTranslation } from "@spatialhub/i18n";
import { Tooltip, TooltipTrigger, TooltipContent } from "@spatialhub/ui";

interface GridStatsBadgeProps {
    gridResultIds: number[];
    buildingsCount?: number;
    peakLoadKw?: number;
    className?: string;
}

export const GridStatsBadge: FC<GridStatsBadgeProps> = ({ gridResultIds, className }) => {
    const { t } = useTranslation();
    const [statistics, setStatistics] = useState<GridStatistics | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (gridResultIds.length === 0) {
            setStatistics(null);
            return;
        }

        const fetchStatistics = async () => {
            setLoading(true);
            try {
                const stats = await pylovoService.getGridStatistics(gridResultIds);
                setStatistics(stats);
            } catch (err) {
                console.error("Failed to load grid statistics:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchStatistics();
    }, [gridResultIds]);

    if (loading) {
        return (
            <div className={cn("flex items-center justify-center p-3 rounded-lg bg-muted/50 border border-border", className)}>
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                <span className="ml-2 text-xs text-muted-foreground">{t("gridStats.analyzing")}</span>
            </div>
        );
    }

    if (!statistics) {
        return null;
    }

    const utilizationPercent = statistics.transformers?.utilization_percent ?? 0;
    const buildingsCountValue = statistics.buildings?.count ?? 0;
    const peakLoadKwValue = statistics.buildings?.total_peak_load_kw ?? 0;
    const simultaneousLoadKwValue = statistics.buildings?.simultaneous_load_kw ?? 0;

    return (
        <div className={cn("rounded-lg border border-border bg-card overflow-hidden", className)}>
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs font-semibold text-foreground">{t("gridStats.title")}</span>
                <span className="text-[10px] text-foreground/70 font-medium px-1.5 py-0.5 bg-muted rounded ml-auto">
                    {gridResultIds.length} {t("gridStats.clusters", { count: gridResultIds.length })}
                </span>
            </div>

            {/* Main stats grid */}
            <div className="grid grid-cols-4 gap-1 p-2">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex flex-col items-center py-2 rounded bg-muted/30 cursor-help">
                            <Building2 className="w-3.5 h-3.5 mb-1 text-black dark:text-white" />
                            <span className="text-sm font-bold text-foreground">{buildingsCountValue}</span>
                            <span className="text-[9px] text-muted-foreground">{t("gridStats.buildings")}</span>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                        <p className="text-xs">Total buildings detected from OpenStreetMap within the selected area. Each building's energy demand is estimated by PyLoVo using area, floors, household size, and energy label.</p>
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex flex-col items-center py-2 rounded bg-muted/30 cursor-help">
                            <Zap className="w-3.5 h-3.5 mb-1 text-black dark:text-white" />
                            <span className="text-sm font-bold text-foreground">{statistics.transformers?.count ?? 0}</span>
                            <span className="text-[9px] text-muted-foreground">{t("gridStats.trafos")}</span>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                        <p className="text-xs">Transformers sized by PyLoVo to handle the simultaneous load. Standard sizes (100–630 kVA) are selected from German equipment catalogs. Cost is looked up per size from installed equipment prices.</p>
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex flex-col items-center py-2 rounded bg-muted/30 cursor-help">
                            <Cable className="w-3.5 h-3.5 mb-1 text-black dark:text-white" />
                            <span className="text-sm font-bold text-foreground">{statistics.cables?.count ?? 0}</span>
                            <span className="text-[9px] text-muted-foreground">{t("gridStats.cables")}</span>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                        <p className="text-xs">LV distribution cables routed by PyLoVo between buildings and transformers. Cost = length (m) × cost per meter (€/m) from the equipment catalog, varying by cable type.</p>
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex flex-col items-center py-2 rounded bg-muted/30 cursor-help">
                            <Activity className="w-3.5 h-3.5 mb-1 text-black dark:text-white" />
                            <span className="text-sm font-bold text-foreground">{(statistics.cables?.total_length_km ?? 0).toFixed(1)}</span>
                            <span className="text-[9px] text-muted-foreground">km</span>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                        <p className="text-xs">Total length of all LV cables in the grid. Routing is based on shortest-path between building connection points and transformer positions.</p>
                    </TooltipContent>
                </Tooltip>
            </div>

            {/* Load & Utilization */}
            <div className="px-3 py-2 space-y-2 border-t border-border">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex items-center justify-between text-xs cursor-help">
                            <span className="text-muted-foreground flex items-center gap-1">
                                {t("gridStats.peakLoad")}
                                <Info className="w-3 h-3 text-muted-foreground/60" />
                            </span>
                            <span className="font-medium text-foreground">
                                {peakLoadKwValue.toFixed(1)} kW
                            </span>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-xs">
                        <p className="text-xs">Sum of all building peak electrical loads (kW). Derived from each building's estimated annual demand using standard load profiles (VDI 3807 / DIN 18599).</p>
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex items-center justify-between text-xs cursor-help">
                            <span className="text-muted-foreground flex items-center gap-1">
                                Simult. Load
                                <Info className="w-3 h-3 text-muted-foreground/60" />
                            </span>
                            <span className="font-medium text-foreground">
                                {simultaneousLoadKwValue.toFixed(1)} kW
                            </span>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-xs">
                        <p className="text-xs">Realistic concurrent load using a simultaneity factor: <span className="font-mono">SF = 0.07 + 0.93 × n^(−0.75)</span> where n = number of buildings. Accounts for the fact that not all buildings draw peak load at the same time.</p>
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex items-center justify-between text-xs cursor-help">
                            <span className="text-muted-foreground flex items-center gap-1">
                                {t("gridStats.capacity")}
                                <Info className="w-3 h-3 text-muted-foreground/60" />
                            </span>
                            <span className="font-medium text-foreground">
                                {(statistics.transformers?.total_capacity_kva ?? 0).toFixed(0)} kVA
                            </span>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-xs">
                        <p className="text-xs">Total rated power of all transformers (kVA). Transformers are selected from standard German LV sizes to cover the simultaneous load with a safety margin.</p>
                    </TooltipContent>
                </Tooltip>
                
                {/* Utilization bar */}
                <div className="space-y-1">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className="flex items-center justify-between text-xs cursor-help">
                                <span className="text-muted-foreground flex items-center gap-1">
                                    {t("gridStats.utilization")}
                                    <Info className="w-3 h-3 text-muted-foreground/60" />
                                </span>
                                <span className="font-semibold text-black dark:text-white">
                                    {utilizationPercent.toFixed(1)}%
                                </span>
                            </div>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-xs">
                            <p className="text-xs">Transformer utilization = Simultaneous Load ÷ Total Capacity × 100%. Values above 80% may indicate the need for additional transformer capacity.</p>
                        </TooltipContent>
                    </Tooltip>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all bg-black dark:bg-white"
                            style={{ width: `${Math.min(utilizationPercent, 100)}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Cost estimate - highlighted */}
            <div className="px-3 py-2.5 bg-muted/30 border-t border-border space-y-1.5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <Euro className="w-3.5 h-3.5 text-black dark:text-white" />
                        <span className="text-xs font-medium text-foreground">{t("gridStats.estCost")}</span>
                    </div>
                    <span className="text-sm font-bold text-foreground">
                        €{(statistics.costs?.total_estimated_cost_eur ?? 0).toLocaleString()}
                    </span>
                </div>
                {/* Cost breakdown */}
                <div className="flex items-center justify-between text-[10px] text-foreground pt-1">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="flex items-center gap-1 cursor-help">
                                <Cable className="w-2.5 h-2.5" />
                                {t("gridStats.cablesLabel")}: €{(statistics.costs?.cable_cost_eur ?? 0).toLocaleString()}
                            </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs">
                            <p className="text-xs">Cable installation cost based on cable type and length. Prices from German LV equipment catalogs include material, trenching, and installation (€/m).</p>
                        </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="flex items-center gap-1 cursor-help">
                                <Zap className="w-2.5 h-2.5" />
                                {t("gridStats.trafosLabel")}: €{(statistics.costs?.transformer_cost_eur ?? 0).toLocaleString()}
                            </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs">
                            <p className="text-xs">Transformer procurement and installation cost. Prices per kVA size from German distribution equipment catalogs with nearest-size matching.</p>
                        </TooltipContent>
                    </Tooltip>
                </div>
                <p className="text-[9px] text-muted-foreground pt-0.5 flex items-center gap-1">
                    <Info className="w-3 h-3 shrink-0" />
                    Estimated by PyLoVo grid engine. Costs from German LV equipment catalogs. Utilization based on simultaneous load.
                </p>
            </div>
        </div>
    );
};
