const ssoEnabled = import.meta.env.VITE_SSO_ENABLED?.toLowerCase() === "true";

function ssoSetting(name: string, value: string | undefined): string {
	const setting = value?.trim() ?? "";
	if (ssoEnabled && !setting) {
		throw new Error(`${name} is required when VITE_SSO_ENABLED=true`);
	}
	return setting;
}

export const auth = {
	access: ["very_low", "intermediate","expert"],
	sso: {
		enabled: ssoEnabled,
		url: ssoSetting("VITE_KEYCLOAK_URL", import.meta.env.VITE_KEYCLOAK_URL),
		realm: ssoSetting("VITE_KEYCLOAK_REALM", import.meta.env.VITE_KEYCLOAK_REALM),
		clientId: ssoSetting("VITE_KEYCLOAK_CLIENT_ID", import.meta.env.VITE_KEYCLOAK_CLIENT_ID),
		idpHint: ssoSetting("VITE_KEYCLOAK_IDP_HINT", import.meta.env.VITE_KEYCLOAK_IDP_HINT),
		redirectUri: ssoSetting(
			"VITE_KEYCLOAK_REDIRECT_URI",
			import.meta.env.VITE_KEYCLOAK_REDIRECT_URI
		),
	},
};
