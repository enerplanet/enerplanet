import { useState, useCallback } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import type { ConfiguratorContext } from "../../types/context";
import type { AdvancedParametersState } from "../../../configurator/types/area-select";
import { getDefaultAdvancedParameters } from "../../../configurator/constants/area-select-params";
import { AdvancedParametersDrawer } from "../../../configurator/region-selector/AdvancedParametersDrawer";

/**
 * Advanced Parameters module.
 *
 * Wraps the configurator's `AdvancedParametersDrawer`. Lets the user tweak
 * simulation parameters (scenario, cable types, solver, etc.) and writes
 * `advancedParams` to context.
 */
export class AdvancedParamsModule extends BaseModule {
  readonly meta = {
    id: "advanced-params",
    name: "Advanced Parameters",
    description: "Configure simulation parameters such as cable types, solver, and scenario.",
    icon: "settings",
    category: "input" as const,
    defaultComplexity: "expert" as const,
  };

  readonly io = {
    inputs: [],
    outputs: ["advancedParams"],
    required: [],
  };

  readonly component = AdvancedParamsComponent;

  override validate(context: ConfiguratorContext) {
    if (!context.advancedParams) {
      return { valid: false, errors: ["Advanced parameters not configured."] };
    }
    return { valid: true };
  }
}

function AdvancedParamsComponent({ context, onUpdate }: ModuleProps) {
  const [isOpen, setIsOpen] = useState(true);

  const params = context.advancedParams ?? getDefaultAdvancedParameters();

  const handleChange = useCallback(
    (newParams: AdvancedParametersState) => {
      onUpdate({ advancedParams: newParams });
    },
    [onUpdate]
  );

  const handleReset = useCallback(() => {
    onUpdate({ advancedParams: getDefaultAdvancedParameters() });
  }, [onUpdate]);

  return (
    <div className="p-4">
      <AdvancedParametersDrawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        parameters={params}
        onParametersChange={handleChange}
        onReset={handleReset}
      />
      {!isOpen && (
        <button
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md"
          onClick={() => setIsOpen(true)}
        >
          Open Parameters
        </button>
      )}
    </div>
  );
}

export const advancedParamsModule = new AdvancedParamsModule();
