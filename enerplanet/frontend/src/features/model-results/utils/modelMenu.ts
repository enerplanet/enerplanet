import type { Model } from '@/features/model-dashboard/services/modelService';
import { familyHead } from '@/features/model-dashboard/utils/dashboardHelpers';

/** One row of the results page's model menu. */
export interface ModelMenuRow {
  model: Model;
  /** parent heads a family with copies, copy sits under it, single has no copies. */
  role: 'parent' | 'copy' | 'single';
  /** Completed copies under a parent row; 0 otherwise. */
  copyCount: number;
  /** Only completed models have results to open. */
  selectable: boolean;
  /** The last copy of a family, where its block closes. */
  closesFamily: boolean;
}

/** The menu rows and the counts its header shows. */
export interface ModelMenu {
  rows: ModelMenuRow[];
  runCount: number;
  familyCount: number;
}

const newestFirst = (a: Model, b: Model) => b.created_at.localeCompare(a.created_at);

/**
 * Groups the completed models of a workspace into families, as the dashboard
 * does. A head that has not completed still heads its family so its copies stay
 * together; a family whose original is gone is headed by its oldest model.
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
  // A family is its group_id, else its top-level parent; the dashboard uses the same rule.
  const members = new Map<number, Model[]>();
  for (const model of models) {
    const id = model.group_id ?? rootOf(model).id;
    members.set(id, [...(members.get(id) ?? []), model]);
  }
  const families = new Map<number, { root: Model; copies: Model[] }>();
  for (const [id, family] of members) {
    if (!family.some((m) => m.status === 'completed')) continue;
    const root = familyHead(family, id);
    families.set(id, { root, copies: family.filter((m) => m !== root && m.status === 'completed') });
  }

  const rows: ModelMenuRow[] = [];
  for (const { root, copies } of [...families.values()].sort((a, b) => newestFirst(a.root, b.root))) {
    const rootCompleted = root.status === 'completed';
    if (copies.length === 0) {
      rows.push({ model: root, role: 'single', copyCount: 0, selectable: rootCompleted, closesFamily: false });
      continue;
    }
    rows.push({ model: root, role: 'parent', copyCount: copies.length, selectable: rootCompleted, closesFamily: false });
    copies.sort(newestFirst).forEach((copy, i) => {
      rows.push({ model: copy, role: 'copy', copyCount: 0, selectable: true, closesFamily: i === copies.length - 1 });
    });
  }
  return { rows, runCount: completed.length, familyCount: families.size };
}
