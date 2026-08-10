import { useState, useCallback } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import { pylovoService } from "../../../configurator/services/pylovoService";

/**
 * Pipeline module.
 *
 * Calls `pylovoService.runPipeline(region)` to run the data pipeline for a
 * region. Writes the resulting job info to context.
 */
export class PipelineModule extends BaseModule {
  readonly meta = {
    id: "pipeline",
    name: "Data Pipeline",
    description: "Run the data pipeline for the selected region.",
    icon: "workflow",
    category: "simulation" as const,
    defaultComplexity: "expert" as const,
  };

  readonly io = {
    inputs: ["region"],
    outputs: ["pipelineJob"],
    required: ["region"],
  };

  readonly component = PipelineComponent;
}

function PipelineComponent({ context, onUpdate }: ModuleProps) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    if (running || !context.region) return;
    setRunning(true);
    setError(null);
    try {
      const result = await pylovoService.runPipeline({
        country: context.region.country,
        state: context.region.state,
        step: "all",
      });
      setJobId(result.job_id);
      onUpdate({ pipelineJob: result });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Pipeline run failed");
    } finally {
      setRunning(false);
    }
  }, [context.region, onUpdate, running]);

  return (
    <div className="p-4 space-y-3">
      <div className="text-sm text-muted-foreground">
        {jobId
          ? `Pipeline job started: ${jobId}`
          : "Run the data pipeline for the selected region."}
      </div>
      {error && <div className="text-sm text-destructive">Error: {error}</div>}
      <button
        className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md disabled:opacity-50"
        onClick={handleRun}
        disabled={running}
      >
        {running ? "Running..." : "Run Pipeline"}
      </button>
    </div>
  );
}

export const pipelineModule = new PipelineModule();
