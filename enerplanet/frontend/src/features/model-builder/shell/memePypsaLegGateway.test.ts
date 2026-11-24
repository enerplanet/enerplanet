/**
 * `memePypsaLegGateway`'s mapping: the leg's status is exposed directly, so the mapping is a passthrough
 * of the backend's own vocabulary. A pure function, tested directly.
 */
import { describe, expect, it } from "vitest";
import { memePypsaLegOf, memePypsaLegStatusOf } from "./memePypsaLegGateway";

describe("memePypsaLegStatusOf — the backend's leg vocabulary, read directly", () => {
  it.each(["pending", "running", "completed", "failed"] as const)(
    "passes the status %s through verbatim",
    (status) => {
      expect(memePypsaLegStatusOf(status)).toBe(status);
    },
  );

  it("reports an unrecognised or absent status as terminal, never as pending", () => {
    // The field only ever holds the four values; anything else means there is no live leg to poll.
    expect(memePypsaLegStatusOf("")).toBe("failed");
    expect(memePypsaLegStatusOf("queued")).toBe("failed");
  });
});

describe("memePypsaLegOf — the leg read out of the model payload", () => {
  it("reads the leg's status off pypsa_leg_status", () => {
    expect(memePypsaLegOf({ pypsa_leg_status: "running" })).toEqual({
      framework: "pypsa",
      status: "running",
    });
    expect(memePypsaLegOf({ pypsa_leg_status: "completed" })).toEqual({
      framework: "pypsa",
      status: "completed",
    });
  });

  it("reports a model with no leg as terminal — there is no leg to poll", () => {
    expect(memePypsaLegOf({})).toEqual({ framework: "pypsa", status: "failed" });
    expect(memePypsaLegOf(undefined)).toEqual({ framework: "pypsa", status: "failed" });
  });

  it("carries no run id or message — neither is on a frontend response", () => {
    // `model_meme_runs.run_id` and `.error` are server-side; `pypsa_leg_status` carries the status alone.
    const leg = memePypsaLegOf({ pypsa_leg_status: "failed" });
    expect(leg.runId).toBeUndefined();
    expect(leg.error).toBeUndefined();
  });
});
