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
	logout: (redirectTo: string) => void;
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
			logout: (redirectTo) => {
				// Clears the server session and session_id cookie for both
				// password and SSO logins. The page reloads rather than resetting the user in
				// place: a reset re-renders mounted pages, whose requests then fail with 401.
				void axios.post("/logout").catch((error: unknown) => {
					if (import.meta.env.DEV) {
						console.error("Logout error:", error);
					}
				}).finally(() => {
					useAuthStore.persist.clearStorage();
					globalThis.location.replace(redirectTo);
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
