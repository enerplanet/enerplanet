export const auth = {
	access: ["very_low", "intermediate", "expert"],
	sso: {
		enabled: import.meta.env.VITE_SSO_ENABLED === "true",
		redirectUri: import.meta.env.VITE_SSO_REDIRECT_URI || "",
		idpHint: import.meta.env.VITE_SSO_IDP_HINT || "",
	},
};
