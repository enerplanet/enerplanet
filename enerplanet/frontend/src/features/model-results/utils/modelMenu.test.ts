import { describe, expect, it } from 'vitest';
import type { Model } from '@/features/model-dashboard/services/modelService';
import { buildModelMenu } from './modelMenu';

const model = (id: number, created: string, extra: Partial<Model> = {}): Model =>
  ({ id, title: `m${id}`, status: 'completed', created_at: created, ...extra }) as Model;

describe('buildModelMenu', () => {
  it('groups completed copies, including copies of copies, under their top-level parent', () => {
    const menu = buildModelMenu([
      model(1, '2026-10-01'),
      model(2, '2026-10-02', { parent_model_id: 1 }),
      model(3, '2026-10-03', { parent_model_id: 2 }),
      model(4, '2026-10-04'),
    ]);
    expect(menu.rows.map((r) => [r.model.id, r.role])).toEqual([
      [4, 'single'],
      [1, 'parent'],
      [3, 'copy'],
      [2, 'copy'],
    ]);
    expect(menu.rows[1].copyCount).toBe(2);
    expect(menu.rows.map((r) => r.closesFamily)).toEqual([false, false, false, true]);
    expect(menu).toMatchObject({ runCount: 4, familyCount: 2 });
  });

  it('keeps a parent that has not run as an unselectable family head', () => {
    const menu = buildModelMenu([
      model(1, '2026-10-01', { status: 'draft' }),
      model(2, '2026-10-02', { parent_model_id: 1 }),
      model(5, '2026-10-05', { status: 'failed' }),
    ]);
    expect(menu.rows.map((r) => [r.model.id, r.role, r.selectable])).toEqual([
      [1, 'parent', false],
      [2, 'copy', true],
    ]);
    expect(menu).toMatchObject({ runCount: 1, familyCount: 1 });
  });

  it('lets a copy whose parent is missing head its own row', () => {
    const menu = buildModelMenu([model(7, '2026-10-07', { parent_model_id: 99 })]);
    expect(menu.rows.map((r) => [r.model.id, r.role])).toEqual([[7, 'single']]);
  });

  it('keeps the copies of a deleted original together under the oldest', () => {
    const menu = buildModelMenu([
      model(5, '2026-10-05', { group_id: 1, status: 'completed' }),
      model(4, '2026-10-04', { group_id: 1, status: 'completed' }),
    ]);
    expect(menu.rows.map((r) => [r.model.id, r.role])).toEqual([[4, 'parent'], [5, 'copy']]);
    expect(menu.familyCount).toBe(1);
  });
});
