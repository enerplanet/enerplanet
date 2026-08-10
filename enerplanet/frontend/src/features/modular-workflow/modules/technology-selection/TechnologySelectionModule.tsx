import { useState, useCallback } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import type { Technology as ContextTechnology } from "../../types/context";
import { TechnologyDrawer } from "../../../configurator/region-selector/components/TechnologyDrawer";
import { TechParameterDialog } from "../../../configurator/region-selector/components/TechParameterDialog";
import type { Technology } from "../../../technologies/services/technologyService";

/**
 * Technology Selection module.
 *
 * Wraps the configurator's `TechnologyDrawer` + `TechParameterDialog`.
 * Reads `gridData` + `advancedParams`, writes `technologies` and
 * `techParameters` to context.
 */
export class TechnologySelectionModule extends BaseModule {
  readonly meta = {
    id: "technology-selection",
    name: "Technology Selection",
    description: "Select and configure technologies for the model.",
    icon: "zap",
    category: "input" as const,
    defaultComplexity: "basic" as const,
  };

  readonly io = {
    inputs: ["gridData", "advancedParams"],
    outputs: ["technologies", "techParameters"],
    required: ["gridData"],
  };

  readonly component = TechnologySelectionComponent;
}

function toContextTech(tech: Technology): ContextTechnology {
  return {
    ...tech,
    id: String(tech.key),
    name: tech.alias,
    type: String(tech.key),
  };
}

function TechnologySelectionComponent({ context, onUpdate }: ModuleProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [paramDialogOpen, setParamDialogOpen] = useState(false);

  const handleAddTech = useCallback(
    (tech: Technology) => {
      const existing = context.technologies ?? [];
      if (existing.some((t) => t.id === tech.key)) return;
      onUpdate({ technologies: [...existing, toContextTech(tech)] });
    },
    [context.technologies, onUpdate]
  );

  const handleRemoveTech = useCallback(
    (tech: Technology) => {
      const existing = context.technologies ?? [];
      onUpdate({ technologies: existing.filter((t) => t.id !== tech.key) });
    },
    [context.technologies, onUpdate]
  );

  return (
    <div className="p-4 space-y-3">
      <div className="text-sm text-muted-foreground">
        {context.technologies?.length
          ? `${context.technologies.length} technologies selected.`
          : "No technologies selected yet."}
      </div>
      <button
        className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md"
        onClick={() => setIsOpen(true)}
      >
        Select Technologies
      </button>
      <button
        className="px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded-md"
        onClick={() => setParamDialogOpen(true)}
      >
        Configure Parameters
      </button>
      <TechnologyDrawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onTechDragStart={() => {}}
        onTechDragEnd={() => {}}
        onAddTechToAll={handleAddTech}
        onRemoveTechFromAll={handleRemoveTech}
        appliedTechKeys={(context.technologies ?? []).map((t) => t.id)}
      />
      <TechParameterDialog
        open={paramDialogOpen}
        onOpenChange={setParamDialogOpen}
        technology={null}
        building={null}
        onSave={(techKey, constraints) => {
          onUpdate({ techParameters: { [techKey]: constraints } });
        }}
        onClose={() => setParamDialogOpen(false)}
      />
    </div>
  );
}

export const technologySelectionModule = new TechnologySelectionModule();
