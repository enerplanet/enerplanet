import { describe, expect, it } from "vitest";
import { SITE_BUILDING_LIMIT, areaBuildingLimit } from "./areaLimit";

describe("areaBuildingLimit", () => {
  it("is the user's limit in default mode, 0 meaning none", () => {
    expect(areaBuildingLimit(100, false)).toBe(100);
    expect(areaBuildingLimit(0, false)).toBe(0);
  });

  it("never exceeds the custom grid cap", () => {
    expect(areaBuildingLimit(50, true)).toBe(50);
    expect(areaBuildingLimit(200, true)).toBe(SITE_BUILDING_LIMIT);
    expect(areaBuildingLimit(0, true)).toBe(SITE_BUILDING_LIMIT);
  });
});
