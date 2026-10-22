/**
 * Runtime configuration, injected by the backend at /config.js
 * (window.__ENERPLANET_CONFIG__). The image is environment-agnostic: the
 * backend serves these values from its own env vars (radarr-style), so one
 * image runs beta and production without a rebuild.
 *
 * In dev (vite dev server, which has no /config.js) these fall back to the
 * build-time import.meta.env values, so local development keeps working
 * unchanged.
 */

export interface FrontendRuntimeConfig {
  sso: {
    enabled: boolean;
    url: string;
    realm: string;
    clientId: string;
    idpHint: string;
    redirectUri: string;
  };
  api: {
    baseUrl: string;
  };
  cartoBasemapApiKey: string;
}

declare global {
  interface Window {
    __ENERPLANET_CONFIG__?: Partial<FrontendRuntimeConfig>;
  }
}

function injected(): Partial<FrontendRuntimeConfig> {
  if (typeof window !== "undefined" && window.__ENERPLANET_CONFIG__) {
    return window.__ENERPLANET_CONFIG__;
  }
  return {};
}

const env = injected();

export const runtimeConfig: FrontendRuntimeConfig = {
  sso: {
    enabled:
      env.sso?.enabled ??
      import.meta.env.VITE_SSO_ENABLED?.toLowerCase() === "true",
    url: env.sso?.url ?? import.meta.env.VITE_KEYCLOAK_URL ?? "",
    realm: env.sso?.realm ?? import.meta.env.VITE_KEYCLOAK_REALM ?? "spatialhub",
    clientId:
      env.sso?.clientId ??
      import.meta.env.VITE_KEYCLOAK_CLIENT_ID ??
      "spatialhub",
    idpHint: env.sso?.idpHint ?? import.meta.env.VITE_KEYCLOAK_IDP_HINT ?? "",
    redirectUri:
      env.sso?.redirectUri ??
      import.meta.env.VITE_KEYCLOAK_REDIRECT_URI ??
      "",
  },
  api: {
    baseUrl: env.api?.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "/api",
  },
  cartoBasemapApiKey:
    env.cartoBasemapApiKey ??
    import.meta.env.VITE_CARTO_BASEMAP_API_KEY ??
    "",
};
