import { describe, expect, it } from "vitest";

import { unsizedTechs } from "./operateSizes";

const tech = (values: Record<string, unknown>) => ({ constraints: Object.entries(values).map(([key, value]) => ({ key, value })) });

describe("unsizedTechs", () => {
  it("lists batteries and air conditioners without a finite size, not heat technologies", () => {
    expect(unsizedTechs({
      air_source_heat_pump: tech({ cont_energy_cap_max: "INF", cont_energy_eff: 3.3 }),
      battery_storage: tech({ cont_energy_cap_max: 10, cont_storage_cap_max: "inf" }),
      gas_boiler: tech({}),
      air_conditioner: tech({ cont_energy_cap_max: "INF" }),
    })).toEqual([
      { techKey: "battery_storage", fields: ["cont_storage_cap_max"] },
      { techKey: "air_conditioner", fields: ["cont_energy_cap_max"] },
    ]);
  });

  it("accepts finite sizes, PV and supply markets", () => {
    expect(unsizedTechs({
      air_conditioner: tech({ cont_energy_cap_max: "12" }),
      battery_storage: tech({ cont_energy_cap_max: 10, cont_storage_cap_max: 20 }),
      pv_supply: tech({ cont_energy_cap_max: "INF" }),
      gas_supply: tech({ cont_energy_cap_max: "INF" }),
    })).toEqual([]);
    expect(unsizedTechs(undefined)).toEqual([]);
  });
});
