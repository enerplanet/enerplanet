import { useMemo, type FC } from "react";
import { useTranslation } from "@spatialhub/i18n";

import { DARK_CLUSTER_COLORS, TECH_ICON_RING, techIconSrc } from "@/features/interactive-map/utils/mapStyleUtils";
import { useMapStore } from "@/features/interactive-map/store/map-store";
import { techMarkersOf } from "./maplibre/techMarkers";
import type { TechsFor } from "./maplibre/usePvSurfaceIds";
import { useTechMarksStore, type TechMark } from "./maplibre/techMarksStore";

// The icons the seeded technologies of each group carry (initial-data/techs/default_technologies.json).
const ITEMS: { mark: TechMark; label: string; icon: string }[] = [
  { mark: "pv", label: "drawing.legendPv", icon: "solar-panel" },
  { mark: "storage", label: "drawing.legendStorage", icon: "battery" },
  { mark: "heat", label: "drawing.legendHeat", icon: "flame" },
];

// mvLineStyleFunction's colour for a medium-voltage line without a load result.
const MV_LINE = "#f97316";
// The first clusters' colours, standing for "one colour per transformer".
const LV_LINE = `linear-gradient(to right, ${DARK_CLUSTER_COLORS.slice(0, 3).map((c, i) => `${c} ${i * 33.4}% ${(i + 1) * 33.3}%`).join(", ")})`;

interface MapLegendProps {
  /** Shows the medium- and low-voltage line keys. */
  grid: boolean;
  /** The model's buildings; a technology group is listed once one of them has it. */
  buildings: { features: unknown[] } | null | undefined;
  /** The buildings' technologies by osm_id; without it they are read from each building's `techs` property. */
  techsFor?: TechsFor;
}

/**
 * The map's key to its grid lines and to the technologies its buildings carry, each group with a box to show
 * or hide its marks, the same in 2D and 3D. Sits above the base map tile.
 */
export const MapLegend: FC<MapLegendProps> = ({ grid, buildings, techsFor }) => {
  const { t } = useTranslation();
  const map = useMapStore((s) => s.map);
  const shown = useTechMarksStore((s) => s.shown);
  const toggle = useTechMarksStore((s) => s.toggle);
  // Keyed by content: techsFor is a new function on every render.
  const present = [...techMarkersOf((buildings ?? null) as GeoJSON.FeatureCollection | null, techsFor).values()].flat().map((m) => m.mark);
  const presentKey = [...new Set(present)].sort().join(",");
  const items = useMemo(() => ITEMS.filter(({ mark }) => presentKey.split(",").includes(mark)), [presentKey]);
  if (!grid && items.length === 0) return null;

  // The 2D icons are styled per render, so the vector layers are redrawn to pick up the change.
  const onToggle = (mark: TechMark) => {
    toggle(mark);
    map?.getAllLayers().forEach((layer) => layer.changed());
  };

  return (
    <div className="absolute bottom-24 left-4 z-30 space-y-1.5 rounded-lg border border-border bg-background/95 px-2.5 py-2 text-xs shadow-md backdrop-blur-sm">
      {grid && (
        <>
          <div className="flex items-center gap-2 text-foreground">
            <span className="h-1 w-5 rounded-full" style={{ background: MV_LINE }} aria-hidden="true" />
            {t("drawing.legendMvLine")}
          </div>
          <div className="flex items-center gap-2 text-foreground">
            <span className="h-0.5 w-5 rounded-full" style={{ background: LV_LINE }} aria-hidden="true" />
            {t("drawing.legendLvLine")}
          </div>
        </>
      )}
      {items.map(({ mark, label, icon }) => (
        <label key={mark} className="flex cursor-pointer items-center gap-2 text-foreground">
          <input type="checkbox" checked={shown[mark]} onChange={() => onToggle(mark)} className="h-3.5 w-3.5 cursor-pointer accent-primary" />
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] bg-white shadow-sm"
            style={{ borderColor: TECH_ICON_RING }}
            aria-hidden="true"
          >
            <img src={techIconSrc(icon)} alt="" className="h-3.5 w-3.5" />
          </span>
          {t(label)}
        </label>
      ))}
    </div>
  );
};
