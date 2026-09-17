import { useEffect, useState } from 'react';

import {
  createDefaultDataset,
  formatEnergyValue,
  getDerivedData,
  mergeUploadedData,
  parseCsv,
  pickUpdatedRows,
  toProfileZip,
  type DatasetByResolution,
  type EnergyTotals,
  type EnergyType,
  type LoadDataPoint,
  type Resolution,
} from '@/features/configurator/building-config/panel/lib/loadProfile';

interface UseLoadProfileStateArgs {
  buildingId: string;
  initialTimeseries?: LoadDataPoint[];
  mode?: 'basic' | 'expert';
  onTotalsChange?: (totals: EnergyTotals) => void;
  /** Fired whenever the user uploads a file — the uploaded rows become ground truth for the annual totals elsewhere in the app. */
  onGroundTruthChange?: (rows: LoadDataPoint[] | null, label: string | null) => void;
}

/** Owns viewer-specific state while delegating parsing and aggregation to pure helpers. */
export function useLoadProfileState({
  buildingId,
  initialTimeseries,
  mode = 'basic',
  onTotalsChange,
  onGroundTruthChange,
}: UseLoadProfileStateArgs) {
  const [energyType, setEnergyType] = useState<EnergyType>(mode === 'basic' ? 'combined' : 'electricity');
  const [resolution, setResolution] = useState<Resolution>(mode === 'basic' ? 'monthly' : 'daily');
  const [dataset, setDataset] = useState<DatasetByResolution>(() => {
    if (initialTimeseries && initialTimeseries.length > 0) {
      return { ...createDefaultDataset(), hourly: initialTimeseries };
    }
    return createDefaultDataset();
  });
  const [sourceLabel, setSourceLabel] = useState(() => (
    initialTimeseries && initialTimeseries.length > 0 ? 'BUEM model output' : 'No profile loaded'
  ));
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'basic') return;
    setResolution('monthly');
    setEnergyType('combined');
  }, [mode]);

  useEffect(() => {
    if (!initialTimeseries || initialTimeseries.length === 0) return;
    setDataset({ ...createDefaultDataset(), hourly: initialTimeseries });
    setSourceLabel('BUEM model output');
    setUploadError(null);
  }, [initialTimeseries]);

  const derivedData = getDerivedData(dataset, resolution);
  const data = derivedData.rows;
  const hasData = data.length > 0;

  const unit = resolution === 'hourly'
    ? 'kW'
    : resolution === 'daily'
      ? 'kWh/day'
      : resolution === 'weekly'
        ? 'kWh/week'
        : 'kWh/month';

  const sourceCaption = !derivedData.isDerived || !derivedData.sourceResolution || derivedData.sourceResolution === resolution
    ? sourceLabel
    : `${sourceLabel} · ${resolution} view aggregated from ${derivedData.sourceResolution}`;

  const calculateTotal = (key: 'electricity' | 'heating' | 'hotwater') => {
    if (!hasData) return '—';
    return formatEnergyValue(data.reduce((sum, point) => sum + point[key], 0), 6);
  };

  useEffect(() => {
    if (!onTotalsChange) return;
    onTotalsChange({
      electricity: calculateTotal('electricity'),
      heating: calculateTotal('heating'),
      hotwater: calculateTotal('hotwater'),
      unit,
    });
  }, [dataset, onTotalsChange, resolution, unit]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploadError(null);

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const text = String(loadEvent.target?.result ?? '');
        const nextDataset = file.name.toLowerCase().endsWith('.csv')
          ? { ...dataset, [resolution]: parseCsv(text, resolution) }
          : mergeUploadedData(dataset, JSON.parse(text), resolution);

        setDataset(nextDataset);
        setSourceLabel(file.name);
        onGroundTruthChange?.(pickUpdatedRows(dataset, nextDataset), file.name);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not parse load profile file.';
        setUploadError(message);
      }
    };
    reader.readAsText(file);
  };

  const handleDownload = () => {
    if (!hasData) return;
    const blob = new Blob([toProfileZip(data, resolution)], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${buildingId.toLowerCase().replace(/\s+/g, '-')}-load-profiles-${resolution}.zip`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return {
    data,
    derivedData,
    energyType,
    handleDownload,
    handleFileUpload,
    hasData,
    resolution,
    setEnergyType,
    setResolution,
    sourceCaption,
    unit,
    uploadError,
  };
}
