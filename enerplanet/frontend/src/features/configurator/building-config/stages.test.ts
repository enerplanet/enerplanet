import { describe, expect, it } from "vitest";
import {
  FIRST_STAGE,
  isStageId,
  nextStage,
  prevStage,
  STAGES,
  stageIndex,
} from "./stages";

describe("stage registry", () => {
  it("starts at the first stage in STAGES", () => {
    expect(FIRST_STAGE).toBe(STAGES[0].id);
    expect(stageIndex(FIRST_STAGE)).toBe(0);
  });

  it("walks forwards and stops at the last stage", () => {
    const last = STAGES[STAGES.length - 1].id;
    expect(nextStage(last)).toBeNull();
    expect(nextStage(FIRST_STAGE)).toBe(STAGES[1].id);
  });

  it("walks backwards and stops at the first stage", () => {
    expect(prevStage(FIRST_STAGE)).toBeNull();
    expect(prevStage(STAGES[1].id)).toBe(FIRST_STAGE);
  });

  it("validates stage ids from the URL", () => {
    expect(isStageId("metadata")).toBe(true);
    expect(isStageId("bogus")).toBe(false);
    expect(isStageId(null)).toBe(false);
  });

  it("next/prev are inverse across the whole list", () => {
    for (let i = 1; i < STAGES.length; i++) {
      expect(nextStage(prevStage(STAGES[i].id)!)).toBe(STAGES[i].id);
    }
  });
});
