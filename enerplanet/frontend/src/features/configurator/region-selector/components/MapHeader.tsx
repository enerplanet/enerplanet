import { WorkspaceSelector } from "@/components/workspace/WorkspaceSelector";
import { RegionSelector, type AvailableRegion } from "./RegionSelector";
import { Tooltip, TooltipTrigger, TooltipContent } from "@spatialhub/ui";
import { Check, FileDown, FileUp, Loader2, MapPin, RefreshCw } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import type { Workspace } from "@/components/workspace/services/workspaceService";
import { InfoIcon } from "@/components/ui/InfoTooltip";
import { cn } from "@/lib/utils";
import type { FC } from "react";

/** A button that toggles on/off, matching the top bar's button height. */
const ToggleButton: FC<{
  id?: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}> = ({ id, label, checked, onChange, disabled, ariaLabel }) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel ?? label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      "flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors border whitespace-nowrap cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
      checked
        ? "bg-primary text-primary-foreground border-primary"
        : "bg-muted text-foreground border-border hover:bg-muted/70"
    )}
  >
    {checked && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
    {label}
  </button>
);

interface MapHeaderProps {
  allPolygonsCount: number;
  onClearAllPolygons: () => void;
  /** Imports a GeoJSON file as the model area; absent where an area cannot be replaced. */
  onImportArea?: (file: File) => void;
  /** Downloads the drawn area as a GeoJSON file that Import area reads back. */
  onExportArea?: () => void;
  /** Present while a site's grid is out of date with its edits; regenerates it. */
  onRegenerateGrid?: () => void;
  isGeneratingGrid?: boolean;
  selectedBuildingCount?: number;
  onDisableSelectedBuildings?: () => void;
  isLoadingPreference: boolean;
  wsReloadKey?: number;
  currentWorkspace: Workspace | null;
  preferredWorkspaceId?: number;
  normalizedWorkspaceId?: number;
  onWorkspaceChange: (workspace: Workspace | null) => void;
  onOpenCreateWorkspace: () => void;
  // Custom building filters
  siteMode?: boolean;
  onToggleSiteMode?: (value: boolean) => void;
  includePrivateBuildings?: boolean;
  onTogglePrivateBuildings?: (value: boolean) => void;
  simulateEV?: boolean;
  onToggleSimulateEV?: (value: boolean) => void;
  availableRegions?: AvailableRegion[];
  onRegionSelect?: (region: AvailableRegion) => void;
  modelRegionName?: string;
}

