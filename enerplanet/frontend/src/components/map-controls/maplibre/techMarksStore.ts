import { create } from 'zustand';

/** What the 3D view can show on buildings: PV panels on their roofs and an icon per kind of technology. */
export type TechMark = 'pv' | 'storage' | 'heat';

interface TechMarksState {
  shown: Record<TechMark, boolean>;
  toggle: (mark: TechMark) => void;
}

/** Which technology marks the 3D view shows, shared by its legend and its building layer. */
export const useTechMarksStore = create<TechMarksState>((set) => ({
  shown: { pv: true, storage: true, heat: true },
  toggle: (mark) => set((s) => ({ shown: { ...s.shown, [mark]: !s.shown[mark] } })),
}));
