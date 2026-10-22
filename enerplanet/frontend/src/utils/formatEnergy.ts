/**
 * An energy amount in kWh as a rounded, readable string. Below 10,000 of a
 * unit the value stays in that unit, then moves up to MWh and GWh; values
 * under 100 keep one decimal, larger ones are whole numbers.
 */
export function formatEnergy(kwh: number): string {
  const units = ['kWh', 'MWh', 'GWh'];
  let value = kwh;
  let i = 0;
  while (Math.abs(value) >= 10_000 && i < units.length - 1) {
    value /= 1000;
    i++;
  }
  const digits = i > 0 && Math.abs(value) < 100 ? 1 : 0;
  return `${value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[i]}`;
}
