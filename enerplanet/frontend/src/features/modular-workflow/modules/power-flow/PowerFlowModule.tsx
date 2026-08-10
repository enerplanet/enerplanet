import { useState, useEffect } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import { pylovoService } from "../../../configurator/services/pylovoService";

/**
 * Power Flow module.
 *
 * Auto-step: on mount, calls `pylovoService.runPowerFlow(gridResultIds, advancedParams)`.
 * Writes `powerFlowResult` to context on success.
 */
export class PowerFlowModule extends BaseModule {
  readonly meta = {
    id: "power-flow",
    name: "Power Flow",
    description: "Run a power flow simulation on the generated grid.",
    icon: "zap",
    category: "simulation" as const,
    defaultComplexity: "basic" as const,
  };

  readonly io = {
    inputs: ["gridResultIds", "advancedParams"],
    outputs: ["powerFlowResult"],
    required: ["gridResultIds"],
  };

  readonly component = PowerFlowComponent;
}

function PowerFlowComponent({ context, onUpdate }: ModuleProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (context.powerFlowResult) return;

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const gridResultId = context.gridResultIds![0];
        const result = await pylovoService.runPowerFlow(gridResultId);
        if (cancelled) return;
        onUpdate({ powerFlowResult: result });
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Power flow failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="p-4 text-muted-foreground">Running power flow...</div>;
  if (error) return <div className="p-4 text-destructive">Error: {error}</div>;
  if (context.powerFlowResult)
    return <div className="p-4 text-green-600">Power flow completed</div>;
  return null;
}

export const powerFlowModule = new PowerFlowModule();
