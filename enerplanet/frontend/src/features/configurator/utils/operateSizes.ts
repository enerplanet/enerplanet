/** Constraints operate mode needs finite, per technology. PV arrays are sized from their
 * surfaces and supply markets need no limit. Must match operateSizeFields in the backend's
 * internal/jobs/operate_sizes.go. */
export const OPERATE_SIZE_FIELDS: Record<string, string[]> = {
  battery_storage: ["cont_energy_cap_max", "cont_storage_cap_max"],
  air_source_heat_pump: ["cont_energy_cap_max"],
  ground_source_heat_pump: ["cont_energy_cap_max"],
  electric_boilers: ["cont_energy_cap_max"],
  gas_boiler: ["cont_energy_cap_max"],
  air_conditioner: ["cont_energy_cap_max"],
};

/** A technology on a building with the size fields it lacks. */
export interface UnsizedTech {
  techKey: string;
  fields: string[];
}

type BuildingTechs = Record<string, { constraints?: { key: string; value: unknown }[] } | undefined>;

/** Whether a constraint value is a finite number, as operate mode needs for a size. */
export const isFiniteValue = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string" && value.trim() !== "") return Number.isFinite(Number(value));
  return false;
};

/** The building's technologies that lack a finite size for operate mode. */
export function unsizedTechs(techs: BuildingTechs | undefined): UnsizedTech[] {
  const out: UnsizedTech[] = [];
  for (const [techKey, tech] of Object.entries(techs ?? {})) {
    const fields = (OPERATE_SIZE_FIELDS[techKey] ?? []).filter(
      (field) => !isFiniteValue(tech?.constraints?.find((c) => c.key === field)?.value),
    );
    if (fields.length > 0) out.push({ techKey, fields });
  }
  return out;
}
