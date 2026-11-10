import { describe, expect, it } from "vitest";

import { appliesDefault } from "./ProductPickerDialog";

describe("appliesDefault", () => {
  it("applies PV for one building without asking, whatever the catalogue holds", () => {
    expect(appliesDefault("pv_supply", 2, false)).toBe(true);
  });

  it("asks for PV on all buildings, for the usable roof share", () => {
    expect(appliesDefault("pv_supply", 1, true)).toBe(false);
  });

  it("asks for other types only when they have more than one product", () => {
    expect(appliesDefault("battery_storage", 2, false)).toBe(false);
    expect(appliesDefault("battery_storage", 1, false)).toBe(true);
  });

  it("applies nothing when the type has no product", () => {
    expect(appliesDefault("pv_supply", 0, false)).toBe(false);
  });
});
