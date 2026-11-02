import { describe, expect, it } from "vitest";
import { isActiveStatus, runningLabelKey } from "./statusHelpers";

describe("isActiveStatus", () => {
	it("counts a run resolving its buildings as in progress", () => {
		expect(isActiveStatus("buildings")).toBe(true);
	});
});

describe("runningLabelKey", () => {
	it("names a plan run's model step Optimising and an operate run's Simulating", () => {
		expect(runningLabelKey({ mode: "plan" })).toBe("modelStatus.optimising");
		expect(runningLabelKey(undefined)).toBe("modelStatus.optimising");
		expect(runningLabelKey({ mode: "operate" })).toBe("modelStatus.running");
	});
});
