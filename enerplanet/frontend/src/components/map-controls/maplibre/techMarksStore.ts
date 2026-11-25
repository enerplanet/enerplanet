import { create } from 'zustand';

import { HEAT_SUPPLY_TYPES } from '@/features/technologies/catalogue';

/** What the maps can show on buildings: an icon per kind of technology, and in 3D PV panels on their roofs. */
export type TechMark = 'pv' | 'storage' | 'heat';

interface TechMarksState {
  shown: Record<TechMark, boolean>;
  toggle: (mark: TechMark) => void;
}

/** Which technology marks the maps show, shared by the legend and both views. */
export const useTechMarksStore = create<TechMarksState>((set) => ({
  shown: { pv: true, storage: true, heat: true },
  toggle: (mark) => set((s) => ({ shown: { ...s.shown, [mark]: !s.shown[mark] } })),
}));

const MARK_OF: Record<string, TechMark> = {
  pv_supply: 'pv',
  battery_storage: 'storage',
  ...Object.fromEntries(HEAT_SUPPLY_TYPES.map((type) => [type, 'heat' as const])),
};

/** The legend group of a technology key, or undefined for a technology no group covers. */
export function markOf(techKey: string): TechMark | undefined {
  return MARK_OF[techKey];
}

/** Whether a technology's icon is shown; one no legend group covers always is. */
export function isTechShown(techKey: string): boolean {
  const mark = MARK_OF[techKey];
  return !mark || useTechMarksStore.getState().shown[mark];
}
