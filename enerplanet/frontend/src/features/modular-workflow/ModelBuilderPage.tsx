import { MODELBUILDER_ENABLED } from "./flags";
import { ModelBuilderConfigurator } from "./ModelBuilderConfigurator";
import { defaultWorkflow } from "./workflows/defaultWorkflow";

/**
 * Route page for the ModelBuilder feature.
 *
 * Renders the playback shell with the default workflow. If the feature flag is
 * disabled, shows a placeholder instead of mounting the shell.
 */
export default function ModelBuilderPage() {
  if (!MODELBUILDER_ENABLED) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <h2 className="text-lg font-semibold">ModelBuilder</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This feature is not enabled. Set{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              VITE_MODELBUILDER_ENABLED=true
            </code>{" "}
            to enable it.
          </p>
        </div>
      </div>
    );
  }

  return <ModelBuilderConfigurator workflow={defaultWorkflow} />;
}
