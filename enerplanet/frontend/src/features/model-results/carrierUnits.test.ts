import { describe, it, expect } from 'vitest';
import {
  CARRIER_LABELS,
  carrierDisplay,
  carrierEnergyAxis,
  carrierLabelKey,
  carrierPowerAxis,
  formatCarrierEnergy,
  formatCarrierPower,
  isGenerationCarrier,
  normalizeCarrier,
  sameCarrier,
} from './carrierUnits';

describe('carrierUnits', () => {
  it('treats the empty label as the backend default (electricity)', () => {
    expect(normalizeCarrier('')).toBe('power');
    expect(normalizeCarrier(undefined)).toBe('power');
    expect(normalizeCarrier(' Electricity ')).toBe('power');

    const display = carrierDisplay('');
    expect(display.energyUnit).toBe('kWh');
    expect(display.powerUnit).toBe('kW');
    expect(display.generation).toBe(true);
    expect(display.labelKey).toBe('results.carrier.electricity');
  });

  it('reports heat as a non-generating energy carrier in kWh', () => {
    const display = carrierDisplay('heat');
    expect(display.kind).toBe('energy');
    expect(display.energyUnit).toBe('kWh');
    expect(display.generation).toBe(false);
    expect(carrierLabelKey('thermal')).toBe('results.carrier.heat');
    expect(isGenerationCarrier('heat')).toBe(false);
    expect(isGenerationCarrier('power')).toBe(true);
  });

  it('maps a volumetric fuel carrier to m³ without changing the numbers', () => {
    const display = carrierDisplay('natural_gas');
    expect(display.kind).toBe('volume');
    expect(display.energyUnit).toBe('m³');
    expect(display.powerUnit).toBe('m³/h');
    expect(display.generation).toBe(false);
    expect(formatCarrierEnergy(1234.56, 'natural_gas')).toContain('m³');
    expect(formatCarrierEnergy(1234.56, 'natural_gas')).toContain('1,234.6');
    expect(formatCarrierPower(3.456, 'oil')).toContain('m³/h');
  });

  it('never dresses an unknown carrier up as electricity', () => {
    const display = carrierDisplay('hydrogen');
    expect(display.labelKey).toBeUndefined();
    expect(display.generation).toBe(false);
    expect(carrierLabelKey('hydrogen')).toBeUndefined();
    expect(CARRIER_LABELS.hydrogen).toBeUndefined();
  });

  it('compares carriers case-insensitively with electricity ≡ power', () => {
    expect(sameCarrier('electricity', 'power')).toBe(true);
    expect(sameCarrier('Heat', 'heat')).toBe(true);
    expect(sameCarrier('heat', 'power')).toBe(false);
    expect(sameCarrier(undefined, '')).toBe(true);
    expect(sameCarrier('heat', undefined)).toBe(false);
  });

  it('formats energy and power in the carrier unit', () => {
    expect(formatCarrierEnergy(1500, 'power')).toBe('1.50 MWh');
    expect(formatCarrierEnergy(42.25, 'heat')).toBe('42.3 kWh');
    expect(formatCarrierEnergy(2_500_000, 'power')).toBe('2.50 GWh');
    expect(formatCarrierPower(2.5, 'heat')).toBe('2.50 kW');
    expect(formatCarrierPower(1500, 'power')).toBe('1.50 MW');
    expect(formatCarrierPower(0, 'heat')).toBe('0.0 kW');
  });

  it('is safe for non-finite values', () => {
    expect(formatCarrierEnergy(NaN, 'heat')).toBe('0 kWh');
    expect(formatCarrierPower(Infinity, 'heat')).toBe('0 kW');
  });

  it('builds unit-suffixed axis labels from the carrier', () => {
    expect(carrierEnergyAxis('Energy', 'heat')).toBe('Energy (kWh)');
    expect(carrierEnergyAxis('Energy', 'natural_gas')).toBe('Energy (m³)');
    expect(carrierPowerAxis('Power', 'heat')).toBe('Power (kW)');
    expect(carrierPowerAxis('Flow', 'natural_gas')).toBe('Flow (m³/h)');
  });
});
