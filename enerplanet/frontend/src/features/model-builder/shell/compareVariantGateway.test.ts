/**
 * `compareVariantGateway`'s payload mapping — the one part worth pinning.
 *
 * The gateway's axios call is a thin wrapper and is left to the module's own tests (which drive it through a
 * fake); what can break silently is the *shape* — how the endpoint's top-level totals become the summary, and
 * how an absent payload becomes `null` rather than a set of zeros. It lives in a pure function (`summaryOf`),
 * tested directly, without stubbing axios, so the mapping can be checked against the fields
 * `features/model-results/types.ts` (`StructuredModelResults`) serves.
 */
import { describe, expect, it } from "vitest";
import { summaryOf } from "./compareVariantGateway";

describe("summaryOf — the endpoint's totals as the summary, or null when there are none", () => {
  it("reads the three top-level totals", () => {
    expect(summaryOf({ sum_production: 100, sum_consumption: 90, peak_demand: 5 })).toEqual({
      sumProduction: 100,
      sumConsumption: 90,
      peakDemand: 5,
    });
  });

  it("treats an omitted field as zero — the endpoint omits a value it has none of", () => {
    expect(summaryOf({ sum_production: 100 })).toEqual({
      sumProduction: 100,
      sumConsumption: 0,
      peakDemand: 0,
    });
  });

  it("answers null for an absent payload — a model that has not been run, not a zero", () => {
    expect(summaryOf(undefined)).toBeNull();
  });
});
