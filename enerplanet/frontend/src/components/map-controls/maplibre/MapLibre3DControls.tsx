import React, { useCallback } from 'react';
import type maplibregl from 'maplibre-gl';
import { RotateCcw } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@spatialhub/ui';
import { useTranslation } from '@spatialhub/i18n';

interface MapLibre3DControlsProps {
  mapRef: React.RefObject<maplibregl.Map | null>;
}

/**
 * Minimal 3D reset button with a persistent rotation hint on the map.
 */
export const MapLibre3DControls: React.FC<MapLibre3DControlsProps> = ({ mapRef }) => {
  const { t } = useTranslation();

  const resetView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ pitch: 0, bearing: 0, duration: 500 });
  }, [mapRef]);

  const buttonClass = "flex items-center justify-center rounded-full size-8 cursor-pointer bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-sm border border-border";

  return (
    <>
      {/* Reset button below map controls */}
      <div
        className="absolute z-[60] pointer-events-auto"
        style={{ top: 152, right: "calc(1rem + var(--sidebar-offset, 0rem))" }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button className={buttonClass} onClick={resetView}>
              <RotateCcw className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={8}>
            {t('map.resetTopDown', 'Reset to top-down')}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Persistent hint on the map */}
      <div
        className="absolute z-[60] pointer-events-none flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm text-white text-[11px] shadow-md"
        style={{ bottom: 40, right: "calc(1rem + var(--sidebar-offset, 0rem))" }}
      >
        <RotateCcw className="w-3 h-3 opacity-80" />
        <span>{t('map.rightClickRotate', 'Right-click + drag to rotate')}</span>
      </div>
    </>
  );
};
