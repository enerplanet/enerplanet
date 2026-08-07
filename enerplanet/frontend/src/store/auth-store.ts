import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import axios, { resetAxiosSessionState } from "@/lib/axios";
import { User } from "@/types/user";

interface AuthState {
	user: User | null;
	sessionTimeout: number | null;
	isLoading: boolean;
	isSessionExpired: boolean;
	setUser: (user: User | null) => void;
	init: (data: { user: User | null; sessionTimeout?: number }) => Promise<void>;
	updateUser: (user: Partial<User>) => void;
	logout: (callback?: (data: { success: boolean; [key: string]: unknown }) => void) => void;
	logoutSessionExpired: () => void;
	reset: () => void;
}

export const useAuthStore = create<AuthState>()(
	persist(
		(set, get) => ({
			user: null,
			sessionTimeout: null,
			isLoading: false,
			isSessionExpired: false,
			init: async ({ user, sessionTimeout }) => {
				resetAxiosSessionState();
				set({ user, sessionTimeout: sessionTimeout ?? null, isSessionExpired: false });
			},
			setUser: (user) => set({ user }),
			updateUser: (update) => {
				const { user } = get();
				if (!user) return;
				set({ user: { ...user, ...update } });
			},
			logout: (callback) => {
				get().reset();
				// Clears the server session and session_id cookie for both
				// password and SSO logins.
				void axios.post("/logout").then(({ data: response }) => {
					callback?.(response);
				}).catch((error: unknown) => {
					if (import.meta.env.DEV) {
						console.error("Logout error:", error);
					}
				});
			},
			logoutSessionExpired: () => {
				set({ isSessionExpired: true });
				void axios.post("/logout").catch(() => {
					return;
				});
				// Let beforeunload observe expiration.
				setTimeout(() => get().reset(), 100);
			},
			reset: () => {
				set({ isLoading: false, user: null, sessionTimeout: null, isSessionExpired: false });
			},
		}),
		{
			name: "auth-storage",
			storage: createJSONStorage(() => globalThis.localStorage),
			partialize: (state) => ({
				user: state.user,
				sessionTimeout: state.sessionTimeout,
			}),
		}
	)
);
