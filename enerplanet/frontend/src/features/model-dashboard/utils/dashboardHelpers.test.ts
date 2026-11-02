import { describe, expect, it } from "vitest";
import type { Model } from "@/features/model-dashboard/services/modelService";
import { familyId, isUnlinkedCopy, organizeModelsHierarchically } from "./dashboardHelpers";

const model = (id: number, extra: Partial<Model> = {}): Model =>
	({ id, title: `m${id}`, status: "draft", created_at: `2026-10-${String(id).padStart(2, "0")}T00:00:00Z`, ...extra }) as Model;

const rows = (models: Model[]) => organizeModelsHierarchically(models).map((m) => [m.id, m.level]);

describe("organizeModelsHierarchically", () => {
	it("puts the copies of an original under it", () => {
		expect(rows([model(21), model(24, { parent_model_id: 21, group_id: 21 }), model(30)])).toEqual([
			[21, 0],
			[24, 1],
			[30, 0],
		]);
	});

	it("keeps the copies of a deleted original together under the oldest", () => {
		expect(rows([model(26, { group_id: 21 }), model(23, { group_id: 21 }), model(25, { group_id: 21 })])).toEqual([
			[23, 0],
			[26, 1],
			[25, 1],
		]);
	});

	it("groups a model joined into a family with it", () => {
		expect(rows([model(21), model(30), model(31, { group_id: 21 })])).toEqual([
			[21, 0],
			[31, 1],
			[30, 0],
		]);
	});

	it("groups a copy made before families had an id by its parent", () => {
		expect(familyId(model(24, { parent_model_id: 21 }))).toBe(21);
	});
});

describe("isUnlinkedCopy", () => {
	it("offers a link back only to a copy that is its own family", () => {
		expect(isUnlinkedCopy(model(24, { parent_model_id: 21, group_id: 24 }))).toBe(true);
		expect(isUnlinkedCopy(model(24, { parent_model_id: 21, group_id: 21 }))).toBe(false);
		expect(isUnlinkedCopy(model(21))).toBe(false);
	});
});
