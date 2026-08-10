import { useState, useEffect } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import { pylovoService } from "../../../configurator/services/pylovoService";

/**
 * Grid Statistics module.
 *
 * Auto-step: on mount, calls `pylovoService.getGridStatistics(gridResultIds)`.
 * Writes `gridStatistics` to context on success.
 */
export class GridStatisticsModule extends BaseModule {
  readonly meta = {
    id: "grid-statistics",
    name: "Grid Statistics",
    description: "Compute statistics for the generated grid.",
    icon: "bar-chart",
    category: "analysis" as const,
    defaultComplexity: "basic" as const,
  };

  readonly io = {
    inputs: ["gridResultIds"],
    outputs: ["gridStatistics"],
    required: ["gridResultIds"],
  };

  readonly component = GridStatisticsComponent;
}

function GridStatisticsComponent({ context, onUpdate }: ModuleProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (context.gridStatistics) return;

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await pylovoService.getGridStatistics(context.gridResultIds!);
        if (cancelled) return;
        onUpdate({ gridStatistics: result });
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Grid statistics failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="p-4 text-muted-foreground">Computing grid statistics...</div>;
  if (error) return <div className="p-4 text-destructive">Error: {error}</div>;
  if (context.gridStatistics)
    return <div className="p-4 text-green-600">Grid statistics loaded</div>;
  return null;
}

export const gridStatisticsModule = new GridStatisticsModule();
