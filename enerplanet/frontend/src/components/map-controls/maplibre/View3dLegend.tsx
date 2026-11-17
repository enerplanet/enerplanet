import type { FC } from "react";
import { useTranslation } from "@spatialhub/i18n";

import { TECH_ICON_RING, techIconSrc } from "@/features/interactive-map/utils/mapStyleUtils";
import { useTechMarksStore, type TechMark } from "./techMarksStore";

// The icons the seeded technologies of each group carry (initial-data/techs/default_technologies.json).
const ITEMS: { mark: TechMark; label: string; icon: string }[] = [
  { mark: "pv", label: "drawing.legendPv", icon: "solar-panel" },
  { mark: "storage", label: "drawing.legendStorage", icon: "battery" },
  { mark: "heat", label: "drawing.legendHeat", icon: "flame" },
];

/** The 3D view's technology marks, each with a box to show or hide it. Sits above the base map tile. */
export const View3dLegend: FC = () => {
  const { t } = useTranslation();
  const shown = useTechMarksStore((s) => s.shown);
  const toggle = useTechMarksStore((s) => s.toggle);

  return (
    <div className="absolute bottom-24 left-4 z-30 space-y-1.5 rounded-lg border border-border bg-background/95 px-2.5 py-2 text-xs shadow-md backdrop-blur-sm">
      {ITEMS.map(({ mark, label, icon }) => (
        <label key={mark} className="flex cursor-pointer items-center gap-2 text-foreground">
          <input type="checkbox" checked={shown[mark]} onChange={() => toggle(mark)} className="h-3.5 w-3.5 cursor-pointer accent-primary" />
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
