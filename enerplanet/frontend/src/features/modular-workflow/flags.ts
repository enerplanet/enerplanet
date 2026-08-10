/**
 * Feature flag for the ModelBuilder (modular-workflow) feature.
 *
 * There is no central flags mechanism in the app yet, so this uses a simple
 * env-based flag with a constant fallback. Set `VITE_MODELBUILDER_ENABLED=true`
 * in the environment to enable the route.
 */
const ENV_FLAG = import.meta.env.VITE_MODELBUILDER_ENABLED;

/** Constant fallback — flip to `true` to enable without an env var. */
const DEFAULT_ENABLED = false;

export const MODELBUILDER_ENABLED: boolean =
  ENV_FLAG === undefined ? DEFAULT_ENABLED : ENV_FLAG === "true";

/** The route path the ModelBuilder is mounted on. */
export const MODELBUILDER_ROUTE = "/modelbuilder";
