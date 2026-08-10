import { useState, useEffect, useCallback } from "react";
import { BaseModule } from "../base/BaseModule";
import type { ModuleProps } from "../../types/module";
import { pylovoService } from "../../../configurator/services/pylovoService";
import { TransformerDialog } from "../../../configurator/region-selector/components/TransformerDialog";
import { useAuthStore } from "../../../../store/auth-store";

/**
 * Area Edit (Network Adjustment) module.
 *
 * Lets the user adjust the network recommended by pylovo: add extra
 * transformers, delete or move transformers, and assign buildings to
 * transformers. This is an optional interactive step.
 *
 * Reads `gridData` + `gridResultIds`, writes `transformers` and
 * `transformerAssignments` to context.
 */
export class AreaEditModule extends BaseModule {
  readonly meta = {
    id: "area-edit",
    name: "Area Edit",
    description: "Adjust the network: add, move or remove transformers and assign buildings.",
    icon: "network",
    category: "simulation" as const,
    defaultComplexity: "expert" as const,
  };

  readonly io = {
    inputs: ["gridData", "gridResultIds"],
    outputs: ["transformers", "transformerAssignments"],
    required: ["gridData", "gridResultIds"],
  };

  readonly component = AreaEditComponent;
}

interface TransformerEntry {
  gridResultId: number;
  osmId: string;
  ratedPowerKva: number;
}

function AreaEditComponent({ context, onUpdate }: ModuleProps) {
  const [sizes, setSizes] = useState<{ kva: number; cost_eur: number }[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<TransformerEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const gridData = context.gridData;
  const gridResultIds = context.gridResultIds ?? [];

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

  // Extract transformers from the generated grid data
  const transformers: TransformerEntry[] = useCallback(() => {
    const features = gridData?.transformers?.features ?? [];
    return features
      .map((f: any) => {
        const props = f?.properties ?? {};
        const gridResultId = Number(
          props.grid_result_id ?? props.transformer_id ?? props.trafo_id ?? 0
        );
        if (!gridResultId) return null;
        return {
          gridResultId,
          osmId: String(props.osm_id ?? props.id ?? ""),
          ratedPowerKva: Number(props.rated_power_kva ?? props.kva ?? 0),
        };
      })
      .filter((t): t is TransformerEntry => t !== null);
  }, [gridData])();

  const getUserId = useCallback(() => {
    const user = useAuthStore.getState().user;
    return user?.id ? String(user.id) : undefined;
  }, []);

  const handleAddTransformer = useCallback(
    async (kva: number) => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const result = await pylovoService.addTransformer({
          coordinates: [0, 0],
          kva,
          grid_result_ids: gridResultIds,
          user_id: getUserId(),
          model_id: context.modelId,
          draft_id: context.draftId,
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
        setMessage(`Transformer added (${result.reassigned_count} buildings reassigned).`);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to add transformer");
      } finally {
        setBusy(false);
      }
    },
    [gridResultIds, getUserId, context.modelId, context.draftId, onUpdate]
  );

  const handleDeleteTransformer = useCallback(
    async (gridResultId: number) => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const result = await pylovoService.deleteTransformer(
          gridResultId,
          getUserId(),
          context.modelId,
          context.draftId
        );
        setMessage(
          `Transformer removed (${result.reassigned_buildings_count} buildings reassigned).`
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to delete transformer");
      } finally {
        setBusy(false);
      }
    },
    [getUserId, context.modelId, context.draftId]
  );

  const handleMoveTransformer = useCallback(
    async (gridResultId: number) => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const result = await pylovoService.moveTransformer(
          gridResultId,
          [0, 0],
          getUserId(),
          context.modelId,
          context.draftId
        );
        setMessage(`Transformer moved (${result.buildings_count} buildings).`);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to move transformer");
      } finally {
        setBusy(false);
      }
    },
    [getUserId, context.modelId, context.draftId]
  );

  const handleAssignBuilding = useCallback(
    async (buildingOsmId: string, targetGridId: number) => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const result = await pylovoService.assignBuilding(
          buildingOsmId,
          targetGridId,
          getUserId(),
          context.modelId,
          context.draftId
        );
        setMessage(`Building assigned to transformer ${result.new_grid_id}.`);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to assign building");
      } finally {
        setBusy(false);
      }
    },
    [getUserId, context.modelId, context.draftId]
  );

  if (!gridData) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No grid generated yet. Go back and generate the grid first.
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="text-sm text-muted-foreground">
        Adjust the network recommended by pylovo. You can add extra transformers, move or remove
        existing ones, and assign buildings to transformers.
      </div>

      {message && <div className="text-sm text-green-600">{message}</div>}
      {error && <div className="text-sm text-destructive">Error: {error}</div>}
      {busy && <div className="text-sm text-muted-foreground">Working…</div>}

      <div className="flex items-center gap-2">
        <button
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          onClick={() => {
            setSelected(null);
            setDialogOpen(true);
          }}
          disabled={busy}
        >
          Add Transformer
        </button>
      </div>

      {transformers.length > 0 ? (
        <div className="space-y-2">
          <div className="text-sm font-medium">Transformers ({transformers.length})</div>
          {transformers.map((t) => (
            <div
              key={t.gridResultId}
              className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium">#{t.gridResultId}</span>
                {t.ratedPowerKva > 0 && (
                  <span className="ml-2 text-muted-foreground">{t.ratedPowerKva} kVA</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                  onClick={() => {
                    setSelected(t);
                    setDialogOpen(true);
                  }}
                  disabled={busy}
                >
                  Manage
                </button>
                <button
                  className="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  onClick={() => handleDeleteTransformer(t.gridResultId)}
                  disabled={busy}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">No transformers found in the grid.</div>
      )}

      <TransformerDialog
        open={dialogOpen}
        selectedTransformer={selected}
        transformerSizes={sizes}
        onClose={() => setDialogOpen(false)}
        onChangeKva={() => {}}
        onOpenChange={setDialogOpen}
        mode={selected ? "view" : "add"}
        onAddTransformer={handleAddTransformer}
        onDeleteTransformer={handleDeleteTransformer}
        onMoveTransformer={(id) => handleMoveTransformer(id)}
      />
    </div>
  );
}

export const areaEditModule = new AreaEditModule();
