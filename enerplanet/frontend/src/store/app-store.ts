import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { User } from "@/types/user";

interface BaseState {
	user: User | null;
	usersCount: number;
	isLoading: boolean;
}

interface AppState extends BaseState {
	isInitialized: boolean;
	init: (data: Partial<BaseState>) => Promise<void>;
	reset: () => void;
	setUsersCount: (n: number) => void;
}

export const useAppStore = create<AppState>()(
	persist(
		(set, get) => ({
			user: null,
			usersCount: 0,
			isLoading: true,
			isInitialized: false,
			init: async ({ ...props }) => {
				if (get().isInitialized) return;
				set({ ...props, isLoading: false, isInitialized: true });
			},
			reset: () => {
				set({ isLoading: false, user: null, usersCount: 0, isInitialized: false });
			},
			setUsersCount: (n: number) => set({ usersCount: typeof n === 'number' ? n : Number(n) || 0 }),
		}),
		{
			name: "app-store",
			storage: createJSONStorage(() => localStorage),
			merge: (persisted, current) => {
				const merged = { ...current, ...(persisted as Partial<AppState>) };
				// Fix corrupted usersCount (may be object from HMR)
				if (typeof merged.usersCount !== 'number') {
					merged.usersCount = 0;
				}
				return merged;
			},
		}
	)
);
