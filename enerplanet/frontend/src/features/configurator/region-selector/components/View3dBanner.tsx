import type { FC } from "react";
import { useTranslation } from "@spatialhub/i18n";
import { MAP_TOP_CENTRE } from "@/components/map-controls/WorkflowBar";
import { MARKER_COLOR, PV_COLOR } from "@/components/map-controls/maplibre/maplibre-lod2";

const css = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

/** What the 3D view is for, and what its PV panels and technology markers mean. */
export const View3dBanner: FC = () => {
  const { t } = useTranslation();
  const legend = [
    { key: "legendPv", color: css(PV_COLOR), shape: "rounded-sm" },
    { key: "legendStorage", color: css(MARKER_COLOR.storage), shape: "rounded-full" },
    { key: "legendHeat", color: css(MARKER_COLOR.heat), shape: "rounded-full" },
  ];
  return (
    <div className="pointer-events-none absolute top-4 z-30 -translate-x-1/2 rounded-2xl bg-black/70 px-4 py-1.5 text-center text-xs font-medium text-white shadow-md" style={MAP_TOP_CENTRE}>
      <p>{t("drawing.view3dOnly")}</p>
      <div className="mt-1 flex justify-center gap-3 text-[11px] text-white/85">
        {legend.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 ring-1 ring-white/50 ${item.shape}`} style={{ backgroundColor: item.color }} aria-hidden="true" />
            {t(`drawing.${item.key}`)}
          </span>
        ))}
      </div>
    </div>
  );
};
