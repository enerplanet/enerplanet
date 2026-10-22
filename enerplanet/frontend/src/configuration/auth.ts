import { runtimeConfig } from "@/configuration/runtime";

const ssoEnabled = runtimeConfig.sso.enabled;

function ssoSetting(name: string, value: string): string {
	const setting = value?.trim() ?? "";
	if (ssoEnabled && !setting) {
		throw new Error(`${name} is required when SSO is enabled`);
	}
	return setting;
}

export const auth = {
	access: ["very_low", "intermediate", "expert"],
	sso: {
		enabled: ssoEnabled,
		url: ssoSetting("keycloak url", runtimeConfig.sso.url),
		realm: ssoSetting("keycloak realm", runtimeConfig.sso.realm),
		clientId: ssoSetting("keycloak client id", runtimeConfig.sso.clientId),
		idpHint: ssoSetting("keycloak idp hint", runtimeConfig.sso.idpHint),
		redirectUri: ssoSetting(
			"keycloak redirect uri",
			runtimeConfig.sso.redirectUri
		),
	},
};
