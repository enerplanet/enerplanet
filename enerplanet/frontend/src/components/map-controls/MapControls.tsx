import React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@spatialhub/ui";
import { LocateFixed, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";

interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenterMap: () => void;
}

export const MapControls: React.FC<MapControlsProps> = ({ onZoomIn, onZoomOut, onCenterMap }) => {
  const { t } = useTranslation();
  
  const buttonClass = "flex items-center justify-center rounded-full size-8 cursor-pointer bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-sm border border-border";
  
  return (
    <div
      className="absolute top-4 z-50 pointer-events-auto"
      style={{ right: "calc(1rem + var(--sidebar-offset, 0rem))" }}
    >
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
          <TooltipContent side="left" sideOffset={8}>
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
          <TooltipContent side="left" sideOffset={8}>
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
          <TooltipContent side="left" sideOffset={8}>
            {t('map.centerMap')}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};
