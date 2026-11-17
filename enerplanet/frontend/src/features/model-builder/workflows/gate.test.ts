/**
 * The gate rule (plan §3). These are the cases the editor's whole promise rests on: a module becomes
 * addable exactly when its `required` ports are produced by the chain, and stays unavailable otherwise —
 * with the port it is waiting for named, never hidden. The one thing not offered at all is a host module,
 * which cannot be a step: it declares no region to render.
 *
 * Written failing first.
 */
import { describe, expect, it } from "vitest";
import type { FlowNode, ModuleRegistry } from "../core/flow";
import type { Module, Param } from "../core/module";
import type { BuilderModule } from "../shell/contract";
import {
  fragmentRequiredPorts,
  missingPorts,
  paletteFor,
  producedPorts,
  subflowVerdict,
  unmetRequiredPorts,
} from "./gate";
import type { WorkflowDocument, WorkflowNodeDocument } from "./types";

/**
 * A catalogue entry with just the surface the gate reads.
 *
 * A region by default, because a module that declares one is what the palette is for; `HOST` below passes
 * none, which is the whole difference the last test is about.
 */
function entry(id: string, params: Param[], layout: Module["layout"] = ["sidebar"]): BuilderModule {
  const module: Module = { id, name: id, params, affect: {}, layout };
  return { module, Component: () => null };
}

const BASE = entry("base", [{ port: "modelName" }]);
const CONSUMER = entry("consumer", [{ port: "buildings", required: true }]);
const SECOND = entry("second", [{ port: "buildings", required: true }, { port: "coordinates" }]);
const THIRD = entry("third", [{ port: "coordinates", required: true }]);

/** A host module: no region declared, so nothing to render and no place in a flow (`isHostModule`). */
const HOST = entry("host", [], []);

const CATALOGUE = [BASE, CONSUMER, SECOND, THIRD];

const node = (id: string, moduleId: string): WorkflowNodeDocument => ({ id, moduleId });

/** A document with just the fields the verdict reads. */
const doc = (id: string, nodes: WorkflowNodeDocument[], label = id): WorkflowDocument => ({
  id,
  version: 1,
  label,
  nodes,
});

/** The lookup seam: the stored documents a subflow resolves through. Empty when nothing is stored. */
const lookupFrom = (...documents: WorkflowDocument[]) => {
  const byId = new Map(documents.map((document) => [document.id, document]));
  return (workflowId: string): WorkflowDocument | undefined => byId.get(workflowId);
};

/** No stored documents — a subflow resolves to nothing. */
const noLookup = (): WorkflowDocument | undefined => undefined;

/** The module registry `subflowVerdict` flattens through, built from a catalogue. */
const registryFrom = (...catalogue: BuilderModule[]): ModuleRegistry =>
  Object.fromEntries(catalogue.map((entry) => [entry.module.id, entry.module]));

