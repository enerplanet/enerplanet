/**
 * The core's public surface — what a module is allowed to depend on.
 *
 * A module imports `@model-builder/core` and nothing else: the contract types (the module contract, the
 * view contract, the port surface) are all it needs, and everything here must stay free of app imports.
 * `fixtures.ts` is deliberately not exported — it is for the core's own tests.
 */

export * from "./ports";
export * from "./module";
export * from "./view";
export * from "./errors";
export * from "./diff";
export * from "./store";
export * from "./engine";
export * from "./fingerprint";
export * from "./influence";
export * from "./invalidator";
export * from "./flow";
export * from "./replay";
export * from "./position";
export * from "./rerun";
export * from "./artefact";
export * from "./branch";
export * from "./prompt";
export * from "./testSupport";
export * from "./mapStack";
