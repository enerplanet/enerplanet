import { useState, useEffect, useCallback } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import type { ConfiguratorContext } from "../../types/context";
import { pylovoService } from "../../../configurator/services/pylovoService";
import { RegionSelector } from "../../../configurator/region-selector/components/RegionSelector";
import type { AvailableRegion } from "../../../configurator/region-selector/components/RegionSelector";

/**
 * Region Selection module.
 *
 * Wraps the configurator's `RegionSelector` component. Fetches available
 * regions on mount and writes `region` + `polygons` to context on selection.
 */
export class RegionSelectModule extends BaseModule {
  readonly meta = {
    id: "region-select",
    name: "Region Selection",
    description: "Select a country, state, and draw the area boundary.",
    icon: "map",
    category: "input" as const,
    defaultComplexity: "basic" as const,
  };

  readonly io = {
    inputs: [],
    outputs: ["region", "polygons"],
    required: [],
  };

  readonly component = RegionSelectWrapper;

  override validate(context: ConfiguratorContext) {
    if (!context.region) {
      return { valid: false, errors: ["No region selected yet."] };
    }
    return { valid: true };
  }
}

function RegionSelectWrapper({ context, onUpdate }: ModuleProps) {
  const [regions, setRegions] = useState<AvailableRegion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await pylovoService.getAvailableRegions();
        if (cancelled) return;
        if (response.status !== "success" || !response.regions?.length) {
          setRegions([]);
          return;
        }
        const mapped = response.regions
          .filter((r) => r.region?.name)
          .map((r) => ({
            name: r.region!.name,
            gridCount: r.grid_count,
            country: r.region?.country,
            countryCode: r.region?.country_code || r.country_code,
            stateCode: r.region?.state_code || r.state_code,
            has3d: r.has_3d || false,
            bbox: r.bbox,
          }));
        setRegions(mapped);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load regions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRegionSelect = useCallback(
    (region: AvailableRegion) => {
      onUpdate({
        region: {
          country: region.country ?? "",
          state: region.name,
        },
      });
    },
    [onUpdate]
  );

  if (loading) return <div className="p-4 text-muted-foreground">Loading available regions...</div>;
  if (error) return <div className="p-4 text-destructive">Error: {error}</div>;

  return (
    <div className="p-4">
      <RegionSelector regions={regions} onRegionSelect={handleRegionSelect} />
      {context.region && (
        <div className="mt-4 text-sm text-muted-foreground">
          Selected: {context.region.country} / {context.region.state}
        </div>
      )}
    </div>
  );
}

export const regionSelectModule = new RegionSelectModule();
