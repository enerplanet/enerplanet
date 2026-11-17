/**
 * `memeRunGateway`'s mapping — the one part of the gateway worth pinning, and the part it shares with the
 * model dashboard.
 *
 * The gateway's submit/status calls are a thin axios wrapper and are left to the module's own tests (which
 * drive it through a fake); what can break silently is the *mapping* — the dashboard's status sets copied here
 * by value, and the failure message read out of `results`. So the mapping is a pure function and is tested
 * directly, without stubbing axios.
 *
 * Every status the dashboard's `ModelStatus` names is covered, so a status added to the dashboard's sets and
 * not to this copy (or the reverse) shows up here.
 *
 * Written failing first.
 */
import { describe, expect, it } from "vitest";
import { memeRunOf, memeRunStatusOf } from "./memeRunGateway";

describe("memeRunStatusOf — the dashboard's status sets, copied", () => {
  // The active set is model-dashboard/utils/statusHelpers.ts `isActiveStatus`; the pre-solve split and the
  // leg set are the gateway's own reading (useModelsQuery.ts `hasActiveRun`, `PYPSA_LEG_RUNNING`).
  it.each([
    ["queue", "pending"],
    ["buildings", "pending"],
    ["running", "running"],
    ["calculating", "running"],
    ["processing", "running"],
  ] as const)("reads an active status %s as %s", (status, expected) => {
    expect(memeRunStatusOf(status)).toBe(expected);
  });

  it.each([
    ["completed", "completed"],
    ["published", "completed"],
  ] as const)("reads a completed status %s as %s", (status, expected) => {
    expect(memeRunStatusOf(status)).toBe(expected);
  });

  it.each([
    ["failed", "failed"],
    ["cancelled", "failed"],
    ["draft", "failed"],
    ["modified", "failed"],
  ] as const)("reads a terminal status %s as %s", (status, expected) => {
    expect(memeRunStatusOf(status)).toBe(expected);
  });

  it("reports an unrecognised status as terminal, never as pending", () => {
    // The old gateway defaulted every unknown status to pending, so an unanticipated state polled forever.
    expect(memeRunStatusOf("incomplete")).toBe("failed");
    expect(memeRunStatusOf("")).toBe("failed");
  });

  it("counts an in-flight pypsa leg as an active run", () => {
    // The leg is an add-on over a completed Calliope run and never touches the model's status; the dashboard
    // keeps polling it via PYPSA_LEG_RUNNING. A completed model with its leg running is still active.
    expect(memeRunStatusOf("completed", "running")).toBe("running");
    expect(memeRunStatusOf("completed", "pending")).toBe("running");
  });

  it("leaves a finished or absent leg alone", () => {
    expect(memeRunStatusOf("completed", "completed")).toBe("completed");
    expect(memeRunStatusOf("completed", "failed")).toBe("completed");
    expect(memeRunStatusOf("completed", "")).toBe("completed");
  });
});

describe("memeRunOf — the failure message from results", () => {
  it("names the service and the stage the backend recorded", () => {
    // The shape internal/store/model/failed.go writes: error, failed_stage, failed_service.
    expect(
      memeRunOf({
        status: "failed",
        results: { error: "meme job 8974 via TentaCron", failed_stage: "running", failed_service: "meme" },
      }),
    ).toEqual({ framework: "calliope", status: "failed", error: 'meme failed at the "running" stage' });
  });

  it("falls back to the raw error when no stage or service is recorded", () => {
    expect(memeRunOf({ status: "failed", results: { error: "calculation failed on webservice" } })).toEqual({
      framework: "calliope",
      status: "failed",
      error: "calculation failed on webservice",
    });
  });

  it("names the service alone when only a service is recorded", () => {
    expect(memeRunOf({ status: "failed", results: { failed_service: "city2tabula" } }).error).toBe(
      "city2tabula failed",
    );
  });

  it("names the stage alone when only a stage is recorded", () => {
    expect(memeRunOf({ status: "failed", results: { failed_stage: "queue" } }).error).toBe(
      'failed at the "queue" stage',
    );
  });

  it("names the model's status when nothing recorded a failure", () => {
    // `draft` lands on `failed` because the port has no vocabulary for "not started": the dashboard neither
    // polls it nor calls it complete, and defaulting to `pending` would poll forever. So the message carries
    // the diagnosis the recorded failure fields cannot.
    expect(memeRunOf({ status: "draft" }).error).toBe('the run produced no result (model status: "draft")');
  });

  it("says the status is unknown when the payload carries none", () => {
    expect(memeRunOf({}).error).toBe("the run produced no result (model status: unknown)");
  });

  it("carries no message for a run that has not failed", () => {
    expect(memeRunOf({ status: "running", results: { error: "stale" } })).toEqual({
      framework: "calliope",
      status: "running",
    });
  });

  it("reads the pypsa leg out of the payload", () => {
    expect(memeRunOf({ status: "completed", pypsa_leg_status: "running" })).toEqual({
      framework: "calliope",
      status: "running",
    });
  });
});
