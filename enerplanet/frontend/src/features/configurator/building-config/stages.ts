// Stage registry for the per-building configurator. The workflow is an ordered
// list of stages; adding, removing or reordering one is an edit to STAGES only.
// Each stage's editor component is filled in by its own issue (#30-#34); until
// then the shell renders a placeholder.

import type { ComponentType } from "react";

export type StageId =
  | "metadata"
  | "geometry"
  | "technologies"
  | "costs"
  | "equipment";

export interface StageProps {
  /** osm_id of the building being configured. */
  buildingId: string;
}

export interface StageDef {
  id: StageId;
  label: string;
  /** Editor for this stage. Undefined until the stage issue lands. */
  Component?: ComponentType<StageProps>;
}

export const STAGES: readonly StageDef[] = [
  { id: "metadata", label: "Metadata" },
  { id: "geometry", label: "Geometry" },
  { id: "technologies", label: "Technologies" },
  { id: "costs", label: "Costs" },
  { id: "equipment", label: "Equipment" },
] as const;

export const FIRST_STAGE: StageId = STAGES[0].id;

const IDS = new Set<string>(STAGES.map((s) => s.id));

export function isStageId(value: string | null | undefined): value is StageId {
  return value != null && IDS.has(value);
}

export function stageIndex(id: StageId): number {
  return STAGES.findIndex((s) => s.id === id);
}

export function stageDef(id: StageId): StageDef {
  return STAGES[stageIndex(id)];
}

/** Next stage id, or null if already on the last stage. */
export function nextStage(id: StageId): StageId | null {
  const next = STAGES[stageIndex(id) + 1];
  return next ? next.id : null;
}

/** Previous stage id, or null if already on the first stage. */
export function prevStage(id: StageId): StageId | null {
  const i = stageIndex(id);
  return i > 0 ? STAGES[i - 1].id : null;
}
