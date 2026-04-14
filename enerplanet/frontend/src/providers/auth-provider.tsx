import * as React from "react";
import { useAuthStore } from "@/store/auth-store";
import { createContext, useContext, ReactNode, useState, useEffect, useMemo, useCallback } from "react";
import { useAppStore } from "@/store/app-store";
import { useWeatherLocationStore } from "@/features/weather/store/weather-location";
import { useMapLocationStore } from "@/features/interactive-map/store/map-location";
import { updateMapToSavedLocation } from "@/features/interactive-map/store/map-store";
import { User } from "@/types/user";

// Define the shape of the context
interface AuthContext {
	user: User | null;
	isAuthenticated: boolean;
	isLoading: boolean;
	refreshUser: () => Promise<void>;
}

// Create the context
const AuthContext = createContext<AuthContext | undefined>({
	user: null,
	isAuthenticated: false,
	isLoading: true,
	refreshUser: async () => {},
});

// Create the provider component
interface AuthProviderProps {
	children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
	const { user: storeUser } = useAuthStore();
	const app = useAppStore();
	const { syncFromBackend: syncWeatherFromBackend } = useWeatherLocationStore();
	const { syncFromBackend: syncMapFromBackend } = useMapLocationStore();
	const [isAuthenticated, setIsAuthenticated] = useState(!!storeUser);
	const [user, setUser] = useState<User | null>(storeUser);
	const [isLoading, setIsLoading] = useState(!!storeUser);

	const refreshUser = useCallback(async () => {
		if (storeUser) {
			setUser(storeUser);
			setIsAuthenticated(true);
		}
	}, [storeUser]);

	// Cross-tab auth sync — detect login/logout in other browser tabs
	useEffect(() => {
		const handleStorageChange = (e: StorageEvent) => {
			if (e.key === "auth-storage") {
				if (e.newValue === null) {
					useAuthStore.getState().reset();
				} else {
					useAuthStore.persist.rehydrate();
				}
			}
		};
		window.addEventListener("storage", handleStorageChange);
		return () => window.removeEventListener("storage", handleStorageChange);
	}, []);

	useEffect(() => {
		if (storeUser) {
			setIsAuthenticated(true);
			setUser(storeUser);

			syncWeatherFromBackend();
			syncMapFromBackend().then(() => {
				updateMapToSavedLocation();
			});
		} else {
			setIsAuthenticated(false);
			setUser(null);
		}
		setIsLoading(false);
	}, [storeUser, syncWeatherFromBackend, syncMapFromBackend]);

	useEffect(() => {
		const initApp = async () => {
			await app.init({
				user: null,
				usersCount: 0
			});
		};
		initApp();
	}, [app]);

	const authValue = useMemo(() => ({
		user,
		isAuthenticated,
		isLoading,
		refreshUser,
	}), [user, isAuthenticated, isLoading, refreshUser]);

	return (
		<AuthContext.Provider
			value={authValue}
		>
			{children}
		</AuthContext.Provider>
	);
};

 
export function useAuth() {
	const context = useContext(AuthContext);
	if (context === undefined) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
}