describe("a module is addable only when the chain produces its required ports", () => {
  it("offers a module that requires nothing on an empty chain", () => {
    const [base] = paletteFor(CATALOGUE, [], noLookup);
    expect(base.module.module.id).toBe("base");
    expect(base.requires).toEqual([]);
    expect(base.available).toBe(true);
  });

  it("refuses a module whose required port the chain has not produced, naming the port", () => {
    const consumer = paletteFor(CATALOGUE, [], noLookup).find((p) => p.module.module.id === "consumer");
    expect(consumer?.available).toBe(false);
    expect(consumer?.missing).toEqual(["buildings"]);
  });

  it("makes it addable once a module before it produces that port", () => {
    const chain = [node("base", "base"), node("second", "second")];
    const consumer = paletteFor(CATALOGUE, chain, noLookup).find((p) => p.module.module.id === "consumer");
    expect(consumer?.available).toBe(true);
    expect(consumer?.missing).toEqual([]);
  });

  it("reads production from the whole chain, not only its last module", () => {
    // `second` produces `buildings`; `third` (later) does not. A module needing only `buildings` is still
    // satisfied, because production accumulates across the chain.
    const chain = [node("base", "base"), node("second", "second"), node("third", "third")];
    const produced = producedPorts(chain, CATALOGUE, noLookup);
    expect(produced.has("buildings")).toBe(true);
    expect(produced.has("coordinates")).toBe(true);
  });

  it("lists every node module, in catalogue order, and never hides one", () => {
    const palette = paletteFor(CATALOGUE, [], noLookup);
    expect(palette.map((p) => p.module.module.id)).toEqual(["base", "consumer", "second", "third"]);
  });

  it("does not offer a host module — it declares no region, so it cannot be a step", () => {
    const palette = paletteFor([...CATALOGUE, HOST], [], noLookup);

    expect(palette.map((p) => p.module.module.id)).toEqual(["base", "consumer", "second", "third"]);
  });

  it("still refuses a module when only some of its required ports are present", () => {
    const chain = [node("base", "base"), node("second", "second")];
    const third = paletteFor(CATALOGUE, chain, noLookup).find((p) => p.module.module.id === "third");
    expect(third?.available).toBe(true); // `second` produced coordinates too

    const partial = paletteFor(CATALOGUE, [node("base", "base")], noLookup).find(
      (p) => p.module.module.id === "third",
    );
    expect(partial?.available).toBe(false);
    expect(partial?.missing).toEqual(["coordinates"]);
  });

  it("treats an unknown module in the chain as producing nothing — a data condition, not a crash", () => {
    expect(
      missingPorts(CONSUMER.module, producedPorts([node("ghost", "not-in-catalogue")], CATALOGUE, noLookup)),
    ).toEqual(["buildings"]);
  });
});

describe("a subflow node contributes its expansion's ports", () => {
  it("reads the ports the referenced workflow's modules produce", () => {
    // `second` produces `buildings` and `coordinates`; placed inside a subflow they must still count.
    const inner = doc("inner", [node("p", "second")]);
    const chain: WorkflowNodeDocument[] = [{ id: "s", workflows: ["inner"] }];

    const produced = producedPorts(chain, CATALOGUE, lookupFrom(inner));
    expect(produced.has("buildings")).toBe(true);
    expect(produced.has("coordinates")).toBe(true);
  });

  it("descends a subflow inside a subflow", () => {
    const leaf = doc("leaf", [node("p", "second")]);
    const mid = doc("mid", [{ id: "l", workflows: ["leaf"] }]);
    const chain: WorkflowNodeDocument[] = [{ id: "s", workflows: ["mid"] }];

    expect([...producedPorts(chain, CATALOGUE, lookupFrom(mid, leaf))].sort()).toEqual([
      "buildings",
      "coordinates",
    ]);
  });

  it("makes a module addable when a subflow earlier in the chain produces its required port", () => {
    const inner = doc("inner", [node("p", "second")]);
    const chain: WorkflowNodeDocument[] = [{ id: "s", workflows: ["inner"] }];

    const consumer = paletteFor(CATALOGUE, chain, lookupFrom(inner)).find((p) => p.module.module.id === "consumer");
    expect(consumer?.available).toBe(true);
  });

  it("contributes nothing for a subflow nobody stores, rather than crashing", () => {
    const chain: WorkflowNodeDocument[] = [{ id: "s", workflows: ["ghost"] }, node("base", "base")];
    expect([...producedPorts(chain, CATALOGUE, noLookup)]).toEqual(["modelName"]);
  });

  it("stops at a cyclic composition rather than looping, contributing what it reaches first", () => {
    // `self` references itself, then places `base`. The gate is editor guidance, not a core invariant, so a
    // cycle must not throw here; it contributes the modules down the non-recursive branch.
    const self = doc("self", [{ id: "loop", workflows: ["self"] }, node("p", "base")]);
    const chain: WorkflowNodeDocument[] = [{ id: "s", workflows: ["self"] }];

    expect([...producedPorts(chain, CATALOGUE, lookupFrom(self))]).toEqual(["modelName"]);
  });
});

