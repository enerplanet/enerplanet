import type { AdvancedParameter, AdvancedParametersState } from "@/features/configurator/types/area-select";

export const ADVANCED_PARAMETERS: AdvancedParameter[] = [
  {
    id: 'scenario',
    name: 'Scenario',
    description: 'Target year for the scenario',
    type: 'select',
    defaultValue: '2030',
    options: [
      { value: '2030', label: '2030' },
      { value: '2040', label: '2040' },
      { value: '2050', label: '2050' },
    ],
  },
  {
    id: 'line_type_lv',
    name: 'LV Cable Type',
    description: 'Low voltage cable type for distribution network',
    type: 'select',
    defaultValue: 'NAYY 4x150 SE',
    options: [
      { value: 'NAYY 4x185 SE', label: 'NAYY 4x185 SE (33 €/m)' },
      { value: 'NAYY 4x150 SE', label: 'NAYY 4x150 SE (24 €/m)' },
      { value: 'NAYY 4x120 SE', label: 'NAYY 4x120 SE (19 €/m)' },
      { value: 'NAYY 4x95 SE', label: 'NAYY 4x95 SE (16 €/m)' },
      { value: 'NAYY 4x50 SE', label: 'NAYY 4x50 SE (11 €/m)' },
      { value: 'NYY 4x70 SE', label: 'NYY 4x70 SE (28 €/m)' },
      { value: 'NYY 4x35 SE', label: 'NYY 4x35 SE (16 €/m)' },
      { value: 'NYY 4x16 SE', label: 'NYY 4x16 SE (7 €/m)' },
    ],
  },
  {
    id: 'line_type_mv',
    name: 'MV Cable Type',
    description: 'Medium voltage cable type for distribution network',
    type: 'select',
    defaultValue: 'NA2XS2Y 1x185 RM/25 12/20 kV',
    options: [
      { value: 'NA2XS2Y 1x185 RM/25 12/20 kV', label: 'NA2XS2Y 1x185 RM/25 12/20 kV' },
      { value: 'NA2XS2Y 1x150 RM/25 12/20 kV', label: 'NA2XS2Y 1x150 RM/25 12/20 kV' },
      { value: 'NA2XS2Y 1x120 RM/25 12/20 kV', label: 'NA2XS2Y 1x120 RM/25 12/20 kV' },
      { value: 'NA2XS2Y 3x1x150', label: 'NA2XS2Y 3x1x150' },
    ],
  },
  {
    id: 'trafo_mv_lv_type',
    name: 'Transformer Type',
    description: 'MV/LV transformer type and rating',
    type: 'select',
    defaultValue: '0.4 MVA 20/0.4 kV',
    options: [
      { value: '0.1 MVA 20/0.4 kV', label: '100 kVA (20/0.4 kV)' },
      { value: '0.16 MVA 20/0.4 kV', label: '160 kVA (20/0.4 kV)' },
      { value: '0.25 MVA 20/0.4 kV', label: '250 kVA (20/0.4 kV)' },
      { value: '0.4 MVA 20/0.4 kV', label: '400 kVA (20/0.4 kV)' },
      { value: '0.63 MVA 20/0.4 kV', label: '630 kVA (20/0.4 kV)' },
      { value: '0.8 MVA 20/0.4 kV', label: '800 kVA (20/0.4 kV)' },
      { value: '1 MVA 20/0.4 kV', label: '1000 kVA (20/0.4 kV)' },
      { value: '1.25 MVA 20/0.4 kV', label: '1250 kVA (20/0.4 kV)' },
      { value: '1.6 MVA 20/0.4 kV', label: '1600 kVA (20/0.4 kV)' },
      { value: '2 MVA 20/0.4 kV', label: '2000 kVA (20/0.4 kV)' },
      { value: '2.5 MVA 20/0.4 kV', label: '2500 kVA (20/0.4 kV)' },
    ],
  },
  {
    id: 'co2_limit',
    name: 'CO2 Limit (tonnes)',
    description: 'Maximum allowed CO2 emissions',
    type: 'number',
    defaultValue: 120000000,
    min: 0,
    step: 1000000,
  },
  {
    id: 'max_hours',
    name: 'Max Battery Hours',
    description: 'Maximum duration of battery storage',
    type: 'number',
    defaultValue: 72,
    min: 0,
    step: 1,
  },
  {
    id: 'solver',
    name: 'Solver',
    description: 'Optimization solver to use',
    type: 'select',
    defaultValue: 'glpk',
    options: [
      { value: 'glpk', label: 'GLPK' },
      { value: 'cbc', label: 'CBC' },
      { value: 'gurobi', label: 'Gurobi' },
      { value: 'highs', label: 'HiGHS' },
    ],
  },
  {
    id: 'autarky',
    name: 'Autarky Level',
    description: 'Degree of self-sufficiency (0-1)',
    type: 'number',
    defaultValue: 0,
    min: 0,
    max: 1,
    step: 0.01,
  },
];

export const getDefaultAdvancedParameters = (): AdvancedParametersState => {
  const params = ADVANCED_PARAMETERS.reduce((acc, param) => {
    if (param.type === 'range') {
      // @ts-expect-error - dynamic key assignment
      acc[param.id] = param.defaultValue as { min: number; max: number };
    } else {
      // @ts-expect-error - dynamic key assignment
      acc[param.id] = param.defaultValue;
    }
    return acc;
  }, {} as AdvancedParametersState);

  params.pypsa_enabled = true;

  return params;
};
