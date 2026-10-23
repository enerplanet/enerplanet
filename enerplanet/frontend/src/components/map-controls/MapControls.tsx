import React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@spatialhub/ui";
import { LocateFixed, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";

/** Where the zoom and centre buttons sit on the map. */
export type MapControlsPlacement = "top-right" | "top-left";

interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenterMap: () => void;
  placement?: MapControlsPlacement;
}

// top-left sits under the map search button (MapSearchBar: top-4 left-4, size-8) and
// below its z-10, so the expanded search covers the buttons.
const PLACEMENT_STYLE: Record<MapControlsPlacement, { className: string; style: React.CSSProperties }> = {
  "top-right": { className: "absolute top-4 z-50 pointer-events-auto", style: { right: "calc(1rem + var(--sidebar-offset, 0rem))" } },
  "top-left": { className: "absolute z-[5] pointer-events-auto", style: { left: "1rem", top: "3.5rem" } },
};

export const MapControls: React.FC<MapControlsProps> = ({ onZoomIn, onZoomOut, onCenterMap, placement = "top-right" }) => {
  const { t } = useTranslation();
  const tooltipSide = placement === "top-left" ? "right" : "left";
  
  const buttonClass = "flex items-center justify-center rounded-full size-8 cursor-pointer bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-sm border border-border";
  
  return (
    <div className={PLACEMENT_STYLE[placement].className} style={PLACEMENT_STYLE[placement].style}>
      <div className="relative grid gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={buttonClass}
              onClick={onZoomIn}
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide} sideOffset={8}>
            {t('map.zoomIn')}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={buttonClass}
              onClick={onZoomOut}
            >
              <ZoomOut className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide} sideOffset={8}>
            {t('map.zoomOut')}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={buttonClass}
              onClick={onCenterMap}
            >
              <LocateFixed className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide} sideOffset={8}>
            {t('map.centerMap')}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};