describe("the candidate verdict a subflow picker renders", () => {
  const REGISTRY = registryFrom(...CATALOGUE);

  it("accepts a candidate whose expansion needs nothing the chain lacks", () => {
    const candidate = doc("cand", [node("b", "base")]);
    expect(subflowVerdict(candidate, new Set(), REGISTRY, lookupFrom(candidate), "editing")).toEqual({ ok: true });
  });

  it("refuses a candidate whose expansion needs a port the chain has not produced, naming it", () => {
    const candidate = doc("cand", [node("c", "consumer")]); // needs `buildings`
    expect(subflowVerdict(candidate, new Set(), REGISTRY, lookupFrom(candidate), "editing")).toEqual({
      ok: false,
      reason: "missing",
      missing: ["buildings"],
    });
  });

  it("accepts a candidate whose requirement the chain already provides", () => {
    const candidate = doc("cand", [node("c", "consumer")]);
    expect(subflowVerdict(candidate, new Set(["buildings"]), REGISTRY, lookupFrom(candidate), "editing")).toEqual({
      ok: true,
    });
  });

  it("does not count a port the expansion produces only after the module that needs it", () => {
    // `third` needs `coordinates`; `second` (which produces it) sits *after* third, so at the point third runs
    // the port is not there yet — unmet, because the flattening is a walk in execution order. `buildings` is
    // supplied by the chain so `second`'s own requirement is met and the case isolates the ordering.
    const candidate = doc("cand", [node("t", "third"), node("s", "second")]);
    expect(subflowVerdict(candidate, new Set(["buildings"]), REGISTRY, lookupFrom(candidate), "editing")).toEqual({
      ok: false,
      reason: "missing",
      missing: ["coordinates"],
    });
  });

  it("counts a port the expansion itself produces before the module that needs it", () => {
    // `second` (produces `coordinates`) sits before `third` (needs it), so that requirement is met internally;
    // only `second`'s own `buildings` requirement must come from the chain.
    const candidate = doc("cand", [node("s", "second"), node("t", "third")]);
    expect(subflowVerdict(candidate, new Set(["buildings"]), REGISTRY, lookupFrom(candidate), "editing")).toEqual({
      ok: true,
    });
  });

  it("refuses a candidate whose expansion would contain the workflow being edited", () => {
    // candidate -> "editing": once "editing" holds this candidate, the composition would expand into itself.
    const editing = doc("editing", []);
    const candidate = doc("cand", [{ id: "c", workflows: ["editing"] }]);
    expect(subflowVerdict(candidate, new Set(), REGISTRY, lookupFrom(candidate, editing), "editing")).toEqual({
      ok: false,
      reason: "recursive",
    });
  });

  it("refuses a candidate that is the workflow being edited — a direct self-reference", () => {
    const editing = doc("editing", [node("b", "base")]);
    expect(subflowVerdict(editing, new Set(), REGISTRY, lookupFrom(editing), "editing")).toEqual({
      ok: false,
      reason: "recursive",
    });
  });

  it("refuses an unresolvable candidate — a document naming a subflow nobody stores", () => {
    const candidate = doc("cand", [{ id: "c", workflows: ["nope"] }]);
    expect(subflowVerdict(candidate, new Set(), REGISTRY, lookupFrom(candidate), "editing")).toEqual({
      ok: false,
      reason: "unresolved",
    });
  });

  it("refuses a candidate naming a module the registry does not declare", () => {
    const candidate = doc("cand", [node("c", "undeclared")]);
    expect(subflowVerdict(candidate, new Set(), REGISTRY, lookupFrom(candidate), "editing")).toEqual({
      ok: false,
      reason: "unresolved",
    });
  });
});

