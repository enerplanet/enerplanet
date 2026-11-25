/**
 * `compareVariantGateway`'s payload mapping — the endpoint's totals as the summary, or `null` when there
 * are none. A pure function, tested directly.
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
