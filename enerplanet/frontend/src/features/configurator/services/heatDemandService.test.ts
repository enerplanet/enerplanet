import { describe, expect, it } from "vitest";
import { buildingTypesFromVariantCodes, countryNameForIso2 } from "./heatDemandService";

describe("countryNameForIso2", () => {
  it("maps a known ISO2 code to the canonical country name", () => {
    expect(countryNameForIso2("DE")).toBe("germany");
    expect(countryNameForIso2("nl")).toBe("netherlands");
    expect(countryNameForIso2("GB")).toBe("uk");
  });

  it("returns undefined for an unknown or missing code", () => {
    expect(countryNameForIso2("ZZ")).toBeUndefined();
    expect(countryNameForIso2(undefined)).toBeUndefined();
  });
});

describe("buildingTypesFromVariantCodes", () => {
  it("extracts the distinct TABULA type from each code, sorted", () => {
    const codes = [
      "DE.N.SFH.01.Gen",
      "DE.N.SFH.05.Gen",
      "DE.N.MFH.03.Gen",
      "DE.N.TH.02.Gen",
    ];
    expect(buildingTypesFromVariantCodes(codes)).toEqual(["MFH", "SFH", "TH"]);
  });

  it("ignores malformed codes with no 3rd segment", () => {
    expect(buildingTypesFromVariantCodes(["DE.N", "not-a-code"])).toEqual([]);
  });

  it("returns an empty list for no codes", () => {
    expect(buildingTypesFromVariantCodes([])).toEqual([]);
  });
});
