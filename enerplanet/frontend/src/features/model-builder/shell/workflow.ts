/**
 * The default workflow the frame runs — a backend resource now, not a baked-in import.
 *
 * `toWorkflow` turns an untrusted configuration into a `Flow`, a `ModuleRegistry` and the seed ports, and
 * refuses a definition that could not be walked; `loadDefaultWorkflow` fetches the definition and composes
 * it with the seed.
 */

import devSeed from "./testdata/dev-flow.json";
import { workflowService } from "../workflows/service";
import { expand, type WorkflowLookup } from "../workflows/expand";
import { documentProblem, type RecommendedSection, type WorkflowDocument, type WorkflowNodeDocument } from "../workflows/types";
import type { WorkflowRef } from "../core/artefact";
import type { Flow, ModuleRegistry, SeedPorts } from "../core/flow";
import type { Module } from "../core/module";
import type { ModelData, PortKey } from "../core/ports";
import { MODULES } from "./moduleRegistry";
import type { BuilderModule } from "./contract";

/** A workflow as the frame needs it: where to walk, what to walk it with, and where the data starts. */
export interface Workflow {
  id: string;
  label: string;
  flow: Flow;
  registry: ModuleRegistry;
  /** Ports that exist before any node runs — the seed's own surface, which is what gates the first node. */
  seeds: SeedPorts;
  /** The projection the session starts from. */
  initial: ModelData;
  /** The seed file the definition names. Recorded rather than used, so the name is checkable against what is loaded. */
  seedFile: string;
  /** What a session artefact points at instead of carrying a copy of the flow (`core/artefact.ts`). */
  ref: WorkflowRef;
  /** The document this workflow was built from, kept whole so a consumer can read the definition. */
  document: WorkflowDocument;
}

/**
 * Build a workflow from a definition, the modules it may place, the documents its subflows resolve through,
 * and the seed.
 */
export function toWorkflow(
  definition: unknown,
  entries: readonly BuilderModule[],
  lookup: WorkflowLookup,
  seed: Readonly<ModelData>,
): Workflow {
  const raw = asRecord(definition);

  const id = asString(raw.id)?.trim();
  if (id === undefined || id.length === 0) {
    throw new Error("[model-builder] the workflow has no id");
  }

  // A fragment is inserted into another flow, never run as one of its own.
  if (raw.isSubflow === true) {
    throw new Error(
      `[model-builder] workflow "${id}" is a fragment (isSubflow) — it is authored to be inserted into another flow and cannot be run on its own`,
    );
  }

  const registry: Record<string, Module> = {};
  for (const entry of entries) registry[entry.module.id] = entry.module;

  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    throw new Error(`[model-builder] workflow "${id}" places no nodes`);
  }

  // Node ids must be present and unique among the nodes as authored.
  const seen = new Set<string>();
  raw.nodes.forEach((candidate, index) => {
    const nodeId = asString(asRecord(candidate).id);
    if (nodeId === undefined) {
      throw new Error(`[model-builder] workflow "${id}" node ${index} has no id`);
    }
    if (seen.has(nodeId)) {
      throw new Error(
        `[model-builder] workflow "${id}" has a duplicate node id "${nodeId}" — a node id is how history names a position`,
      );
    }
    seen.add(nodeId);
  });

  // A version that is present must be a real one: absent means 1.
  const rawVersion = raw.version;
  if (rawVersion !== undefined && (!Number.isInteger(rawVersion) || (rawVersion as number) < 1)) {
    throw new Error(`[model-builder] workflow "${id}" has an invalid version: ${String(rawVersion)}`);
  }
  const version = rawVersion === undefined ? 1 : (rawVersion as number);
  const label = asString(raw.label) ?? id;

  const document: WorkflowDocument = {
    id,
    version,
    label,
    nodes: raw.nodes as WorkflowNodeDocument[],
    // The follow-up sections a run may offer, carried through so the shell can read them off the finished terminal.
    ...(raw.recommended === undefined
      ? {}
      : { recommended: raw.recommended as Record<string, RecommendedSection[]> }),
  };

  // The `recommended` map is untrusted input, so it is refused here rather than mis-read after a run.
  const recommendedProblem = documentProblem(document);
  if (recommendedProblem !== undefined) {
    throw new Error(
      `[model-builder] workflow "${id}" has a malformed recommended map: ${recommendedProblem}`,
    );
  }

  const flow = expand(document, lookup, registry);

  return {
    id,
    label,
    flow,
    registry,
    seeds: Object.keys(seed) as PortKey[],
    initial: { ...seed },
    seedFile: asString(raw.seed) ?? "",
    ref: { id, version },
    document,
  };
}

/**
 * The workflow the frame loads: a requested definition from the database, or the default one, with the seed
 * from the static import.
 *
 * @returns `undefined` when nothing matched — a data condition the shell reports, not an exception.
 */
export async function loadDefaultWorkflow(requestedId?: string): Promise<Workflow | undefined> {
  const rows = await workflowService.list();
  const row =
    requestedId === undefined
      ? rows.find((entry) => entry.is_default)
      : rows.find((entry) => entry.definition.id === requestedId);
  if (row === undefined) return undefined;
  // Every row's document, keyed by the document's own id — the id a subflow references.
  const byId = new Map(rows.map((entry) => [entry.definition.id, entry.definition]));
  const lookup: WorkflowLookup = (workflowId) => byId.get(workflowId);
  return toWorkflow(row.definition, MODULES, lookup, devSeed);
}

/** Narrowing, because a definition arrives as `unknown` the moment it stops being a local import. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
