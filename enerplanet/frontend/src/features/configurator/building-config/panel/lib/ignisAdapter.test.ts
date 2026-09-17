import { describe, expect, it } from 'vitest';
import {
  ignisInputsFromTabulaData,
  applyTabulaUValuesToElements,
  restoreDefaultUValues,
  syncElementsWithVariantLevel,
  resetElementsToVariantDefaults,
  toIgnisApiPayload,
  type IgnisInputs,
} from './ignisAdapter';
import type { BuildingElement } from '@/features/configurator/building-config/panel/configure/model/buildingElements';

/**
 * Builds a fixture shaped exactly like the `tabula_data` object returned by
 * ignis's `GET /api/v1/data/:code` (see ignis/internal/models/tabula.go for
 * the nesting this mirrors). Every TABULA country uses this identical shape —
 * these fixtures exist to prove the fix in ignisAdapter.ts works uniformly
 * across countries, not because the shape itself differs per country.
 */
function tabulaDataFixture(values: {
  heatingDays: number;
  thetaE: number;
  thetaI: number;
  aRoof1: number;
  uRoof1: number;
  iSolSouth: number;
  deltaUOriginal: number;
}) {
  return {
    BasicParameters: {
      BuildingAppearance: { Code_BuildingVariant: 'X.SFH' },
      Envelope: {
        A_C_Ref_Input: 150.0,
        A_Roof_1: values.aRoof1,
        A_Roof_2: 0,
        A_Wall_1: 120.5,
        A_Wall_2: 0,
        A_Wall_3: 0,
        A_Floor_1: 75.0,
        A_Floor_2: 0,
        A_Window_1: 18.2,
        A_Window_2: 0,
        A_Window_South: 6.1,
        A_Window_East: 4.0,
        A_Window_West: 4.0,
        A_Window_North: 4.1,
        A_Door_1: 2.0,
      },
    },
    AdvancedParameters: {
      ClimateConditions: {
        HeatingDays: values.heatingDays,
        Theta_e: values.thetaE,
        theta_i: values.thetaI,
      },
      Uvalues: {
        U_Roof_1: values.uRoof1,
        U_Wall_1: 0.9,
        U_Floor_1: 1.1,
        U_Window_1: 1.8,
        U_Door_1: 2.0,
      },
      AirInfiltration: {
        n_air_infiltration: 0.15,
        n_air_use: 0.4,
      },
      HeatTransfer: {
        F_sh_hor: 1.0,
        F_sh_vert: 0.9,
        F_f: 0.7,
        F_w: 0.9,
        phi_int: 5.0,
        c_m: 165000,
      },
      SolarGains: {
        I_Sol_South: values.iSolSouth,
        I_Sol_East: 200,
        I_Sol_West: 200,
        I_Sol_North: 100,
        I_Sol_Hor: 300,
      },
      ThermalBridges: {
        delta_U_ThermalBridging_Original: values.deltaUOriginal,
        delta_U_ThermalBridging_Refurbished: 0.05,
      },
    },
  };
}

