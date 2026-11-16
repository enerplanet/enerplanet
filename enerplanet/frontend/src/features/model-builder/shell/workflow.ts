/**
 * The default workflow the frame runs — a backend resource now, not a baked-in import (`spec/frame.md` §5;
 * plan `workflow-builder.md` §6, Stage 2).
 *
 * A workflow is an ordered list of nodes, and every part of the frame reads it: the workflow bar shows
 * where the session is, the steps panel shows every step's state, and `position.ts` derives both from
 * `(flow, registry, store)`. So the source's job is narrow and worth keeping pure: turn *untrusted*
 * configuration into exactly what the core already takes — a `Flow`, a `ModuleRegistry` and the seed ports
 * — and refuse a definition that could not be walked.
 *
 * `toWorkflow` is deliberately separate from the fetch below. The shape can then be exercised without a
 * fixture or a server, and `loadDefaultWorkflow` is the one binding that knows where the definition comes
 * from — it fetches it and composes it with the seed.
 *
 * Only the *definition* moved to the database. The seed stays a static `import`: it is the builder's own
 * starting data, not a document the backend owns, and the definition's own `seed` field is a fixture path the
 * test setup reads — the running builder never resolves it.
 */

import devSeed from "./testdata/dev-flow.json";
import { workflowService } from "../workflows/service";
import type { WorkflowRef } from "../core/artefact";
import type { Flow, FlowNode, ModuleRegistry, SeedPorts } from "../core/flow";
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
  /**
   * The seed file the definition names. Recorded rather than used, so the name is checkable against what
   * is actually loaded — the two must not drift.
   */
  seedFile: string;
  /**
   * What a session artefact points at instead of carrying a copy of the flow (`core/artefact.ts`). Built from
   * the definition's own `id` and `version`, so the reference is a fact about the workflow rather than a
   * constant some caller invented.
   */
  ref: WorkflowRef;
}

/**
 * Build a workflow from a definition, the modules it may place, and the seed.
 *
 * Refuses, rather than half-working later: a definition with no id, one that places nothing, a node whose
 * module nobody declared, two nodes sharing an id — the last because a node id is how history names a
 * position, so a duplicate makes the log ambiguous — and a `version` that is present but not a real one,
 * because a reference to a version that never existed is worse than no reference at all.
 */
export function toWorkflow(
  definition: unknown,
  entries: readonly BuilderModule[],
  seed: Readonly<ModelData>,
): Workflow {
  const raw = asRecord(definition);

  const id = asString(raw.id)?.trim();
  if (id === undefined || id.length === 0) {
    throw new Error("[model-builder] the workflow has no id");
  }

  const registry: Record<string, Module> = {};
  for (const entry of entries) registry[entry.module.id] = entry.module;

  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    throw new Error(`[model-builder] workflow "${id}" places no nodes`);
  }

  const flow: FlowNode[] = [];
  const seen = new Set<string>();

  raw.nodes.forEach((candidate, index) => {
    const node = asRecord(candidate);
    const nodeId = asString(node.id);

    if (nodeId === undefined) {
      throw new Error(`[model-builder] workflow "${id}" node ${index} has no id`);
    }
    if (seen.has(nodeId)) {
      throw new Error(
        `[model-builder] workflow "${id}" has a duplicate node id "${nodeId}" — a node id is how history names a position`,
      );
    }
    seen.add(nodeId);

    const moduleId = asString(node.moduleId);
    if (moduleId === undefined || registry[moduleId] === undefined) {
      throw new Error(
        `[model-builder] workflow "${id}" node "${nodeId}": moduleId "${moduleId}" is not declared`,
      );
    }

    const label = asString(node.label);
    const auto = typeof node.auto === "boolean" ? node.auto : undefined;

    flow.push({
      id: nodeId,
      moduleId,
      ...(label === undefined ? {} : { label }),
      ...(auto === undefined ? {} : { auto }),
    });
  });

  // A version that is present must be a real one: silently reading a `0` or a string as "v1" would record a
  // reference to a workflow that never existed. Absent means 1, because v1 is the only version there is until
  // flows become distributable (`spec/frame.md` §5).
  const rawVersion = raw.version;
  if (rawVersion !== undefined && (!Number.isInteger(rawVersion) || (rawVersion as number) < 1)) {
    throw new Error(`[model-builder] workflow "${id}" has an invalid version: ${String(rawVersion)}`);
  }
  const version = rawVersion === undefined ? 1 : (rawVersion as number);

  return {
    id,
    label: asString(raw.label) ?? id,
    flow,
    registry,
    seeds: Object.keys(seed) as PortKey[],
    initial: { ...seed },
    seedFile: asString(raw.seed) ?? "",
    ref: { id, version },
  };
}

/**
 * The workflow the frame loads: the definition from the database, the seed from the static import.
 *
 * Returns `undefined` when nothing is marked default — a *data condition* the shell reports (naming the fix,
 * "run `make seed`"), not an exception. The `list` call can reject, and `toWorkflow` can refuse a document
 * that names an unknown module; both throw, and the shell catches them, because a stored row is user data
 * and a white screen is not a report (plan §3). Only a developer-authored definition earned the throw the
 * frame used to take for granted.
 */
export async function loadDefaultWorkflow(): Promise<Workflow | undefined> {
  const rows = await workflowService.list();
  const row = rows.find((entry) => entry.is_default);
  if (row === undefined) return undefined;
  return toWorkflow(row.definition, MODULES, devSeed);
}

/** Narrowing, because a definition arrives as `unknown` the moment it stops being a local import. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
