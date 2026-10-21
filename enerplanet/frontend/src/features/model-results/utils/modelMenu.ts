import type { Model } from '@/features/model-dashboard/services/modelService';

/** One row of the results page's model menu. */
export interface ModelMenuRow {
  model: Model;
  /** parent heads a family with copies, copy sits under it, single has no copies. */
  role: 'parent' | 'copy' | 'single';
  /** Completed copies under a parent row; 0 otherwise. */
  copyCount: number;
  /** Only completed models have results to open. */
  selectable: boolean;
}

/** The menu rows and the counts its header shows. */
export interface ModelMenu {
  rows: ModelMenuRow[];
  runCount: number;
  familyCount: number;
}

const newestFirst = (a: Model, b: Model) => b.created_at.localeCompare(a.created_at);

/**
 * Groups the completed models of a workspace under their top-level parent, as
 * the dashboard does. A parent that has not completed still heads its family so
 * its copies stay together; a copy whose parent is not in models heads its own.
 */
export function buildModelMenu(models: Model[]): ModelMenu {
  const byId = new Map(models.map((m) => [m.id, m]));
  const rootOf = (model: Model): Model => {
    const seen = new Set<number>();
    let current = model;
    while (current.parent_model_id && byId.has(current.parent_model_id) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.parent_model_id)!;
    }
    return current;
  };

  const completed = models.filter((m) => m.status === 'completed');
  const families = new Map<number, { root: Model; copies: Model[] }>();
  for (const model of completed) {
    const root = rootOf(model);
    const family = families.get(root.id) ?? { root, copies: [] };
    if (model.id !== root.id) family.copies.push(model);
    families.set(root.id, family);
  }

  const rows: ModelMenuRow[] = [];
  for (const { root, copies } of [...families.values()].sort((a, b) => newestFirst(a.root, b.root))) {
    const rootCompleted = root.status === 'completed';
    if (copies.length === 0) {
      rows.push({ model: root, role: 'single', copyCount: 0, selectable: rootCompleted });
      continue;
    }
    rows.push({ model: root, role: 'parent', copyCount: copies.length, selectable: rootCompleted });
    for (const copy of copies.sort(newestFirst)) {
      rows.push({ model: copy, role: 'copy', copyCount: 0, selectable: true });
    }
  }
  return { rows, runCount: completed.length, familyCount: families.size };
}
