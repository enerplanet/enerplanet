import { describe, expect, it } from "vitest";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { clearTechs } from "./useTechDragDrop";

const building = (props: Record<string, unknown>) => new Feature({ geometry: new Point([0, 0]), feature_type: "building", ...props });

describe("clearTechs", () => {
  it("removes every technology and heat link, and counts only the buildings that had any", () => {
    const manual = building({ techs: { pv_supply: { alias: "PV", arrays: [{ surface: "r1" }] }, battery_storage: { alias: "Battery" } } });
    const auto = building({ techs: { air_source_heat_pump: { alias: "Heat pump" } } });
    const linked = building({ techs: {}, heat_supplier: "1001832407" });
    const bare = building({});

    expect(clearTechs([manual, auto, linked, bare])).toBe(3);

    for (const f of [manual, auto, linked]) {
      expect(f.get("techs")).toEqual({});
      expect(f.get("heat_supplier")).toBeUndefined();
    }
    expect(bare.get("techs")).toBeUndefined();
  });

  it("sets a new techs object so listeners see the change", () => {
    const techs = { air_source_heat_pump: { alias: "Heat pump" } };
    const f = building({ techs });
    let changes = 0;
    f.on("propertychange", (e) => { if (e.key === "techs") changes++; });

    clearTechs([f]);

    expect(changes).toBe(1);
    expect(techs).toEqual({ air_source_heat_pump: { alias: "Heat pump" } });
  });
});
