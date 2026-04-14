/**
 * Authentication utility functions
 * 
 * This file contains shared authentication utilities to avoid circular dependencies.
 * It should not import from axios or store files.
 */

/**
 * Reset authentication state by clearing storage and session data
 */
export const resetAuthState = () => {
	if (typeof globalThis === "undefined" || !globalThis.localStorage) return;

	const states = [
		"token",
		"app-store",
		"auth-storage",
		"map-store",
		"onboarding_completed"
	];
	for (const state of states) {
		globalThis.localStorage.removeItem(state);
	}

	// Clear user-specific data from location stores while keeping viewing position
	clearLocationStoreUserData();

	globalThis.sessionStorage.clear();

};

/**
 * Helper to clear only user-specific data from location stores
 */
const clearLocationStoreUserData = () => {
	const stores = [
		{ key: 'weather-location-store', field: 'customLocations' },
		{ key: 'map-location-store', field: 'savedLocations' }
	];

	for (const { key, field } of stores) {
		try {
			const storeData = globalThis.localStorage.getItem(key);
			if (storeData) {
				const parsed = JSON.parse(storeData);
				if (parsed?.state?.[field]) {
					parsed.state[field] = [];
					globalThis.localStorage.setItem(key, JSON.stringify(parsed));
				}
			}
		} catch (err) {
			if (import.meta.env.DEV) console.error(`Failed to clear ${key}:`, err);
		}
	}
};

/**
 * Clear all cookies
 */
export const clearAllCookies = () => {
	if (typeof document !== "undefined") {
		const cookies = document.cookie.split(";");
		for (const c of cookies) {
			const cookie = c.replace(/^\s+/, "");
			const eqPos = cookie.indexOf("=");
			const name = eqPos > -1 ? cookie.substring(0, eqPos) : cookie;
			document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
		}
	}
};