export const MapHeader: FC<MapHeaderProps> = ({
  allPolygonsCount,
  onClearAllPolygons,
  onImportArea,
  onExportArea,
  onRegenerateGrid,
  isGeneratingGrid = false,
  selectedBuildingCount = 0,
  onDisableSelectedBuildings,
  isLoadingPreference,
  wsReloadKey,
  currentWorkspace,
  preferredWorkspaceId,
  normalizedWorkspaceId,
  onWorkspaceChange,
  onOpenCreateWorkspace,
  siteMode = false,
  onToggleSiteMode,
  includePrivateBuildings = true,
  onTogglePrivateBuildings,
  // EV simulation temporarily disabled
  // simulateEV = false,
  // onToggleSimulateEV,
  availableRegions = [],
  onRegionSelect,
  modelRegionName,
}) => {
  const { t } = useTranslation();
  // relative z-40: md-fade-in animates with fill-mode both, which creates a
  // permanent stacking context that traps the dropdowns' own z-50 here. 40 lifts
  // them over the map's z-30 overlays while staying under the z-50 toasts.
  return (
    <div className="md-fade-in relative z-40 bg-background dark:bg-gray-800 border-b border-border px-2 py-1.5 flex flex-wrap items-center justify-between gap-y-1.5">
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
            <TooltipContent>{t("model.selectWorkspace")}</TooltipContent>
          </Tooltip>
        )}
        {onRegionSelect && availableRegions.length > 0 && (
          <RegionSelector regions={availableRegions} onRegionSelect={onRegionSelect} />
        )}
        {/* A saved model's region is fixed by its polygon, so it is shown, not selectable. */}
        {modelRegionName && (
          <div className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg">
            <div className="flex items-center justify-center w-6 h-6 bg-muted rounded">
              <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <span className="font-normal text-foreground max-w-[160px] truncate text-sm">{modelRegionName}</span>
          </div>
        )}
        {isLoadingPreference && (
          <div className="md-fade-in flex items-center gap-2 px-2 py-1 border border-border rounded bg-background dark:bg-gray-700 text-xs">
            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
            <span className="font-medium text-foreground">{t("model.loadingWorkspace")}</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {selectedBuildingCount > 0 && onDisableSelectedBuildings && (
          <div className="md-fade-in bg-muted border border-border rounded px-2 py-1 flex items-center gap-2">
            <button
              onClick={onDisableSelectedBuildings}
              className="text-xs font-medium text-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors"
            >
              {t("simulation.mapHeader.disableSelected")} ({selectedBuildingCount})
            </button>
          </div>
        )}
        {onImportArea && (
          <Tooltip>
            <TooltipTrigger asChild>
              <label
                aria-label={t("simulation.mapHeader.importArea")}
                className="bg-muted border border-border rounded px-2 py-1 flex items-center gap-1 cursor-pointer text-xs font-medium text-foreground hover:text-primary transition-colors whitespace-nowrap"
              >
                <FileUp className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">{t("simulation.mapHeader.importArea")}</span>
                <input
                  type="file"
                  accept=".geojson,.json,application/geo+json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onImportArea(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">{t("simulation.mapHeader.importAreaHint")}</TooltipContent>
          </Tooltip>
        )}
        {onRegenerateGrid && (
          <button
            type="button"
            onClick={onRegenerateGrid}
            disabled={isGeneratingGrid}
            title={t("simulation.mapHeader.regenerateGridHint")}
            className="md-fade-in bg-amber-500 border border-amber-600 rounded px-2 py-1 flex items-center gap-1 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingGrid ? "animate-spin" : ""}`} />
            {t("simulation.mapHeader.regenerateGrid")}
          </button>
        )}
        {onExportArea && allPolygonsCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onExportArea}
                aria-label={t("simulation.mapHeader.exportArea")}
                className="bg-muted border border-border rounded px-2 py-1 flex items-center gap-1 text-xs font-medium text-foreground hover:text-primary transition-colors whitespace-nowrap"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">{t("simulation.mapHeader.exportArea")}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">{t("simulation.mapHeader.exportAreaHint")}</TooltipContent>
          </Tooltip>
        )}
        {allPolygonsCount > 0 && (
          <div className="md-fade-in bg-muted border border-border rounded px-2 py-1 flex items-center gap-2">
            <button
              onClick={onClearAllPolygons}
              className="text-xs font-medium text-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors whitespace-nowrap"
            >
              {t("simulation.mapHeader.resetArea")}
            </button>
          </div>
        )}

        {/* Site mode: build the grid from your own transformers instead of a pre-generated one. */}
        {onToggleSiteMode && (
          <ToggleButton
            id="site-mode-toggle"
            label={t("simulation.siteMode.label")}
            checked={siteMode}
            onChange={onToggleSiteMode}
            disabled={isGeneratingGrid}
            ariaLabel={t("simulation.siteMode.label")}
          />
        )}

        {/* Custom Building Filters */}
        {onTogglePrivateBuildings && (
          <div className="flex items-center gap-1">
            <ToggleButton
              label={t("simulation.mapHeader.myBuildings")}
              checked={includePrivateBuildings}
              onChange={onTogglePrivateBuildings}
              ariaLabel={t("simulation.mapHeader.toggleMyBuildings")}
            />
            <InfoIcon tooltipKey="privateBuildings" position="bottom" />
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
      </div>
    </div>
  );
};
