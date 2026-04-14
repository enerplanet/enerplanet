import { Model } from "@/features/model-dashboard/services/modelService";

export const compareModels = (
	a: Model,
	b: Model,
	orderBy: string,
	order: "asc" | "desc"
): number => {
	let valA: unknown = a[orderBy as keyof Model];
	let valB: unknown = b[orderBy as keyof Model];

	if (orderBy === "updated_at" || orderBy === "created_at") {
		valA = new Date(valA as string).getTime();
		valB = new Date(valB as string).getTime();
	}

	if (typeof valA === "string" && typeof valB === "string") {
		const result = valA.localeCompare(valB);
		if (result === 0) {
			return applyTieBreaker(a, b, order);
		}
		return order === "asc" ? result : -result;
	}

	if (typeof valA === "number" && typeof valB === "number") {
		const diff = valA - valB;
		if (diff === 0) {
			return applyTieBreaker(a, b, order);
		}
		return order === "asc" ? diff : -diff;
	}

	return applyTieBreaker(a, b, order);
};

const applyTieBreaker = (a: Model, b: Model, order: "asc" | "desc"): number => {
	return order === "asc" ? a.id - b.id : b.id - a.id;
};

export const organizeModelsHierarchically = (
	models: Model[]
): (Model & { level: number })[] => {
	const organized: (Model & { level: number })[] = [];
	const addedIds = new Set<number>();
	const parentMap = new Map<number, Model[]>();

	for (const model of models) {
		if (model.parent_model_id) {
			if (!parentMap.has(model.parent_model_id)) {
				parentMap.set(model.parent_model_id, []);
			}
			parentMap.get(model.parent_model_id)!.push(model);
		}
	}

	for (const model of models) {
		if (!model.parent_model_id) {
			organized.push({ ...model, level: 0 });
			addedIds.add(model.id);

			const children = parentMap.get(model.id) || [];
			for (const child of children) {
				organized.push({ ...child, level: 1 });
				addedIds.add(child.id);
			}
		}
	}

	for (const model of models) {
		if (!addedIds.has(model.id)) {
			organized.push({ ...model, level: 0 });
		}
	}

	return organized;
};
