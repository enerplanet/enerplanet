import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import axios, { resetAxiosSessionState } from "@/lib/axios";
import { User } from "@/types/user";

interface AuthState {
	user: User | null;
	token: string | null;
	sessionTimeout: number | null;
	isLoading: boolean;
	isSessionExpired: boolean;
	setUser: (user: User | null) => void;
	init: (data: { user: User | null; token: string | null; sessionTimeout?: number }) => Promise<void>;
	updateUser: (user: Partial<User>) => void;
	setToken: (token: string | null) => void;
	logout: (callback?: (data: { success: boolean; [key: string]: unknown }) => void) => void;
	logoutSessionExpired: () => void;
	reset: () => void;
}

export const useAuthStore = create<AuthState>()(
	persist(
		(set, get) => ({
			user: null,
			token: null,
			sessionTimeout: null,
			isLoading: false,
			isSessionExpired: false,
			init: async ({ user, token, sessionTimeout }) => {
				resetAxiosSessionState(); // Clear stale module-level flags from previous session
				set({ user, token, sessionTimeout, isSessionExpired: false });
			},
			setUser: (user) => set({ user }),
			updateUser: (update) => {
				const { user } = get();
				if (!user) return;
				set({ user: { ...user, ...update } });
			},
			setToken: (token) => set({ token }),
			logout: (callback) => {
				void axios.post("/logout").then(({ data: response }) => {
					if (callback) callback(response);
				}).catch(error => {
					if (import.meta.env.DEV) console.error("Logout error:", error);
				});
				get().reset();
			},
			logoutSessionExpired: () => {
				set({ isSessionExpired: true });
				void axios.post("/logout").catch(() => {});
				// Defer reset so beforeunload handlers can read isSessionExpired
				setTimeout(() => get().reset(), 100);
			},
			reset: () => {
				set({ isLoading: false, user: null, token: null, sessionTimeout: null, isSessionExpired: false });
			},
		}),
		{
			name: "auth-storage",
			storage: createJSONStorage(() => globalThis.localStorage),
		}
	)
);
