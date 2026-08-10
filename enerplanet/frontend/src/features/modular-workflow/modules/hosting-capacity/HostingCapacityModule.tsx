import { useState, useEffect } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import { pylovoService } from "../../../configurator/services/pylovoService";

/**
 * Hosting Capacity module.
 *
 * Auto-step: calls `pylovoService.getHostingCapacity(gridStatistics)`.
 * Writes `hostingCapacity` to context on success.
 */
export class HostingCapacityModule extends BaseModule {
  readonly meta = {
    id: "hosting-capacity",
    name: "Hosting Capacity",
    description: "Estimate EV hosting capacity for the grid.",
    icon: "car",
    category: "analysis" as const,
    defaultComplexity: "basic" as const,
  };

  readonly io = {
    inputs: ["gridStatistics"],
    outputs: ["hostingCapacity"],
    required: ["gridStatistics"],
  };

  readonly component = HostingCapacityComponent;
}

function HostingCapacityComponent({ context, onUpdate }: ModuleProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (context.hostingCapacity) return;

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const stats = context.gridStatistics!;
        const result = await pylovoService.getHostingCapacity({
          transformer_capacity_kva: stats.transformers?.total_capacity_kva ?? 0,
          current_peak_load_kw: stats.buildings?.simultaneous_load_kw ?? 0,
        });
        if (cancelled) return;
        onUpdate({ hostingCapacity: result });
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Hosting capacity failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading)
    return <div className="p-4 text-muted-foreground">Estimating hosting capacity...</div>;
  if (error) return <div className="p-4 text-destructive">Error: {error}</div>;
  if (context.hostingCapacity)
    return <div className="p-4 text-green-600">Hosting capacity estimated</div>;
  return null;
}

export const hostingCapacityModule = new HostingCapacityModule();
