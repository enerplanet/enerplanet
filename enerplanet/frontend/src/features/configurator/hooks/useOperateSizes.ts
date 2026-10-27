import { useEffect, useState } from "react";
import type { Feature } from "ol";
import type { Geometry } from "ol/geom";
import type VectorLayer from "ol/layer/Vector";
import type VectorSource from "ol/source/Vector";
import { unByKey } from "ol/Observable";

import type { RunMode } from "@/features/configurator/store/modelStore";
import { collectBuildingsFromLayers } from "@/features/configurator/hooks/useAreaSelect/helpers/layerConnections";
import { unsizedTechs, type UnsizedTech } from "@/features/configurator/utils/operateSizes";

/** A building whose technologies lack a size for operate mode. */
export interface OperateIssue {
  osmId: string;
  feature: Feature<Geometry>;
  techs: UnsizedTech[];
}

/**
 * In operate mode, lists the active buildings with unsized technologies and flags each
 * with operate_unsized, which the building style draws as a red outline. It recomputes
 * whenever a building changes; layersVersion changes when the grid is rebuilt.
 */
export function useOperateSizes(
  layersRef: React.RefObject<VectorLayer<VectorSource>[]>,
  runMode: RunMode,
  layersVersion: unknown,
): OperateIssue[] {
  const [issues, setIssues] = useState<OperateIssue[]>([]);

  useEffect(() => {
    const layers = layersRef.current ?? [];
    const recompute = () => {
      const next: OperateIssue[] = [];
      for (const feature of collectBuildingsFromLayers(layers)) {
        const active = runMode === "operate" && feature.get("activated") !== false;
        const techs = active ? unsizedTechs(feature.get("techs")) : [];
        // set only fires a change when the value differs, so this cannot loop.
        feature.set("operate_unsized", techs.length > 0);
        if (techs.length > 0) next.push({ osmId: String(feature.get("osm_id")), feature, techs });
      }
      setIssues(next);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(recompute, 100);
    };
    recompute();
    const keys = layers.flatMap((layer) => {
      const source = layer.getSource();
      return source ? [source.on(["changefeature", "addfeature", "removefeature"], schedule)] : [];
    });
    return () => {
      clearTimeout(timer);
      keys.forEach((key) => unByKey(key));
      for (const feature of collectBuildingsFromLayers(layers)) feature.set("operate_unsized", false);
    };
  }, [layersRef, runMode, layersVersion]);

  return issues;
}
