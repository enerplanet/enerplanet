// ---------------------------------------------------------------------------
// Heat resolution (supply side) — configurator hook for the expected-fit
// auto-resolve (plan §1). Closes the gap where a building has heat demand but
// no assigned heat tech: in "expected" mode it assigns the likely tech for that
// building type and flags the resolution as estimated; in "manual" mode it
// never auto-assigns (the later blocking-validator stage handles that).
//
// Reads building properties straight off the OL features (same source the
// drag-drop hook uses) and writes through the identical stored shape as a
// manual assignment ({ alias, icon, constraints } on feature "techs"), so an
// auto-resolved tech is indistinguishable on the wire. Detection also honors a
// producer heat-link (prop "heat_supplier") so step-3 wiring isn't over-ridden.
//
// Note: the spec called for routing the write through techOps.handleSaveTechToBuildingBulk,
// but that handler reads its building/tech from the store subscription, which does
// not refresh synchronously within one call. This hook writes the feature directly
// instead — same stored shape, so the outcome is identical to a hand-assignment.
// ---------------------------------------------------------------------------

import type { Feature } from "ol";
import type { Geometry } from "ol/geom";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";

import { useModelStore } from "@/features/configurator/store/modelStore";
import { getPrimaryFClass } from "@/features/configurator/utils/fClassUtils";
import { createBuildingStyleFunction } from "@/features/interactive-map/utils/mapStyleUtils";
import { collectBuildingsFromLayers } from "@/features/configurator/hooks/useAreaSelect/helpers/layerConnections";
import {
  hasHeatTech,
  resolveHeatTechAssignment,
  resolveHeatTechForBuilding,
} from "@/features/configurator/utils/heatResolution";
import { fetchOpenTechHeatTechnologies } from "@/features/configurator/services/opentechdbService";

interface HeatResolutionOptions {
  pylovoLayersRef: React.RefObject<VectorLayer<VectorSource>[]>;
  setIsModified: (v: boolean) => void;
}

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[\s\u00A0\u202F]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

/** Heat demand (kWh/year) from props: prefer explicit `demand_heat`, fall back to `yearly_heat_demand_kwh`. */
function readYearlyHeatDemand(props: Record<string, unknown>): number {
  const explicit = toFiniteNumber(props.demand_heat ?? props.yearly_heat_demand_kwh);
  return explicit ?? 0;
}

export const useHeatResolution = ({
  pylovoLayersRef,
  setIsModified,
}: HeatResolutionOptions) => {
  const heatResolutionMode = useModelStore((s) => s.heatResolutionMode);
  const setHeatResolutionMode = useModelStore((s) => s.setHeatResolutionMode);

  const warmCatalog = async () => {
    // fetchOpenTechHeatTechnologies warms the FULL module-level catalog cache
    // (it calls fetchOpenTechCatalog), so mixed-output heat techs (CHP /
    // biomass_CHP, mapped carrier_out=electricity by the bridge) are reachable too.
    await fetchOpenTechHeatTechnologies();
  };

  /**
   * Resolve a single building's missing heat tech (expected mode). Returns true
   * when an assignment was made. Never stomps an existing heat tech or link.
   */
  const resolveBuildingHeat = async (feature: Feature<Geometry>): Promise<boolean> => {
    if (heatResolutionMode !== "expected") return false;

    const props = feature.getProperties() as Record<string, unknown>;
    const resolution = resolveHeatTechForBuilding(getPrimaryFClass(props), readYearlyHeatDemand(props));
    if (!resolution) return false; // zero-demand or no demand → nothing to resolve

    // Already heat-resolved — leave it alone.
    if (hasHeatTech(feature.get("techs"))) return false;
    // Producer heat-link already wired (step 3) — resolves it; don't stomp.
    if (feature.get("heat_supplier")) return false;

    await warmCatalog();
    const tech = await resolveHeatTechAssignment(resolution.techKey);
    if (!tech) return false; // not in catalog (or cache still cold) → blocking validator picks it up

    // Same shape a fresh manual save produces: every constraint carrying its
    // default_value, including the OTDB carrier-out marker used by hasHeatTech.
    const constraints = (tech.constraints ?? []).map((c) => ({
      key: c.key,
      value: c.default_value,
    }));

    const techs = feature.get("techs") || {};
    techs[resolution.techKey] = {
      alias: tech.alias ?? resolution.techKey,
      icon: tech.icon,
      constraints,
    };
    feature.set("techs", techs);
    feature.setStyle(createBuildingStyleFunction(true, false));

    setIsModified(true);
    return true;
  };

  /** Iterate every building and auto-resolve the unresolved ones; returns how many it assigned. */
  const resolveAllBuildingsHeat = async (): Promise<number> => {
    if (heatResolutionMode !== "expected") return 0;
    await warmCatalog();
    let count = 0;
    for (const feature of collectBuildingsFromLayers(pylovoLayersRef.current)) {
      if (await resolveBuildingHeat(feature)) count += 1;
    }
    if (count > 0) setIsModified(true);
    return count;
  };

  return {
    heatResolutionMode,
    setHeatResolutionMode,
    resolveBuildingHeat,
    resolveAllBuildingsHeat,
    hasHeatTech,
  };
};

export type HeatResolutionHandlers = ReturnType<typeof useHeatResolution>;