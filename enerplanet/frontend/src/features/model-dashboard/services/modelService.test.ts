import { afterEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("@/lib/axios", () => ({ default: { get } }));

const { modelService } = await import("./modelService");

describe("modelService.getExperimentalSessionModelIds", () => {
	afterEach(() => get.mockReset());

	it("returns the ids of the models the builder has a session for", async () => {
		get.mockResolvedValueOnce({ data: { data: [15, 12, 4] } });

		await expect(modelService.getExperimentalSessionModelIds()).resolves.toEqual([15, 12, 4]);
		expect(get.mock.calls[0][0]).toBe("/model-sessions/ids");
	});

	it("returns an empty array when no model has a session", async () => {
		get.mockResolvedValueOnce({ data: { data: [] } });

		await expect(modelService.getExperimentalSessionModelIds()).resolves.toEqual([]);
	});

	it("degrades to an empty array instead of throwing when the request fails", async () => {
		get.mockRejectedValueOnce(new Error("network down"));

		await expect(modelService.getExperimentalSessionModelIds()).resolves.toEqual([]);
	});
});
