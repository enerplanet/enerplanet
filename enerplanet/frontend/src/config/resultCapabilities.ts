import type { PyPSAModelResults } from '@/features/model-results/api';

// Pipeline that produced a model's parsed results. Mirrors the backend's
// resultcapabilities.Source (internal/result/capabilities/capabilities.go).
export type ResultSource = 'legacy' | 'meme' | 'full-grid-pf';

// Set of data a result contains. Mirrors the backend JSON key-for-key.
//
// A false value means "this result does not contain that data" — a consumer
// must HIDE the component, not render an empty state, because an empty state
// reads as a clean bill of health for a check that never ran.
export interface Capabilities {
  convergence: boolean;
  voltage: boolean;
  power: boolean;
  transformers: boolean;
  lineLoading: boolean;
  utilizationOnly: boolean;
  curtailment: boolean;
  losses: boolean;
}

// Least capable: claims nothing. Used when the response carries no
// capabilities block, so a stale backend can never un-hide a section.
export const LEAST_CAPABLE: Capabilities = {
  convergence: false,
  voltage: false,
  power: false,
  transformers: false,
  lineLoading: false,
  utilizationOnly: false,
  curtailment: false,
  losses: false,
};

// Capabilities are a pure function of the declared source in the backend; the
// response hands them over directly. Absent/unparseable block => least capable.
export const capabilitiesFrom = (
  pypsaData: PyPSAModelResults | null | undefined,
): Capabilities => {
  const declared = pypsaData?.capabilities;
  if (!declared) return LEAST_CAPABLE;
  return { ...LEAST_CAPABLE, ...declared };
};
