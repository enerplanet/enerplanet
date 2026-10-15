import { describe, expect, it } from "vitest";

import { toStage } from "./useAreaPreparation";

describe("toStage", () => {
    it("reads City2TABULA's stage fields", () => {
        expect(
            toStage({ status: "running", stage: "extract_features", stage_label: "Extracting building features", stage_index: 2, stage_count: 3 }),
        ).toEqual({ key: "extract_features", label: "Extracting building features", index: 2, count: 3 });
    });

    it("has no stage while a run is pending or before City2TABULA reports stages", () => {
        expect(toStage({ status: "pending" })).toBeNull();
        expect(toStage({ status: "running", stage: "import" })).toBeNull();
    });
});
