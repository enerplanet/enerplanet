import { describe, expect, it } from "vitest";

import { heldByRun } from "./useBuildingState";

describe("heldByRun", () => {
  it("holds a building while its area's preparation run is pending or running", () => {
    expect(heldByRun("pending")?.preparing).toBe(true);
    expect(heldByRun("running")?.preparing).toBe(true);
  });

  it("resolves a building once the run has ended, whatever its outcome", () => {
    // A failed or empty run can be outdated: the 3D data may have been imported since.
    for (const state of ["ready", "completed", "failed", "no_data", "idle"] as const) {
      expect(heldByRun(state)).toBeNull();
    }
  });
});
