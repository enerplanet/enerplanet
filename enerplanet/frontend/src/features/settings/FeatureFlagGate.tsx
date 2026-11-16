import type { ReactNode } from "react";
import { useFeatureFlag } from "./flags-store";
import type { FeatureFlagId } from "./flags";

interface FeatureFlagGateProps {
  /** Flag id from the registry — a typo is a compile error. */
  flag: FeatureFlagId;
  /** Rendered when the flag is off. Defaults to nothing. */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Declarative wrapper around `useFeatureFlag`.
 *
 *   <FeatureFlagGate flag="modelbuilder">
 *     <ModelBuilderLink />
 *   </FeatureFlagGate>
 *
 * Use it for anything that should appear/disappear live when the user flips the
 * toggle. For a route, gate the `<Route>` element itself; for a whole page,
 * prefer the hook + an early return.
 */
export function FeatureFlagGate({ flag, fallback = null, children }: FeatureFlagGateProps) {
  return <>{useFeatureFlag(flag) ? children : fallback}</>;
}

export default FeatureFlagGate;