describe('ignisInputsFromTabulaData', () => {
  const fixtures = {
    DE: tabulaDataFixture({ heatingDays: 220, thetaE: -12, thetaI: 20, aRoof1: 80, uRoof1: 0.3, iSolSouth: 400, deltaUOriginal: 0.1 }),
    AT: tabulaDataFixture({ heatingDays: 240, thetaE: -14, thetaI: 20, aRoof1: 85, uRoof1: 0.25, iSolSouth: 380, deltaUOriginal: 0.1 }),
    FR: tabulaDataFixture({ heatingDays: 180, thetaE: -5, thetaI: 19, aRoof1: 70, uRoof1: 0.35, iSolSouth: 420, deltaUOriginal: 0.08 }),
    NL: tabulaDataFixture({ heatingDays: 212, thetaE: 6.6, thetaI: 20, aRoof1: 90, uRoof1: 0.28, iSolSouth: 350, deltaUOriginal: 0.09 }),
  };

  it.each(Object.entries(fixtures))('extracts nested climate fields correctly for %s', (_country, tabula) => {
    const result = ignisInputsFromTabulaData(tabula);
    const expected = tabula as ReturnType<typeof tabulaDataFixture>;

    expect(result.HeatingDays).toBe(expected.AdvancedParameters.ClimateConditions.HeatingDays);
    expect(result.Theta_e).toBe(expected.AdvancedParameters.ClimateConditions.Theta_e);
    expect(result.Theta_i).toBe(expected.AdvancedParameters.ClimateConditions.theta_i);

    // None of the climate fields should be 0/undefined as long as the fixture value isn't 0.
    expect(result.HeatingDays).not.toBe(0);
  });

  it.each(Object.entries(fixtures))('extracts nested envelope, U-value, solar and thermal-bridging fields for %s', (_country, tabula) => {
    const result = ignisInputsFromTabulaData(tabula);
    const expected = tabula as ReturnType<typeof tabulaDataFixture>;

    expect(result.A_C_Ref_Input).toBe(expected.BasicParameters.Envelope.A_C_Ref_Input);
    expect(result.A_Roof_1).toBe(expected.BasicParameters.Envelope.A_Roof_1);
    expect(result.A_Window_South).toBe(expected.BasicParameters.Envelope.A_Window_South);

    expect(result.U_Roof_1).toBe(expected.AdvancedParameters.Uvalues.U_Roof_1);

    expect(result.N_air_infiltration).toBe(expected.AdvancedParameters.AirInfiltration.n_air_infiltration);
    expect(result.Phi_int).toBe(expected.AdvancedParameters.HeatTransfer.phi_int);
    expect(result.C_m).toBe(expected.AdvancedParameters.HeatTransfer.c_m);

    expect(result.I_Sol_South).toBe(expected.AdvancedParameters.SolarGains.I_Sol_South);
    expect(result.I_Sol_Horizontal).toBe(expected.AdvancedParameters.SolarGains.I_Sol_Hor);

    expect(result.Delta_U_ThermalBridging_Original).toBe(
      expected.AdvancedParameters.ThermalBridges.delta_U_ThermalBridging_Original,
    );
  });

  it('rounds away float32-to-float64 widening noise from ignis Postgres REAL columns', () => {
    // These exact values reproduce what ignis actually returns: Postgres REAL
    // (single precision) read into Go float64, e.g. 4.6 becomes 4.599999904632568.
    const tabula = tabulaDataFixture({
      heatingDays: 216,
      thetaE: 4.599999904632568,
      thetaI: 20,
      aRoof1: 80,
      uRoof1: 0.3,
      iSolSouth: 400,
      deltaUOriginal: 0.10000000149011612,
    });
    tabula.AdvancedParameters.ThermalBridges.delta_U_ThermalBridging_Refurbished = 0.05000000074505806;

    const result = ignisInputsFromTabulaData(tabula);

    expect(result.Theta_e).toBe(4.6);
    expect(result.Delta_U_ThermalBridging_Original).toBe(0.1);
    expect(result.Delta_U_ThermalBridging_Refurbished).toBe(0.05);
  });

  it('falls back to A_C_Ref_Estim when A_C_Ref_Input is 0 (generic TABULA archetype rows, not a measured building)', () => {
    const tabula = tabulaDataFixture({ heatingDays: 216, thetaE: 4.6, thetaI: 20, aRoof1: 80, uRoof1: 0.3, iSolSouth: 400, deltaUOriginal: 0.1 });
    tabula.BasicParameters.Envelope.A_C_Ref_Input = 0;
    (tabula.BasicParameters.Envelope as any).A_C_Ref_Estim = 2190.1;

    const result = ignisInputsFromTabulaData(tabula);

    expect(result.A_C_Ref_Input).toBe(2190.1);
  });

  it('keeps a real, non-zero A_C_Ref_Input rather than overriding it with A_C_Ref_Estim', () => {
    const tabula = tabulaDataFixture({ heatingDays: 216, thetaE: 4.6, thetaI: 20, aRoof1: 80, uRoof1: 0.3, iSolSouth: 400, deltaUOriginal: 0.1 });
    (tabula.BasicParameters.Envelope as any).A_C_Ref_Estim = 999;

    const result = ignisInputsFromTabulaData(tabula);

    expect(result.A_C_Ref_Input).toBe(150.0);
  });

  it('returns undefined (not 0) for fields missing from a flat/malformed object, instead of silently matching the wrong shape', () => {
    // Regression guard for the original bug: a flat object (pre-fix assumption)
    // must not accidentally satisfy the nested lookup.
    const flatObject = { HeatingDays: 212, Theta_e: 6.6 };
    const result = ignisInputsFromTabulaData(flatObject);

    expect(result.HeatingDays).toBeUndefined();
    expect(result.Theta_e).toBeUndefined();
  });
});

