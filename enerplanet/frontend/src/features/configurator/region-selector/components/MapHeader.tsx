import { WorkspaceSelector } from "@/components/workspace/WorkspaceSelector";
import { RegionSelector, type AvailableRegion } from "./RegionSelector";
import { Tooltip, TooltipTrigger, TooltipContent } from "@spatialhub/ui";
import { Loader2, Globe, Lock, Layers } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import type { Workspace } from "@/components/workspace/services/workspaceService";
import { InfoIcon } from "@/components/ui/InfoTooltip";
import type { FC, ReactNode } from "react";

interface ModernToggleProps {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    icon: ReactNode;
    activeColorClass?: string;
    ariaLabel?: string;
}

const ModernToggle: FC<ModernToggleProps> = ({
    checked,
    onCheckedChange,
    icon,
    activeColorClass = "text-blue-600",
    ariaLabel
}) => {
    return (
        <button
            onClick={() => onCheckedChange(!checked)}
            className={`
                relative inline-flex h-5 w-10 items-center rounded-full
                transition-colors duration-300 ease-in-out cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary
                ${checked ? "bg-slate-700" : "bg-gray-300 dark:bg-gray-600"}
            `}
            aria-label={ariaLabel}
            type="button"
        >
            <span
                className={`
                    absolute h-4 w-4 rounded-full bg-white shadow-sm flex items-center justify-center
                    transition-all duration-300 ease-in-out
                `}
                style={{ transform: checked ? 'translateX(22px)' : 'translateX(2px)' }}
            >
                <div className={`w-3 h-3 ${checked ? activeColorClass.replace('bg-', 'text-') : 'text-gray-400'}`}>
                    {icon}
                </div>
            </span>
        </button>
    );
};

interface MapHeaderProps {
    allPolygonsCount: number;
    allowMultiplePolygons: boolean;
    onToggleAllowMultiplePolygons: (value: boolean) => void;
    onClearAllPolygons: () => void;
    isLoadingPreference: boolean;
    wsReloadKey: number;
    currentWorkspace: Workspace | null;
    preferredWorkspaceId?: number;
    normalizedWorkspaceId?: number;
    onWorkspaceChange: (workspace: Workspace | null) => void;
    onOpenCreateWorkspace: () => void;
    // Custom building filters
    includePublicBuildings?: boolean;
    includePrivateBuildings?: boolean;
    onTogglePublicBuildings?: (value: boolean) => void;
    onTogglePrivateBuildings?: (value: boolean) => void;
    simulateEV?: boolean;
    onToggleSimulateEV?: (value: boolean) => void;
    availableRegions?: AvailableRegion[];
    onRegionSelect?: (region: AvailableRegion) => void;
}

export const MapHeader: FC<MapHeaderProps> = ({
    allPolygonsCount,
    allowMultiplePolygons,
    onToggleAllowMultiplePolygons,
    onClearAllPolygons,
    isLoadingPreference,
    wsReloadKey,
    currentWorkspace,
    preferredWorkspaceId,
    normalizedWorkspaceId,
    onWorkspaceChange,
    onOpenCreateWorkspace,
    includePublicBuildings = true,
    includePrivateBuildings = true,
    onTogglePublicBuildings,
    onTogglePrivateBuildings,
    // EV simulation temporarily disabled
    // simulateEV = false,
    // onToggleSimulateEV,
    availableRegions = [],
    onRegionSelect,
}) => {
    const { t } = useTranslation();
    return (
        <div className="bg-background dark:bg-gray-800 border-b border-border px-2 py-1.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
                {!isLoadingPreference && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div>
                                <WorkspaceSelector
                                    onWorkspaceChange={onWorkspaceChange}
                                    onCreateWorkspace={onOpenCreateWorkspace}
                                    reloadKey={wsReloadKey}
                                    initialWorkspaceId={normalizedWorkspaceId ?? preferredWorkspaceId ?? undefined}
                                    activeWorkspace={currentWorkspace}
                                />
                            </div>
                        </TooltipTrigger>
                        <TooltipContent>
                            Select or create a workspace to organize your models
                        </TooltipContent>
                    </Tooltip>
                )}
                {onRegionSelect && availableRegions.length > 0 && (
                    <RegionSelector
                        regions={availableRegions}
                        onRegionSelect={onRegionSelect}
                    />
                )}
                {isLoadingPreference && (
                    <div className="flex items-center gap-2 px-2 py-1 border border-border rounded bg-background dark:bg-gray-700 text-xs">
                        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                        <span className="font-medium text-foreground">Loading workspace...</span>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-2">
                {allPolygonsCount > 0 && (
                    <div className="bg-muted border border-border rounded px-2 py-1 flex items-center gap-2">
                        <button
                            onClick={onClearAllPolygons}
                            className="text-xs font-medium text-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors"
                        >
                            {t('simulation.mapHeader.clearAll')} ({allPolygonsCount})
                        </button>
                    </div>
                )}

                {/* Custom Building Filters */}
                {onTogglePublicBuildings && (
                    <div className="bg-muted border border-border rounded px-2 py-1 flex items-center gap-2">
                        <span className="text-xs font-medium text-foreground flex items-center gap-1">
                            {t('simulation.mapHeader.public')}
                            <InfoIcon tooltipKey="publicBuildings" position="bottom" />
                        </span>
                        <ModernToggle
                            checked={includePublicBuildings}
                            onCheckedChange={onTogglePublicBuildings}
                            icon={<Globe className="w-full h-full" />}
                            activeColorClass="text-green-600"
                            ariaLabel={t('simulation.mapHeader.togglePublicBuildings')}
                        />
                    </div>
                )}

                {onTogglePrivateBuildings && (
                    <div className="bg-muted border border-border rounded px-2 py-1 flex items-center gap-2">
                        <span className="text-xs font-medium text-foreground flex items-center gap-1">
                            {t('simulation.mapHeader.myBuildings')}
                            <InfoIcon tooltipKey="privateBuildings" position="bottom" />
                        </span>
                        <ModernToggle
                            checked={includePrivateBuildings}
                            onCheckedChange={onTogglePrivateBuildings}
                            icon={<Lock className="w-full h-full" />}
                            activeColorClass="text-blue-600"
                            ariaLabel={t('simulation.mapHeader.toggleMyBuildings')}
                        />
                    </div>
                )}

                {/* EV Simulation — Coming Soon (hidden until feature is ready)
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="bg-muted border border-border rounded px-2 py-1 flex items-center gap-2 opacity-60 cursor-default">
                            <Zap className="h-3.5 w-3.5 text-yellow-500" />
                            <span className="text-xs font-medium text-muted-foreground">EV Simulation</span>
                            <span className="text-[10px] font-medium text-muted-foreground bg-muted-foreground/10 rounded px-1.5 py-0.5">Coming Soon</span>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent>EV Simulation will be available in a future release</TooltipContent>
                </Tooltip>
                */}

                <div className="bg-muted border border-border rounded px-2 py-1 flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground flex items-center gap-1">
                        {t('simulation.mapHeader.multiplePolygons')}
                        <InfoIcon tooltipKey="multiplePolygons" position="bottom" />
                    </span>
                    <ModernToggle
                        checked={allowMultiplePolygons}
                        onCheckedChange={onToggleAllowMultiplePolygons}
                        icon={<Layers className="w-full h-full" />}
                        activeColorClass="text-blue-600"
                        ariaLabel={t('simulation.mapHeader.toggleMultiplePolygons')}
                    />
                </div>
                
            </div>
        </div>
    );
};
