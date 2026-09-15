/**
 * The route path the ModelBuilder is mounted on (under the /app context).
 *
 * The feature's on/off state is no longer an env flag — it is a user-toggleable
 * feature flag (see `src/features/settings/flags.ts` / `flags-store.ts`).
 * `App.tsx` mounts this route only while the `modelbuilder` flag is enabled.
 */
export const MODELBUILDER_ROUTE = "/app/modelbuilder";