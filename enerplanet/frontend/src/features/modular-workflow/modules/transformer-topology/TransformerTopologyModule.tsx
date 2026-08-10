import { useState, useEffect, useCallback } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import { pylovoService } from "../../../configurator/services/pylovoService";
import { TransformerDialog } from "../../../configurator/region-selector/components/TransformerDialog";

/**
 * Transformer Topology module.
 *
 * Wraps the configurator's `TransformerDialog` and transformer service calls.
 * Reads `gridData` + `gridResultIds`, writes `transformers` and
 * `transformerAssignments` to context.
 */
export class TransformerTopologyModule extends BaseModule {
  readonly meta = {
    id: "transformer-topology",
    name: "Transformer Topology",
    description: "Configure transformers and building assignments.",
    icon: "network",
    category: "simulation" as const,
    defaultComplexity: "expert" as const,
  };

  readonly io = {
    inputs: ["gridData", "gridResultIds"],
    outputs: ["transformers", "transformerAssignments"],
    required: ["gridData", "gridResultIds"],
  };

  readonly component = TransformerTopologyComponent;
}

function TransformerTopologyComponent({ context, onUpdate }: ModuleProps) {
  const [sizes, setSizes] = useState<{ kva: number; cost_eur: number }[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    pylovoService
      .getTransformerSizes()
      .then((s) => {
        if (!cancelled) setSizes(s.map((x) => ({ kva: x.kva, cost_eur: x.cost_eur })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAddTransformer = useCallback(
    async (kva: number) => {
      const gridResultIds = context.gridResultIds ?? [];
      const result = await pylovoService.addTransformer({
        coordinates: [0, 0],
        kva,
        grid_result_ids: gridResultIds,
      });
      onUpdate({
        transformers: result.transformer,
        transformerAssignments: (result.reassigned_buildings?.features ?? []).map(
          (f: { properties?: Record<string, unknown> | null }) => ({
            buildingId: Number((f.properties ?? {}).osm_id ?? 0),
            transformerId: result.new_grid_id,
          })
        ),
      });
    },
    [context.gridResultIds, onUpdate]
  );

  return (
    <div className="p-4 space-y-3">
      <div className="text-sm text-muted-foreground">
        {context.transformers ? "Transformers configured." : "No transformers configured yet."}
      </div>
      <button
        className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md"
        onClick={() => setDialogOpen(true)}
      >
        Manage Transformers
      </button>
      <TransformerDialog
        open={dialogOpen}
        selectedTransformer={null}
        transformerSizes={sizes}
        onClose={() => setDialogOpen(false)}
        onChangeKva={() => {}}
        onOpenChange={setDialogOpen}
        mode="add"
        onAddTransformer={handleAddTransformer}
      />
    </div>
  );
}

export const transformerTopologyModule = new TransformerTopologyModule();
