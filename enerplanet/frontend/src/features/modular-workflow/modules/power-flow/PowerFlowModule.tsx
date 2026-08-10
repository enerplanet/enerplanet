import { useState, useEffect, useRef, useCallback } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import { pylovoService } from "../../../configurator/services/pylovoService";

/**
 * Power Flow module.
 *
 * Runs `pylovoService.runPowerFlow` for each grid result. Only runs if pypsa is
 * enabled (`advancedParams.pypsa_enabled`). Re-runs automatically whenever the
 * grid changes (i.e. `gridResultIds` changes). Writes `powerFlowResult` to
 * context on success.
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
  const [converged, setConverged] = useState<boolean | null>(null);
  const runIdRef = useRef(0);

  const pypsaEnabled = (context.advancedParams as { pypsa_enabled?: boolean } | undefined)
    ?.pypsa_enabled;

  const run = useCallback(async () => {
    const gridResultIds = context.gridResultIds ?? [];
    if (!gridResultIds.length) {
      setConverged(null);
      return;
    }

    const runId = ++runIdRef.current;
    setLoading(true);
    setError(null);
    setConverged(null);
    try {
      // Run power flow for the first grid result (the primary grid).
      const result = await pylovoService.runPowerFlow(gridResultIds[0]);
      if (runId !== runIdRef.current) return;
      setConverged(result.converged);
      onUpdate({ powerFlowResult: result });
    } catch (err: unknown) {
      if (runId !== runIdRef.current) return;
      setError(err instanceof Error ? err.message : "Power flow failed");
    } finally {
      if (runId === runIdRef.current) setLoading(false);
    }
  }, [context.gridResultIds, onUpdate]);

  // Run whenever the grid changes, but only if pypsa is enabled.
  useEffect(() => {
    if (!pypsaEnabled) {
      setConverged(null);
      return;
    }
    run();
    return () => {
      runIdRef.current++;
    };
  }, [run, pypsaEnabled]);

  if (!pypsaEnabled) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Power flow is disabled. Enable pypsa in the simulation settings to run it.
      </div>
    );
  }

  if (loading) return <div className="p-4 text-muted-foreground">Running power flow...</div>;
  if (error) return <div className="p-4 text-destructive">Error: {error}</div>;
  if (converged !== null)
    return (
      <div className="p-4 text-sm">
        {converged ? (
          <span className="text-green-600">Power flow converged.</span>
        ) : (
          <span className="text-amber-600">Power flow did not converge.</span>
        )}
      </div>
    );
  return null;
}

export const powerFlowModule = new PowerFlowModule();
