import Keycloak, {
	type KeycloakLoginOptions,
	type KeycloakTokenParsed,
} from "keycloak-js";

import { auth } from "@/configuration/auth";
import type { User } from "@/types/user";

const TOKEN_MIN_VALIDITY_SECONDS = 30;

const keycloak = auth.sso.enabled
	? new Keycloak({
			url: auth.sso.url,
			realm: auth.sso.realm,
			clientId: auth.sso.clientId,
		})
	: null;

let loginRedirect: Promise<void> | null = null;
if (keycloak) {
	const keycloakLogin = keycloak.login.bind(keycloak);
	keycloak.login = (options?: KeycloakLoginOptions) => {
		if (loginRedirect) {
			return loginRedirect;
		}

		loginRedirect = keycloakLogin({
			...options,
			idpHint: auth.sso.idpHint,
			redirectUri: auth.sso.redirectUri,
		}).catch((error: unknown) => {
			loginRedirect = null;
			throw error;
		});

		return loginRedirect;
	};
}

let initialization: Promise<boolean> | null = null;

export function initializeKeycloak(): Promise<boolean> {
	if (!keycloak) {
		return Promise.reject(new Error("Keycloak SSO is disabled"));
	}

	initialization ??= keycloak.init({
		onLoad: "login-required",
		pkceMethod: "S256",
	});

	return initialization;
}

export async function loginWithIdentityProvider(): Promise<void> {
	if (!keycloak) {
		throw new Error("Keycloak SSO is disabled");
	}

	await initializeKeycloak();

	if (!keycloak.authenticated) {
		await keycloak.login({
			idpHint: auth.sso.idpHint,
			redirectUri: auth.sso.redirectUri,
		});
	}
}

export async function getValidAccessToken(
	minValidity = TOKEN_MIN_VALIDITY_SECONDS
): Promise<string | null> {
	if (!keycloak?.authenticated) {
		return null;
	}

	await keycloak.updateToken(minValidity);
	return keycloak.token ?? null;
}

const ACCESS_LEVELS: User["access_level"][] = [
	"very_low",
	"intermediate",
	"manager",
	"expert",
];

function stringClaim(claims: KeycloakTokenParsed, name: string): string {
	const value = claims[name];
	return typeof value === "string" ? value : "";
}

function accessLevelClaim(claims: KeycloakTokenParsed): User["access_level"] {
	const value = stringClaim(claims, "access_level").toLowerCase() as User["access_level"];
	return ACCESS_LEVELS.includes(value) ? value : "very_low";
}

export function getAuthenticatedUser(): User | null {
	const claims = keycloak?.tokenParsed;
	if (!keycloak?.authenticated || !claims?.sub) {
		return null;
	}

	const email = stringClaim(claims, "email");
	const name =
		stringClaim(claims, "fullName") ||
		stringClaim(claims, "name") ||
		stringClaim(claims, "preferred_username") ||
		email;

	return {
		id: claims.sub,
		name,
		email,
		organization: stringClaim(claims, "organization"),
		position: stringClaim(claims, "position"),
		phone: stringClaim(claims, "phone"),
		access_level: accessLevelClaim(claims),
	};
}

if (keycloak) {
	keycloak.onTokenExpired = () => {
		void keycloak.updateToken(TOKEN_MIN_VALIDITY_SECONDS).catch(() => {
			void keycloak.login({
				idpHint: auth.sso.idpHint,
				redirectUri: auth.sso.redirectUri,
			});
		});
	};
}

export default keycloak;