describe("a fragment skips the position-dependent gate", () => {
  const REGISTRY = registryFrom(...CATALOGUE);

  it("offers every module available, still naming the ports it requires", () => {
    const consumer = paletteFor(CATALOGUE, [], noLookup, { fragment: true }).find(
      (p) => p.module.module.id === "consumer",
    );
    // The requirement is still reported — it is what the insertion site has to satisfy — but it is not a bar.
    expect(consumer?.requires).toEqual(["buildings"]);
    expect(consumer?.available).toBe(true);
    expect(consumer?.missing).toEqual([]);
  });

  it("still withholds a host module — it is never placeable in a flow of any kind", () => {
    expect(
      paletteFor([...CATALOGUE, HOST], [], noLookup, { fragment: true }).map((p) => p.module.module.id),
    ).toEqual(["base", "consumer", "second", "third"]);
  });

  it("accepts a candidate whose expansion needs ports its own prefix does not produce", () => {
    const candidate = doc("cand", [node("c", "consumer")]); // needs `buildings`, not produced here
    expect(
      subflowVerdict(candidate, new Set(), REGISTRY, lookupFrom(candidate), "editing", { fragment: true }),
    ).toEqual({ ok: true });
  });

  it("still refuses a candidate whose expansion would contain the edited fragment — recursive is positional", () => {
    const editing = doc("editing", []);
    const candidate = doc("cand", [{ id: "c", workflows: ["editing"] }]);
    expect(
      subflowVerdict(candidate, new Set(), REGISTRY, lookupFrom(candidate, editing), "editing", {
        fragment: true,
      }),
    ).toEqual({ ok: false, reason: "recursive" });
  });

  it("still refuses a candidate that cannot be flattened — unresolved is positional", () => {
    const candidate = doc("cand", [node("c", "undeclared")]);
    expect(
      subflowVerdict(candidate, new Set(), REGISTRY, lookupFrom(candidate), "editing", { fragment: true }),
    ).toEqual({ ok: false, reason: "unresolved" });
  });
});

describe("the positional unmet-required walk, on its own", () => {
  const REGISTRY = registryFrom(...CATALOGUE);
  const flowNode = (id: string, moduleId: string): FlowNode => ({ id, moduleId });

  it("reports the union of unmet required ports, in first-seen order", () => {
    // `consumer` needs `buildings`, `third` needs `coordinates`; nothing before the flow produces either.
    const flow = [flowNode("c", "consumer"), flowNode("t", "third")];
    expect(unmetRequiredPorts(flow, new Set(), REGISTRY)).toEqual(["buildings", "coordinates"]);
  });

  it("does not let a later module satisfy an earlier reader", () => {
    // `third` needs `coordinates`; `second` (which produces it) sits *after* third, so it is unmet — the walk
    // is in execution order. `buildings` is supplied so `second`'s own requirement does not muddy the case.
    const flow = [flowNode("t", "third"), flowNode("s", "second")];
    expect(unmetRequiredPorts(flow, new Set(["buildings"]), REGISTRY)).toEqual(["coordinates"]);
  });

  it("counts a port an earlier module in the flow produces", () => {
    const flow = [flowNode("s", "second"), flowNode("t", "third")];
    expect(unmetRequiredPorts(flow, new Set(["buildings"]), REGISTRY)).toEqual([]);
  });
});

describe("a fragment's own unmet inputs — what the flow that inserts it must have produced", () => {
  const REGISTRY = registryFrom(...CATALOGUE);

  it("is the union its own expansion leaves unmet, read with an empty prefix", () => {
    const fragment = doc("frag", [node("c", "consumer"), node("t", "third")]);
    expect(fragmentRequiredPorts(fragment, lookupFrom(fragment), REGISTRY)).toEqual([
      "buildings",
      "coordinates",
    ]);
  });

  it("is empty when the fragment needs nothing from the flow around it", () => {
    const fragment = doc("frag", [node("b", "base")]);
    expect(fragmentRequiredPorts(fragment, lookupFrom(fragment), REGISTRY)).toEqual([]);
  });

  it("reads a later module in the same fragment as unable to satisfy an earlier reader", () => {
    // `third` needs `coordinates`; `second` (which produces it) sits *after* third in the fragment. With an
    // empty prefix nothing before produces it, so `coordinates` stays unmet — the walk is in execution order.
    // `second`'s own `buildings` requirement is unmet too, for the same reason (nothing precedes it either).
    const fragment = doc("frag", [node("t", "third"), node("s", "second")]);
    expect(fragmentRequiredPorts(fragment, lookupFrom(fragment), REGISTRY)).toEqual([
      "coordinates",
      "buildings",
    ]);
  });
});
