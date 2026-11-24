/**
 * The default workflow the frame runs — a backend resource now, not a baked-in import.
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
  /** The document this workflow was built from, kept whole so a consumer can read the definition. */
  document: WorkflowDocument;
}

/**
 * Build a workflow from a definition, the modules it may place, the documents its subflows resolve through,
 * and the seed.
 *
 * Refuses, rather than half-working later: a definition with no id, one that is a **fragment** (`isSubflow` —
 * authored to be inserted into another flow, never run as one of its own), one that places nothing, two
 * nodes sharing an id — the last because a node id is how history names a position, so a duplicate makes the
 * log ambiguous — and a `version` that is present but not a real one, because a reference to a version that
 * never existed is worse than no reference at all.
 *
 * The *flow* — the nodes the runtime walks, a subflow's expansion spliced in its place — is `expand`'s, not
 * this function's. That is why the undeclared-module check lives there now: it is the same check whether the
 * unnamed module sits at the root or inside a child workflow, and `expand` is the one place both are walked.
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

  // A fragment is inserted into another flow, never run as one of its own: the editor marks fragments and the
  // picker leaves them out, so this is the last place the rule can be enforced. Checked after the id so the
  // message can name the workflow the user has to fix.
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

  // Node ids must be present and unique among the nodes as authored. This is the document's own level: a
  // subflow's children are namespaced by `expand`, so their ids are a different question from these.
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

  // A version that is present must be a real one: silently reading a `0` or a string as "v1" would record a
  // reference to a workflow that never existed. Absent means 1, because v1 is the only version there is until
  // flows become distributable.
  const rawVersion = raw.version;
  if (rawVersion !== undefined && (!Number.isInteger(rawVersion) || (rawVersion as number) < 1)) {
    throw new Error(`[model-builder] workflow "${id}" has an invalid version: ${String(rawVersion)}`);
  }
  const version = rawVersion === undefined ? 1 : (rawVersion as number);
  const label = asString(raw.label) ?? id;

  // The nodes arrive as `unknown`; the document is built once, here, and `expand` is what walks it — the
  // module check, a subflow's expansion, and the composition refusals (a cycle, an unresolvable subflow) all
  // live there, so the loader does not carry a second copy of any of them.
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
 * One `GET /workflows` serves both halves of the load. It returns every workflow **with its definition**, so
 * the same list that names the default also resolves every subflow: the lookup is built from the rows as they
 * arrive, and no second request and no per-subflow fetch is made. A subflow's target that is not in the list
 * stays unresolved, and `toWorkflow` refuses it through `expand`.
 *
 * A `requestedId` names the workflow to run — the seam the picker will drive (a pathway is a
 * different load, so the builder is handed which flow to open). The request is matched against
 * the document's own id, the id a session references and a subflow resolves through, not the row's serial.
 * When it is absent the `is_default` row is the one loaded.
 *
 * Returns `undefined` when nothing matched — the default row for no request, or the named row for one that no
 * stored workflow carries. A *data condition* the shell reports (naming the fix), not an exception. The `list`
 * call can reject, and `toWorkflow` can refuse a document that is a fragment, names an unknown module, or
 * composes into a cycle or an unresolvable subflow; both throw, and the shell catches them, because a stored
 * row is user data and a white screen is not a report. Only a developer-authored definition earned
 * the throw the frame used to take for granted.
 */
export async function loadDefaultWorkflow(requestedId?: string): Promise<Workflow | undefined> {
  const rows = await workflowService.list();
  const row =
    requestedId === undefined
      ? rows.find((entry) => entry.is_default)
      : rows.find((entry) => entry.definition.id === requestedId);
  if (row === undefined) return undefined;
  // Every row's document, keyed by the document's own id — the id a subflow references. Built from the one
  // list call, so resolving a subflow costs no request.
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
