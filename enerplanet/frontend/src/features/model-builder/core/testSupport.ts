/**
 * Test support for module authors.
 *
 * A module's test should not have to re-derive the rules of the contract: it should assert them. These
 * two helpers are what make a module test a handful of lines — the contract checks below mirror what the
 * core enforces at runtime (an undeclared write, anti-clobber, the `required` gate, verified `affect`),
 * so a module that passes them behaves the same way in any host.
 *
 * It lives in the core, next to the contract it checks, because a module may only depend on
 * `@model-builder/core` — and because these are rules of the core, not of any one host.
 *
 * There is no DOM test environment in this app (no `@testing-library`, no jsdom), so a module's UI is
 * covered by these contract and logic checks rather than by rendering. Adding a DOM environment is a
 * separate decision — one worth making deliberately, because a real render test needs a good deal more
 * scaffolding than it looks, and it belongs in a module's own workspace, not in the app's.
 */

import { createEngine } from "./engine";
import { declaredPorts, requiredPorts, REGIONS, type Module, type ValidationIssue } from "./module";
import type { PortKey } from "./ports";
import { createStore, type Store } from "./store";
import type { BuilderModule } from "./view";

/** One rule the contract checks, as a sentence a module author can act on. */
export type ContractIssue = string;

/**
 * What these helpers actually need: a module and its mock. The UI is deliberately not part of the
 * shape — nothing here renders, because there is no DOM test environment to render into.
 */
export interface ModuleUnderTest {
  module: Module;
  mock?: BuilderModule["mock"];
}

/**
 * Everything wrong with a module's declaration, judged without running it.
 *
 * Used by a module's own test — `expect(contractIssues(example)).toEqual([])` — so the rules are asserted
 * where the module lives rather than trusted.
 */
export function contractIssues(entry: ModuleUnderTest): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const { module, mock } = entry;

  if (module.id.trim().length === 0) issues.push("the module has no id");

  const declared = new Set<PortKey>(declaredPorts(module));
  if (declared.size === 0) issues.push("the module declares no ports — nothing it may read or write");

  // A required port the mock does not provide can never run in isolation, which is the whole point of
  // having a mock: it must satisfy everything the module says it needs.
  for (const port of requiredPorts(module)) {
    if (mock?.[port] === undefined) {
      issues.push(`required port "${port}" is missing from mock — the module cannot run in isolation`);
    }
  }

  // `affect` is a claim about ports the module knows: listing an output it never declares is a typo or a
  // misunderstanding, and the influence prober will fail on it anyway.
  issues.push(...affectIssues(module, declared));

  for (const region of module.layout) {
    if (!REGIONS.includes(region)) issues.push(`layout names an unknown region "${region}"`);
  }

  // A port key that does not exist is *not* checked here on purpose: `PortKey` is a union of literal
  // keys, so `{ port: "mvlines" }` is a compile error at the definition site — tsc catches it earlier and
  // more precisely than a runtime helper could.

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

/**
 * Run a module against a scratch store seeded with its mock — the isolated behaviour of the module, with
 * the real engine, so the write boundary and the cascade behave exactly as they do in a host.
 */
export async function runInScratch(entry: ModuleUnderTest): Promise<{
  store: Store;
  error?: Error;
  /** The module's own completeness verdict, asked *before* the run — the gate a host acts on. */
  issues: readonly ValidationIssue[];
}> {
  const store = createStore({ ...(entry.mock ?? {}) });
  const engine = createEngine(store);

  // `validate()` is a gate on what the node is about to work with, so it is asked *before* the run:
  // this is the verdict the flow and the save node act on ("what is missing").
  const issues = entry.module.validate?.({ store: store.data }) ?? [];

  let error: Error | undefined;
  try {
    await engine.runModule(entry.module, { id: entry.module.id });
  } catch (thrown) {
    error = thrown instanceof Error ? thrown : new Error(String(thrown));
  }

  return { store, ...(error === undefined ? {} : { error }), issues };
}
