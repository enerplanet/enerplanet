/**
 * The influence-honesty prober — the generated contract test (`Modules.md` §6, case T8).
 *
 * A module *declares* which outputs each input can invalidate (`affect`). This prober verifies
 * the declaration instead of trusting it: perturb one input at a time, run the module against
 * both a baseline and the perturbed store, and compare the fingerprints of its declared ports.
 *
 * **Why the check is asymmetric.** Only *under*-declaration is dangerous: elision (T20) skips a
 * node whose affecting inputs look unchanged, so an undeclared edge lets a node be skipped that
 * should have re-run — silent stale data. Over-declaration merely prunes more than necessary,
 * which costs work and nothing else. So under-declared fails the module; over-declared is
 * reported for information.
 *
 * The probe runs through the real engine, so it also exercises the write boundary: a module
 * that blind-writes, or writes outside its params, fails here for that reason too.
 */

import { createEngine } from "./engine";
import { fingerprint } from "./fingerprint";
import type { Module } from "./module";
import type { ModelData, PortKey } from "./ports";
import { createStore } from "./store";

export interface InfluenceProbe {
  /**
   * Fixture values, keyed by port.
   *
   * Supply every port the module declares **and any port it might read through `ctx.store`** —
   * an undeclared store read is the sneakiest way to under-declare, and it is only caught if
   * the port is in here to be perturbed.
   */
  samples: Partial<ModelData>;
  /** Overrides for ports whose fixture `perturb` cannot meaningfully vary. */
  perturbations?: Partial<ModelData>;
}

export interface InfluenceReport {
  /** Probed input → the declared ports whose value changed when it was perturbed. */
  observed: Partial<Record<PortKey, PortKey[]>>;
  /** Observed but not declared — **unsafe**: elision would skip a node that should re-run. */
  underDeclared: Partial<Record<PortKey, PortKey[]>>;
  /** Declared but never observed — safe: it costs extra prunes, never correctness. */
  overDeclared: Partial<Record<PortKey, PortKey[]>>;
  /** Declared inputs the probe had no sample for, so it cannot vouch for them. */
  unprobed: PortKey[];
}

/**
 * Derive a module's *observed* influence and diff it against its declaration.
 *
 * @throws when the module cannot be probed at all — a `required` port without a sample, or a
 * perturbation that makes `run()` fail (supply a `perturbations` override for that port).
 */
export async function deriveInfluence(module: Module, probe: InfluenceProbe): Promise<InfluenceReport> {
  const ports = module.params.map((param) => param.port);
  const probed = Object.keys(probe.samples) as PortKey[];
  const baseline = await runOnce(module, ports, probe.samples);

  const observed: Partial<Record<PortKey, PortKey[]>> = {};

  for (const input of probed) {
    const perturbation = probe.perturbations?.[input] ?? perturb(probe.samples[input]);
    const after = await runOnce(
      module,
      ports,
      { ...probe.samples, [input]: perturbation },
      input,
    );

    // A port the module both reads and rewrites is a *self-edge* — inherent to read → rewrite,
    // and never something invalidation has to declare (a port cannot invalidate itself).
    const changed = ports.filter(
      (port) => port !== input && fingerprint(baseline[port]) !== fingerprint(after[port]),
    );
    if (changed.length > 0) observed[input] = changed;
  }

  const underDeclared: Partial<Record<PortKey, PortKey[]>> = {};
  const overDeclared: Partial<Record<PortKey, PortKey[]>> = {};

  for (const input of probed) {
    const declared = module.affect[input] ?? [];
    const seen = observed[input] ?? [];

    const undeclared = seen.filter((port) => !declared.includes(port));
    const neverSeen = declared.filter((port) => !seen.includes(port));

    if (undeclared.length > 0) underDeclared[input] = undeclared;
    if (neverSeen.length > 0) overDeclared[input] = neverSeen;
  }

  const unprobed = (Object.keys(module.affect) as PortKey[]).filter((port) => !probed.includes(port));

  return { observed, underDeclared, overDeclared, unprobed };
}

/** Fail a module whose `affect` omits an edge it actually has. */
export function assertInfluenceHonest(moduleId: string, report: InfluenceReport): void {
  const edges = Object.entries(report.underDeclared);
  if (edges.length === 0) return;

  const detail = edges
    .map(([input, outputs]) => `"${input}" → ${(outputs ?? []).map((port) => `"${port}"`).join(", ")}`)
    .join("; ");

  throw new Error(
    `[model-builder] module "${moduleId}" under-declares its influence: ${detail}. ` +
      "Add the missing edge to affect — elision trusts it, so an undeclared edge can leave stale data.",
  );
}

/** Run a module against a fixture store and report its declared ports' values. */
async function runOnce(
  module: Module,
  ports: readonly PortKey[],
  samples: Partial<ModelData>,
  perturbedPort?: PortKey,
): Promise<Partial<ModelData>> {
  for (const param of module.params) {
    if (param.required === true && samples[param.port] === undefined) {
      throw new Error(
        `[model-builder] cannot probe module "${module.id}": required port "${param.port}" has no sample.`,
      );
    }
  }

  const store = createStore({ ...samples } as ModelData);

  try {
    await createEngine(store).runModule(module, { id: module.id });
  } catch (err) {
    if (perturbedPort === undefined) throw err;
    throw new Error(
      `[model-builder] cannot probe module "${module.id}": perturbing "${perturbedPort}" made run() fail ` +
        `(${err instanceof Error ? err.message : String(err)}). Supply a perturbations override for that port.`,
    );
  }

  const values: Record<string, unknown> = {};
  for (const port of ports) values[port] = store.data[port];
  return values as Partial<ModelData>;
}

const PERTURBED_FEATURE: GeoJSON.Feature = {
  type: "Feature",
  properties: { __perturbed: true },
  geometry: { type: "Point", coordinates: [0, 0] },
};

/**
 * Produce a different value *of the same kind*, so a module notices the change.
 *
 * Collections gain an element (shape-preserving for nested arrays), records gain a key,
 * primitives are bumped. `undefined` becomes a value so an absent port can be probed too.
 */
export function perturb(value: unknown): unknown {
  if (value === undefined || value === null) return { perturbed: true };

  switch (typeof value) {
    case "string":
      return value === "" ? "perturbed" : `${value}!`;
    case "number":
      return value + 1;
    case "boolean":
      return !value;
    case "object":
      break;
    default:
      return value;
  }

  if (Array.isArray(value)) {
    const [first] = value;
    // Structure-preserving for ring lists (`[[[lon, lat]]]`): append a clone, not a foreign type.
    const appended =
      first !== undefined && typeof first === "object" ? clone(first) : perturb(first);
    return [...value, appended];
  }

  const record = value as Record<string, unknown>;
  if (record.type === "FeatureCollection" && Array.isArray(record.features)) {
    return { ...record, features: [...(record.features as unknown[]), PERTURBED_FEATURE] };
  }

  return { ...record, __perturbed: true };
}

/** Store values are JSON-safe by contract, so a JSON round-trip is a sufficient clone. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
