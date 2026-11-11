/**
 * Influence honesty — the generated contract test (case T8).
 *
 * Spec: `.local/ModularThesis/spec/core.md` §B. A module declares which outputs each input
 * can invalidate (`affect`); this prober *verifies* that declaration instead of trusting it.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { assertInfluenceHonest, deriveInfluence, perturb } from "./influence";
import { fingerprint } from "./fingerprint";
import { defineModule } from "./module";
import { building, fc } from "./fixtures";

// ── fixtures ────────────────────────────────────────────────────────────────

/** Reads the drawn area and produces the grid — honest about it. */
const honest = defineModule({
  id: "honest-grid",
  params: [{ port: "coordinates" }, { port: "buildings" }],
  affect: { coordinates: ["buildings"] },
  layout: [],
  run: (ctx) => {
    const coordinates = ctx.read("coordinates");
    ctx.commit({ buildings: fc([building(String((coordinates ?? []).length))]) });
  },
});

/** Same work, but declares nothing — the unsafe direction. */
const underDeclaring = defineModule({
  id: "under-declaring",
  params: [{ port: "coordinates" }, { port: "buildings" }],
  affect: {},
  layout: [],
  run: (ctx) => {
    const coordinates = ctx.read("coordinates");
    ctx.commit({ buildings: fc([building(String((coordinates ?? []).length))]) });
  },
});

/** Declares an edge that does not exist — safe, just wasteful. */
const overDeclaring = defineModule({
  id: "over-declaring",
  params: [{ port: "coordinates" }, { port: "buildings" }, { port: "modelName" }],
  affect: { coordinates: ["buildings"], modelName: ["buildings"] },
  layout: [],
  run: (ctx) => {
    const coordinates = ctx.read("coordinates");
    ctx.commit({ buildings: fc([building(String((coordinates ?? []).length))]) });
  },
});

/** Reads the prior value and rewrites it — a self-edge, inherent to read → rewrite. */
const selfEditing = defineModule({
  id: "self-editing",
  params: [{ port: "buildings" }],
  affect: {},
  layout: [],
  run: (ctx) => {
    const buildings = ctx.read("buildings");
    ctx.commit({ buildings: fc([...(buildings?.features ?? []), building("added")]) });
  },
});

/** Sneakily reads a port it never declared, through the store. */
const sneaky = defineModule({
  id: "sneaky",
  params: [{ port: "buildings" }],
  affect: {},
  layout: [],
  run: (ctx) => {
    const name = ctx.store.modelName ?? "";
    ctx.commit({ buildings: fc([building(String(name.length))]) });
  },
});

const COORDINATES: [number, number][][] = [[[8.6, 49.4]]];

// ── T8 ──────────────────────────────────────────────────────────────────────

describe("T8 — influence honesty is verified, not trusted", () => {
  it("reports nothing for a module whose declaration matches what it does", async () => {
    const report = await deriveInfluence(honest, { samples: { coordinates: COORDINATES } });

    expect(report.observed).toEqual({ coordinates: ["buildings"] });
    expect(report.underDeclared).toEqual({});
    expect(report.overDeclared).toEqual({});
    expect(() => assertInfluenceHonest(honest.id, report)).not.toThrow();
  });

  it("fails a module that under-declares, naming the edge", async () => {
    const report = await deriveInfluence(underDeclaring, {
      samples: { coordinates: COORDINATES },
    });

    expect(report.underDeclared).toEqual({ coordinates: ["buildings"] });
    expect(() => assertInfluenceHonest(underDeclaring.id, report)).toThrow(
      /under-declaring/,
    );
    expect(() => assertInfluenceHonest(underDeclaring.id, report)).toThrow(/buildings/);
  });

  it("tolerates over-declaration — it costs extra prunes, never correctness", async () => {
    const report = await deriveInfluence(overDeclaring, {
      samples: { coordinates: COORDINATES, modelName: "variant-a" },
    });

    expect(report.observed).toEqual({ coordinates: ["buildings"] });
    expect(report.overDeclared).toEqual({ modelName: ["buildings"] });
    expect(report.underDeclared).toEqual({});
    expect(() => assertInfluenceHonest(overDeclaring.id, report)).not.toThrow();
  });

  it("treats a read → rewrite of the same port as a self-edge, not an influence", async () => {
    const report = await deriveInfluence(selfEditing, { samples: { buildings: fc() } });

    expect(report.observed).toEqual({});
    expect(report.underDeclared).toEqual({});
  });

  it("catches a port read through the store but never declared", async () => {
    const report = await deriveInfluence(sneaky, { samples: { modelName: "ab" } });

    expect(report.underDeclared).toEqual({ modelName: ["buildings"] });
    expect(() => assertInfluenceHonest(sneaky.id, report)).toThrow(/modelName/);
  });

  it("reports a declared input it could not probe rather than guessing", async () => {
    const declaringFar = defineModule({
      id: "declares-unprobed",
      params: [{ port: "coordinates" }, { port: "buildings" }],
      affect: { coordinates: ["buildings"], region: ["buildings"] },
      layout: [],
      run: honest.run,
    });

    const report = await deriveInfluence(declaringFar, { samples: { coordinates: COORDINATES } });

    expect(report.unprobed).toEqual(["region"]);
    expect(report.underDeclared).toEqual({});
  });
});

// ── fingerprint + perturbation ──────────────────────────────────────────────

describe("fingerprint — stable, value-based, order-independent", () => {
  it("ignores key order but respects array order", () => {
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
  });

  it("distinguishes undefined from absent-looking values", () => {
    expect(fingerprint(undefined)).not.toBe(fingerprint(null));
  });
});

describe("perturb — always produces a different value of the same kind", () => {
  it("perturbs primitives", () => {
    expect(perturb("a")).not.toBe("a");
    expect(perturb(60)).not.toBe(60);
    expect(perturb(true)).not.toBe(true);
    expect(fingerprint(perturb(undefined))).not.toBe(fingerprint(undefined));
  });

  it("appends a feature to a collection so counting modules notice", () => {
    const collection = fc([building("b1")]);
    const after = perturb(collection) as GeoJSON.FeatureCollection;

    expect(after.type).toBe("FeatureCollection");
    expect(after.features).toHaveLength(2);
  });

  it("perturbs a plain object and a nested record", () => {
    expect(fingerprint(perturb({ a: 1 }))).not.toBe(fingerprint({ a: 1 }));
    expect(fingerprint(perturb({ electricity: { b1: { yearlyKwh: 1 } } }))).not.toBe(
      fingerprint({ electricity: { b1: { yearlyKwh: 1 } } }),
    );
  });
});
