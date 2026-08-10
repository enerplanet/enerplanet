import { useState, useEffect } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import type { CostBreakdownItem } from "../../types/context";

/**
 * Cost Breakdown module.
 *
 * Auto-step: computes a cost breakdown from `gridStatistics` + `technologies`
 * using the configurator's cost utilities. Writes `costBreakdown` to context.
 */
export class CostBreakdownModule extends BaseModule {
  readonly meta = {
    id: "cost-breakdown",
    name: "Cost Breakdown",
    description: "Compute a detailed cost breakdown for the model.",
    icon: "dollar-sign",
    category: "analysis" as const,
    defaultComplexity: "basic" as const,
  };

  readonly io = {
    inputs: ["gridStatistics", "technologies"],
    outputs: ["costBreakdown"],
    required: ["gridStatistics"],
  };

  readonly component = CostBreakdownComponent;
}

function CostBreakdownComponent({ context, onUpdate }: ModuleProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (context.costBreakdown) return;

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        // Derive a cost breakdown from grid statistics (cable + transformer costs).
        const stats = context.gridStatistics!;
        const items: CostBreakdownItem[] = [
          {
            category: "cables",
            label: "Cables",
            amount: stats.costs?.cable_cost_eur ?? 0,
          },
          {
            category: "transformers",
            label: "Transformers",
            amount: stats.costs?.transformer_cost_eur ?? 0,
          },
          {
            category: "total",
            label: "Total Estimated Cost",
            amount: stats.costs?.total_estimated_cost_eur ?? 0,
          },
        ];
        if (cancelled) return;
        onUpdate({ costBreakdown: items });
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Cost breakdown failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="p-4 text-muted-foreground">Computing cost breakdown...</div>;
  if (error) return <div className="p-4 text-destructive">Error: {error}</div>;
  if (context.costBreakdown)
    return <div className="p-4 text-green-600">Cost breakdown computed</div>;
  return null;
}

export const costBreakdownModule = new CostBreakdownModule();
