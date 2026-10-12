import type { RunContext } from '@thd-spatial-ai/building-configurator';

/**
 * The period a configurator BuEM run covers, from the model's dates
 * (YYYY-MM-DD, as the model store holds them): the first hour of fromDate to
 * the last hour of toDate. Undefined when either is unset, so the package
 * falls back to its default period.
 */
export function modelRunContext(fromDate: string, toDate: string): RunContext | undefined {
  if (!fromDate || !toDate) return undefined;
  return { startDate: `${fromDate}T00:00:00Z`, endDate: `${toDate}T23:00:00Z` };
}
