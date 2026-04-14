import { create } from 'zustand';

type TourState = {
  showTour: boolean;
  tourStep: number;
  startTour: () => void;
  setTourStep: (index: number) => void;
  setShowTour: (show: boolean) => void;
};

export const useTourStore = create<TourState>((set) => ({
  showTour: false,
  tourStep: 0,
  startTour: () => set({ showTour: true, tourStep: 0 }),
  setTourStep: (index: number) => set({ tourStep: index }),
  setShowTour: (show: boolean) => set({ showTour: show }),
}));
