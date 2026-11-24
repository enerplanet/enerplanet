/**
 * Test support for module authors.
 *
 * The contract checks a module test asserts, mirroring what the core enforces at runtime (an undeclared
 * write, anti-clobber, the `required` gate, verified `affect`). It lives in the core because a module may
 * only depend on `@model-builder/core`. There is no DOM test environment here, so a module's UI is covered
 * by these checks rather than by rendering.
 */

import { createEngine } from "./engine";
import { declaredPorts, requiredPorts, REGIONS, type Module, type ValidationIssue } from "./module";
import type { PortKey } from "./ports";
import { createStore, type Store } from "./store";
import type { BuilderModule } from "./view";

/** One rule the contract checks, as a sentence a module author can act on. */
export type ContractIssue = string;

/** What these helpers need: a module and its mock. Nothing here renders. */
export interface ModuleUnderTest {
  module: Module;
  mock?: BuilderModule["mock"];
}

/** Everything wrong with a module's declaration, judged without running it. */
export function contractIssues(entry: ModuleUnderTest): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const { module, mock } = entry;

  if (module.id.trim().length === 0) issues.push("the module has no id");

  const declared = new Set<PortKey>(declaredPorts(module));
  if (declared.size === 0) issues.push("the module declares no ports — nothing it may read or write");

  // A mock must satisfy every port the module says it needs.
  for (const port of requiredPorts(module)) {
    if (mock?.[port] === undefined) {
      issues.push(`required port "${port}" is missing from mock — the module cannot run in isolation`);
    }
  }

  // `affect` may only name ports the module declares.
  issues.push(...affectIssues(module, declared));

  // `auto` says the module runs itself, so it needs a `run()`; `overlay` is not required.
  if (module.auto === true && module.run === undefined) {
    issues.push("the module is declared auto but has no run() — an automatic step that does nothing");
  }

  for (const region of module.layout) {
    if (!REGIONS.includes(region)) issues.push(`layout names an unknown region "${region}"`);
  }

  // A port key that does not exist is a compile error at the definition site, so it is not checked here.

  return issues;
}

/** Every `affect` entry that names a port the module never declares. */
function affectIssues(module: Module, declared: ReadonlySet<PortKey>): ContractIssue[] {
  const issues: ContractIssue[] = [];

  for (const [input, outputs] of Object.entries(module.affect)) {
    if (!declared.has(input as PortKey)) {
      issues.push(`affect declares an input "${input}" that params never lists`);
    }
    for (const output of outputs ?? []) {
      if (!declared.has(output)) {
        issues.push(`affect declares an output "${output}" that params never lists`);
      }
    }
  }

  return issues;
}

/** Run a module against a scratch store seeded with its mock, through the real engine. */
export async function runInScratch(entry: ModuleUnderTest): Promise<{
  store: Store;
  error?: Error;
  /** The module's own completeness verdict, asked *before* the run — the gate a host acts on. */
  issues: readonly ValidationIssue[];
}> {
  const store = createStore({ ...(entry.mock ?? {}) });
  const engine = createEngine(store);

  // `validate()` is a gate, asked before the run — the verdict the flow and the save node act on.
  const issues = entry.module.validate?.({ store: store.data }) ?? [];

  let error: Error | undefined;
  try {
    await engine.runModule(entry.module, { id: entry.module.id, moduleId: entry.module.id });
  } catch (thrown) {
    error = thrown instanceof Error ? thrown : new Error(String(thrown));
  }

  return { store, ...(error === undefined ? {} : { error }), issues };
}