describe('applyTabulaUValuesToElements / restoreDefaultUValues / syncElementsWithVariantLevel', () => {
  function element(overrides: Partial<BuildingElement>): BuildingElement {
    return {
      id: overrides.id ?? 'el-1',
      label: 'Test element',
      type: 'wall',
      area: 10,
      uValue: 1.5,
      gValue: null,
      tilt: 90,
      azimuth: 180,
      defaultUValue: 1.5, // the "real" as-measured value, stamped once
      ...overrides,
    };
  }

  const variantData: IgnisInputs = {
    U_Roof_1: 0.2,
    U_Wall_1: 0.25,
    U_Floor_1: 0.3,
    U_Window_1: 1.1,
    U_Door_1: 1.3,
  };

  it('applyTabulaUValuesToElements overwrites uValue per element type from the variant data', () => {
    const elements = {
      roof1:   element({ id: 'roof1', type: 'roof', uValue: 1.8, defaultUValue: 1.8 }),
      wall1:   element({ id: 'wall1', type: 'wall', uValue: 1.5, defaultUValue: 1.5 }),
      window1: element({ id: 'window1', type: 'window', uValue: 2.5, defaultUValue: 2.5 }),
    };

    const result = applyTabulaUValuesToElements(elements, variantData);

    expect(result.roof1.uValue).toBe(0.2);
    expect(result.wall1.uValue).toBe(0.25);
    expect(result.window1.uValue).toBe(1.1);
  });

  it('applyTabulaUValuesToElements leaves elements untouched when the variant lacks that category', () => {
    const elements = { wall1: element({ id: 'wall1', type: 'wall', uValue: 1.5 }) };
    const result = applyTabulaUValuesToElements(elements, { U_Roof_1: 0.2 }); // no U_Wall_1
    expect(result.wall1.uValue).toBe(1.5);
  });

  it('applyTabulaUValuesToElements returns the same reference when nothing changes', () => {
    const elements = { wall1: element({ id: 'wall1', type: 'wall', uValue: 0.25 }) };
    const result = applyTabulaUValuesToElements(elements, variantData); // already 0.25
    expect(result).toBe(elements);
  });

  it('restoreDefaultUValues restores the stamped real value, undoing any archetype override', () => {
    const elements = {
      wall1: element({ id: 'wall1', type: 'wall', uValue: 0.25, defaultUValue: 1.5 }), // overridden
    };
    const result = restoreDefaultUValues(elements);
    expect(result.wall1.uValue).toBe(1.5);
  });

  it('syncElementsWithVariantLevel restores real values for index 0 (existing state)', () => {
    const elements = { wall1: element({ id: 'wall1', type: 'wall', uValue: 0.25, defaultUValue: 1.5 }) };
    const result = syncElementsWithVariantLevel(elements, 0, variantData);
    expect(result.wall1.uValue).toBe(1.5);
  });

  it('syncElementsWithVariantLevel applies the archetype for a refurbished level (index > 0)', () => {
    const elements = { wall1: element({ id: 'wall1', type: 'wall', uValue: 1.5, defaultUValue: 1.5 }) };
    const result = syncElementsWithVariantLevel(elements, 1, variantData);
    expect(result.wall1.uValue).toBe(0.25);
  });

  it('resetElementsToVariantDefaults rebases both uValue and defaultUValue to the new archetype', () => {
    // Simulates switching building type: the previous type's real/stamped values (2.0)
    // must not survive as the new type's "existing state" baseline.
    const elements = {
      wall1: element({ id: 'wall1', type: 'wall', uValue: 2.0, defaultUValue: 2.0 }),
      roof1: element({ id: 'roof1', type: 'roof', uValue: 2.0, defaultUValue: 2.0 }),
    };
    const result = resetElementsToVariantDefaults(elements, variantData);
    expect(result.wall1.uValue).toBe(0.25);
    expect(result.wall1.defaultUValue).toBe(0.25);
    expect(result.roof1.uValue).toBe(0.2);
    expect(result.roof1.defaultUValue).toBe(0.2);
  });

  it('resetElementsToVariantDefaults returns the same reference when nothing changes', () => {
    const elements = { wall1: element({ id: 'wall1', type: 'wall', uValue: 0.25, defaultUValue: 0.25 }) };
    const result = resetElementsToVariantDefaults(elements, variantData);
    expect(result).toBe(elements);
  });
});

describe('toIgnisApiPayload', () => {
  it('returns undefined when calcDemand has no overridable fields set', () => {
    expect(toIgnisApiPayload({})).toBeUndefined();
  });

  it('includes only the fields that are present, using ignis\'s exact JSON keys', () => {
    const payload = toIgnisApiPayload({
      HeatingDays: 0,
      Theta_e: -5,
      Theta_i: 20,
      I_Sol_South: 400,
      I_Sol_Horizontal: 800,
      Delta_U_ThermalBridging_Original: 0.1,
    });
    expect(payload).toEqual({
      HeatingDays: 0,
      Theta_e: -5,
      theta_i: 20,
      I_Sol_South: 400,
      I_Sol_Hor: 800,
      delta_U_ThermalBridging_Original: 0.1,
    });
  });

  it('never sends A_ref: overriding it against a fixed archetype envelope distorts q_h_nd per m2', () => {
    expect(toIgnisApiPayload({ A_C_Ref_Input: 300 })).toBeUndefined();
    expect(toIgnisApiPayload({ A_C_Ref_Input: 300, HeatingDays: 200 })).toEqual({ HeatingDays: 200 });
  });

  it('omits fields the user has not touched rather than sending zeros for them', () => {
    const payload = toIgnisApiPayload({ HeatingDays: 200 });
    expect(payload).toEqual({ HeatingDays: 200 });
  });
});
