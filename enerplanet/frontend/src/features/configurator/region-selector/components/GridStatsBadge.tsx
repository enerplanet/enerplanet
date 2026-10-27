import { useState, useEffect, type FC } from "react";
import { Building2, Zap, Cable, Activity, Loader2, Info, ChevronDown } from "lucide-react";
import { pylovoService, siteScope, type GridStatistics } from "@/features/configurator/services/pylovoService";
import { useModelStore } from "@/features/configurator/store/modelStore";
import { cn } from "@/lib/utils";
import { useTranslation } from "@spatialhub/i18n";
import { Tooltip, TooltipTrigger, TooltipContent } from "@spatialhub/ui";

interface GridStatsBadgeProps {
    gridResultIds: number[];
    /** Selected buildings; the figures are scoped to them when given. */
    buildingOsmIds?: string[];
    buildingsCount?: number;
    peakLoadKw?: number;
    className?: string;
}

export const GridStatsBadge: FC<GridStatsBadgeProps> = ({ gridResultIds, buildingOsmIds, className }) => {
    const { t } = useTranslation();
    const [statistics, setStatistics] = useState<GridStatistics | null>(null);
    const [loading, setLoading] = useState(false);
    // Open on every visit: the building and transformer counts matter most on large models.
    const [collapsed, setCollapsed] = useState(false);
    const toggleCollapsed = () => setCollapsed(!collapsed);
    // Joined so a new array with the same ids does not refetch.
    const selectionKey = buildingOsmIds?.join(",") ?? "";
    const site = siteScope(useModelStore((s) => s.pylovoGridData));
    const siteId = site?.site_id;
    const siteRevision = site?.revision;

    useEffect(() => {
        if (gridResultIds.length === 0) {
            setStatistics(null);
            return;
        }

        const fetchStatistics = async () => {
            setLoading(true);
            try {
                const stats = await pylovoService.getGridStatistics(
                    gridResultIds,
                    selectionKey ? selectionKey.split(",") : undefined,
                    siteId && siteRevision ? { site_id: siteId, revision: siteRevision } : undefined
                );
                setStatistics(stats);
            } catch (err) {
                console.error("Failed to load grid statistics:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchStatistics();
    }, [gridResultIds, selectionKey, siteId, siteRevision]);

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

    const buildingsCountValue = statistics.buildings?.count ?? 0;
    const wholeGrid = statistics.whole_grid;

    return (
        <div className={cn("rounded-lg border border-border bg-card overflow-hidden", className)}>
            <button
                type="button"
                onClick={toggleCollapsed}
                aria-expanded={!collapsed}
                className={cn("flex w-full cursor-pointer items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/60", !collapsed && "border-b border-border")}
            >
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs font-semibold text-foreground">{t("gridStats.title")}</span>
                <span className="text-[10px] text-foreground/70 font-medium px-1.5 py-0.5 bg-muted rounded ml-auto">
                    {gridResultIds.length} {t("gridStats.clusters", { count: gridResultIds.length })}
                </span>
                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", collapsed && "-rotate-90")} aria-hidden="true" />
            </button>

            {!collapsed && (<>

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
                        <p className="text-xs">{t("gridStats.buildingsTooltip")}</p>
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
                        <p className="text-xs">{t("gridStats.trafosTooltip")}</p>
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
                        <p className="text-xs">{t("gridStats.cablesTooltip")}</p>
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
                        <p className="text-xs">{t("gridStats.lengthTooltip")}</p>
                    </TooltipContent>
                </Tooltip>
            </div>

            {wholeGrid && (
                <p className="hidden px-3 pb-2 text-[10px] text-muted-foreground xl:block">
                    {t("gridStats.selectionNote", {
                        buildings: wholeGrid.buildings.count,
                        cables: wholeGrid.cables.count,
                        km: wholeGrid.cables.total_length_km.toFixed(1),
                    })}
                </p>
            )}

            <div className="px-3 py-2 space-y-1.5 border-t border-border">
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
                        <p className="text-xs">{t("gridStats.capacityTooltip")}</p>
                    </TooltipContent>
                </Tooltip>
                <p className="text-[9px] text-muted-foreground flex items-center gap-1">
                    <Info className="w-3 h-3 shrink-0" />
                    {t("gridStats.sourceNote")}
                </p>
            </div>
            </>)}
        </div>
    );
};
