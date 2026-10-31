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

/**
 * A model's family: the group it was copied or joined into, else its original,
 * else itself. Matches familyIDExpr in the backend's model_helpers_query.go.
 */
export const familyId = (model: Pick<Model, "id" | "group_id" | "parent_model_id">): number =>
	model.group_id ?? model.parent_model_id ?? model.id;

/** A copy unlinked from its original: it has an original but is its own family. */
export const isUnlinkedCopy = (model: Pick<Model, "id" | "group_id" | "parent_model_id">): boolean =>
	model.parent_model_id != null && familyId(model) === model.id;

/** A family's first model: its original, or the oldest member once the original is gone. */
export const familyHead = <T extends Model>(members: T[], id: number): T =>
	members.find((m) => m.id === id) ??
	members.reduce((oldest, m) =>
		m.created_at < oldest.created_at || (m.created_at === oldest.created_at && m.id < oldest.id) ? m : oldest,
	);

/** Groups models by family, the head first; families keep the order of their first model. */
export const groupFamilies = <T extends Model>(models: T[]): { head: T; members: T[] }[] => {
	const byFamily = new Map<number, T[]>();
	for (const model of models) {
		const members = byFamily.get(familyId(model));
		if (members) members.push(model);
		else byFamily.set(familyId(model), [model]);
	}
	return [...byFamily].map(([id, members]) => {
		const head = familyHead(members, id);
		return { head, members: members.filter((m) => m !== head) };
	});
};

export const organizeModelsHierarchically = (
	models: Model[]
): (Model & { level: number })[] =>
	groupFamilies(models).flatMap(({ head, members }) => [
		{ ...head, level: 0 },
		...members.map((m) => ({ ...m, level: 1 })),
	]);
