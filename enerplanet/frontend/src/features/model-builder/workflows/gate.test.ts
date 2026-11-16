/**
 * The gate rule (plan §3). These are the cases the editor's whole promise rests on: a module becomes
 * addable exactly when its `required` ports are produced by the chain, and stays unavailable otherwise —
 * with the port it is waiting for named, never hidden.
 *
 * Written failing first.
 */
import { describe, expect, it } from "vitest";
import type { Module, Param } from "../core/module";
import type { BuilderModule } from "../shell/contract";
import { missingPorts, paletteFor, producedPorts } from "./gate";
import type { WorkflowNodeDocument } from "./types";

/** A catalogue entry with just the surface the gate reads. */
function entry(id: string, params: Param[]): BuilderModule {
  const module: Module = { id, name: id, params, affect: {}, layout: [] };
  return { module, Component: () => null };
}

const BASE = entry("base", [{ port: "modelName" }]);
const CONSUMER = entry("consumer", [{ port: "buildings", required: true }]);
const SECOND = entry("second", [{ port: "buildings", required: true }, { port: "coordinates" }]);
const THIRD = entry("third", [{ port: "coordinates", required: true }]);

const CATALOGUE = [BASE, CONSUMER, SECOND, THIRD];

const node = (id: string, moduleId: string): WorkflowNodeDocument => ({ id, moduleId });

describe("a module is addable only when the chain produces its required ports", () => {
  it("offers a module that requires nothing on an empty chain", () => {
    const [base] = paletteFor(CATALOGUE, []);
    expect(base.module.module.id).toBe("base");
    expect(base.requires).toEqual([]);
    expect(base.available).toBe(true);
  });

  it("refuses a module whose required port the chain has not produced, naming the port", () => {
    const consumer = paletteFor(CATALOGUE, []).find((p) => p.module.module.id === "consumer");
    expect(consumer?.available).toBe(false);
    expect(consumer?.missing).toEqual(["buildings"]);
  });

  it("makes it addable once a module before it produces that port", () => {
    const chain = [node("base", "base"), node("second", "second")];
    const consumer = paletteFor(CATALOGUE, chain).find((p) => p.module.module.id === "consumer");
    expect(consumer?.available).toBe(true);
    expect(consumer?.missing).toEqual([]);
  });

  it("reads production from the whole chain, not only its last module", () => {
    // `second` produces `buildings`; `third` (later) does not. A module needing only `buildings` is still
    // satisfied, because production accumulates across the chain.
    const chain = [node("base", "base"), node("second", "second"), node("third", "third")];
    const produced = producedPorts(chain, CATALOGUE);
    expect(produced.has("buildings")).toBe(true);
    expect(produced.has("coordinates")).toBe(true);
  });

  it("lists every catalogue module, in catalogue order, and never hides one", () => {
    const palette = paletteFor(CATALOGUE, []);
    expect(palette.map((p) => p.module.module.id)).toEqual(["base", "consumer", "second", "third"]);
  });

  it("still refuses a module when only some of its required ports are present", () => {
    const chain = [node("base", "base"), node("second", "second")];
    const third = paletteFor(CATALOGUE, chain).find((p) => p.module.module.id === "third");
    expect(third?.available).toBe(true); // `second` produced coordinates too

    const partial = paletteFor(CATALOGUE, [node("base", "base")]).find((p) => p.module.module.id === "third");
    expect(partial?.available).toBe(false);
    expect(partial?.missing).toEqual(["coordinates"]);
  });

  it("treats an unknown module in the chain as producing nothing — a data condition, not a crash", () => {
    expect(missingPorts(CONSUMER.module, producedPorts([node("ghost", "not-in-catalogue")], CATALOGUE))).toEqual([
      "buildings",
    ]);
  });
});
