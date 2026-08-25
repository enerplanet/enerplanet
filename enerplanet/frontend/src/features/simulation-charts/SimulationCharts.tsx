import { FC, useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  GitCompare,
  ArrowRight,
  X,
  Loader2,
  BarChart3,
  ArrowLeft,
  AlertCircle,
  Download,
  Map as MapIcon
} from 'lucide-react';
import { modelService, Model } from '@/features/model-dashboard/services/modelService';
import { Workspace } from '@/components/workspace/services/workspaceService';
import { useWorkspaceStore } from '@/components/workspace/store/workspace-store';
import { WorkspaceSelector } from '@/components/workspace/WorkspaceSelector';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@spatialhub/ui';
import { StatsStrip } from '@/components/ui/StatsStrip';
import { CardGridSkeleton, PanelSkeleton } from '@/components/ui/Skeletons';
import {
  PRIMARY_BUTTON_CLASS,
  TOOLBAR_BUTTON_CLASS,
  TOOLBAR_ICON_BUTTON_CLASS,
} from '@/components/ui/toolbar';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { fetchStructuredResults } from '@/features/model-results/api';
import { StructuredModelResults } from '@/features/model-results/types';
import { ComparisonSummary } from './components/ComparisonSummary';
import { ComparisonCharts } from './components/ComparisonCharts';
import { ComparisonMapPanel } from './components/ComparisonMapPanel';
import { exportComparisonPDF } from '@/features/model-results/utils/pdfExport';
import { useTranslation } from '@spatialhub/i18n';

interface SimulationChartsProps {
  modelId?: number;
}

const FLOATING_POINT_EPSILON = 1e-6;

function normalizeDisplayValue(value: number, precision: number = 3): number {
  if (!Number.isFinite(value)) return 0;

  const normalized = Number(value.toFixed(precision));
  return Math.abs(normalized) < FLOATING_POINT_EPSILON ? 0 : normalized;
}

// Format energy value with appropriate units
function formatEnergy(kwh: number): string {
  if (kwh >= 1000000) {
    return `${(kwh / 1000000).toFixed(2)} GWh`;
  } else if (kwh >= 1000) {
    return `${(kwh / 1000).toFixed(2)} MWh`;
  }
  return `${kwh.toFixed(1)} kWh`;
}

function formatPower(kw: number): string {
  const abs = Math.abs(kw);
  if (!Number.isFinite(kw)) return '0';
  if (abs >= 1000) return `${(kw / 1000).toFixed(2)} MW`;
  if (abs >= 1) return `${kw.toFixed(1)} kW`;
  if (abs >= 0.001) return `${(kw * 1000).toFixed(1)} W`;
  if (abs === 0) return '0.0 kW';
  return `${(kw * 1_000_000).toFixed(1)} mW`;
}

function formatPercent(value: number, digits: number = 1): string {
  const normalized = normalizeDisplayValue(value, digits + 1);
  return `${normalized.toFixed(digits)}%`;
}

function isMonetaryCost(costType?: string): boolean {
  const normalized = (costType || '').toLowerCase();
  if (!normalized) return true;
  if (normalized.includes('monetary') || normalized.includes('money') || normalized.includes('eur') || normalized.includes('euro')) {
    return true;
  }
  if (normalized.includes('co2') || normalized.includes('emission') || normalized.includes('carbon') || normalized.includes('ghg')) {
    return false;
  }
  return true;
}


// Calculate summary from structured results (uses server-side aggregates)
function calculateSummary(structured: StructuredModelResults) {
  const totalProduction = Math.abs(structured.sum_production || 0);
  const totalConsumption = Math.abs(structured.sum_consumption || 0);
  const renewableProduction = Math.abs(structured.renewable_production || 0);
  const gridImport = Math.abs(structured.grid_import || 0);
  const peakDemandRaw = Math.abs(structured.peak_demand || 0);
  const timesteps = structured.timestep_count || 8760;

  const totalCost = structured.cost?.reduce((sum, c) => {
    if (!isMonetaryCost(c.costs)) return sum;
    return sum + Math.abs(c.value);
  }, 0) || 0;

  const structuredLcoe = (structured.model_total_levelised_cost || []).find((row) => {
    return (row.carrier || '').toLowerCase() === 'power' && isMonetaryCost(row.costs);
  });
  const lcoe = structuredLcoe
    ? Math.abs(structuredLcoe.value)
    : (renewableProduction > 0 ? totalCost / renewableProduction : 0);

  const co2Savings = renewableProduction * 0.4;

  const selfSufficiencyRate = totalConsumption > 0
    ? normalizeDisplayValue(Math.min(1, renewableProduction / totalConsumption), 6)
    : 0;

  const totalSupply = renewableProduction + gridImport;
  const gridDependencyRate = totalSupply > 0
    ? normalizeDisplayValue(gridImport / totalSupply, 6)
    : 1;

  return {
    total_generation_kwh: totalProduction,
    total_demand_kwh: totalConsumption,
    renewable_production_kwh: renewableProduction,
    grid_import_kwh: gridImport,
    self_sufficiency_rate: selfSufficiencyRate,
    grid_dependency_rate: gridDependencyRate,
    peak_demand_kw: peakDemandRaw,
    average_demand_kw: totalConsumption / timesteps,
    total_cost_eur: totalCost,
    lcoe_eur_kwh: lcoe,
    co2_savings_kg: co2Savings,
  };
}

export const SimulationCharts: FC<SimulationChartsProps> = ({ modelId: propModelId }) => {
  const { modelId: paramModelId } = useParams<{ modelId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useDocumentTitle(t('simulationComparison.title'), ' | EnerPlanET');

  const { currentWorkspace: defaultWorkspace } = useWorkspaceStore();

  const [workspace1, setWorkspace1] = useState<Workspace | null>(defaultWorkspace);
  const [workspace2, setWorkspace2] = useState<Workspace | null>(defaultWorkspace);

  const [availableModels1, setAvailableModels1] = useState<Model[]>([]);
  const [availableModels2, setAvailableModels2] = useState<Model[]>([]);

  const [selectedModelId1, setSelectedModelId1] = useState<string | undefined>(
    paramModelId || (propModelId ? String(propModelId) : undefined) || searchParams.get('model1') || undefined
  );
  const [selectedModelId2, setSelectedModelId2] = useState<string | undefined>(searchParams.get('model2') || undefined);

  const [model1, setModel1] = useState<Model | null>(null);
  const [model2, setModel2] = useState<Model | null>(null);

  const [structuredResults1, setStructuredResults1] = useState<StructuredModelResults | null>(null);
  const [structuredResults2, setStructuredResults2] = useState<StructuredModelResults | null>(null);

  const [loading1, setLoading1] = useState(false);
  const [loading2, setLoading2] = useState(false);
  const [error1, setError1] = useState<string | null>(null);
  const [error2, setError2] = useState<string | null>(null);

  // Map and export state
  const [showMaps, setShowMaps] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Export handler
  const handleExportPDF = async () => {
    if (!contentRef.current || !model1 || !model2) return;

    setIsExporting(true);
    try {
      await exportComparisonPDF(contentRef.current, model1, model2, {
        title: t('simulationComparison.pdfTitle'),
        subtitle: `${model1.title} vs ${model2.title}`,
      });
    } catch (error) {
      console.error('Failed to export PDF:', error);
    } finally {
      setIsExporting(false);
    }
  };

  // Sync with store workspace initially
  useEffect(() => {
    if (defaultWorkspace && !workspace1) setWorkspace1(defaultWorkspace);
    if (defaultWorkspace && !workspace2) setWorkspace2(defaultWorkspace);
  }, [defaultWorkspace]);

  // Fetch models for side 1
  useEffect(() => {
    const fetchModels1 = async () => {
      try {
        const params: { limit?: number; workspace_id?: number } = { limit: 100 };
        if (workspace1?.id) params.workspace_id = workspace1.id;

        const response = await modelService.getModels(params);
        if (response.success) {
          setAvailableModels1(response.data.filter(m => m.status === 'completed'));
        }
      } catch (error) {
        console.error('Failed to fetch models for side 1:', error);
      }
    };
    fetchModels1();
  }, [workspace1]);

  // Fetch models for side 2
  useEffect(() => {
    const fetchModels2 = async () => {
      try {
        const params: { limit?: number; workspace_id?: number } = { limit: 100 };
        if (workspace2?.id) params.workspace_id = workspace2.id;

        const response = await modelService.getModels(params);
        if (response.success) {
          setAvailableModels2(response.data.filter(m => m.status === 'completed'));
        }
      } catch (error) {
        console.error('Failed to fetch models for side 2:', error);
      }
    };
    fetchModels2();
  }, [workspace2]);

  // Fetch model 1 details and structured results
  useEffect(() => {
    if (!selectedModelId1) {
      setModel1(null);
      setStructuredResults1(null);
      setError1(null);
      return;
    }

    const fetchModel1Data = async () => {
      setLoading1(true);
      setError1(null);
      try {
        const modelId = Number(selectedModelId1);

        // Fetch model info
        const response = await modelService.getModelById(modelId);
        if (response.success) {
          setModel1(response.data);
        } else {
          throw new Error('Failed to fetch model');
        }

        // Fetch structured results
        const structured = await fetchStructuredResults(modelId);
        if (structured) {
          setStructuredResults1(structured);
        } else {
          setError1('No simulation results available');
        }
      } catch (error) {
        console.error(`Failed to fetch model ${selectedModelId1}:`, error);
        setError1('Failed to load model data');
      } finally {
        setLoading1(false);
      }
    };
    fetchModel1Data();
  }, [selectedModelId1]);

  // Fetch model 2 details and structured results
  useEffect(() => {
    if (!selectedModelId2) {
      setModel2(null);
      setStructuredResults2(null);
      setError2(null);
      return;
    }

    const fetchModel2Data = async () => {
      setLoading2(true);
      setError2(null);
      try {
        const modelId = Number(selectedModelId2);

        // Fetch model info
        const response = await modelService.getModelById(modelId);
        if (response.success) {
          setModel2(response.data);
        } else {
          throw new Error('Failed to fetch model');
        }

        // Fetch structured results
        const structured = await fetchStructuredResults(modelId);
        if (structured) {
          setStructuredResults2(structured);
        } else {
          setError2('No simulation results available');
        }
      } catch (error) {
        console.error(`Failed to fetch model ${selectedModelId2}:`, error);
        setError2('Failed to load model data');
      } finally {
        setLoading2(false);
      }
    };
    fetchModel2Data();
  }, [selectedModelId2]);

  // Calculate summaries from structured results
  const summary1 = useMemo(() => {
    if (!structuredResults1) return null;
    return calculateSummary(structuredResults1);
  }, [structuredResults1]);

  const summary2 = useMemo(() => {
    if (!structuredResults2) return null;
    return calculateSummary(structuredResults2);
  }, [structuredResults2]);

  const renderModelSelect = (
    models: Model[],
    value: string | undefined,
    onChange: (val: string) => void,
    placeholder: string,
    excludeId?: string
  ) => (
    <div className="w-full">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full bg-background border-border">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {models.length === 0 ? (
            <div className="p-2 text-sm text-muted-foreground text-center">{t('simulationComparison.noCompletedModels')}</div>
          ) : (
            models
              .filter(m => String(m.id) !== excludeId)
              .map((model) => (
                <SelectItem key={model.id} value={String(model.id)}>
                  <span className="flex items-center justify-between w-full gap-2">
                    <span className="truncate">{model.title}</span>
                    <span className="text-xs text-muted-foreground">{new Date(model.created_at).toLocaleDateString()}</span>
                  </span>
                </SelectItem>
              ))
          )}
        </SelectContent>
      </Select>
    </div>
  );

  const isLoading = loading1 || loading2;
  const hasComparison = model1 && model2 && structuredResults1 && structuredResults2;

  return (
    <div className="md-scope flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-border bg-card">
        <div className="px-4 py-4 sm:px-6">
          <div className="md-rise flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/app/model-dashboard')}
                className={TOOLBAR_ICON_BUTTON_CLASS}
                aria-label={t('common.back')}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card shadow-sm">
                  <GitCompare className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{t('simulationComparison.title')}</h1>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {t('simulationComparison.subtitle')}
                  </p>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            {hasComparison && (
              <div className="md-fade-in flex items-center gap-2">
                <button
                  onClick={() => setShowMaps(!showMaps)}
                  className={TOOLBAR_BUTTON_CLASS}
                >
                  <MapIcon className="h-4 w-4 text-muted-foreground" />
                  {showMaps ? t('simulationComparison.hideMaps') : t('simulationComparison.showMaps')}
                </button>
                <button
                  onClick={handleExportPDF}
                  disabled={isExporting}
                  className={PRIMARY_BUTTON_CLASS}
                >
                  {isExporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {t('simulationComparison.exportPdf')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Comparison Controls */}
        <div className="px-4 pb-3 sm:px-6">
          <div className="md-rise grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 items-center" style={{ animationDelay: '60ms' }}>

            {/* Side 1 - Baseline */}
            <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-sm transition-colors duration-150 hover:border-muted-foreground/30">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">{t('simulationComparison.baseline')}</span>
                {model1 && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    {model1.region || t('simulationComparison.noRegion')}
                  </span>
                )}
              </div>
              <div className="flex gap-2 mt-1.5">
                <div className="w-1/3 min-w-[120px]">
                  <WorkspaceSelector
                    activeWorkspace={workspace1}
                    onWorkspaceChange={setWorkspace1}
                  />
                </div>
                <div className="flex-1">
                  {renderModelSelect(availableModels1, selectedModelId1, setSelectedModelId1, t('simulationComparison.selectBaselineModel'), selectedModelId2)}
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="hidden md:flex justify-center">
              <div className="p-1.5 bg-muted border border-border rounded-full">
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
            </div>

            {/* Side 2 - Comparison */}
            <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-sm transition-colors duration-150 hover:border-muted-foreground/30">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">{t('simulationComparison.comparison')}</span>
                {model2 && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    {model2.region || t('simulationComparison.noRegion')}
                  </span>
                )}
              </div>
              <div className="flex gap-2 mt-1.5">
                <div className="w-1/3 min-w-[120px]">
                  <WorkspaceSelector
                    activeWorkspace={workspace2}
                    onWorkspaceChange={setWorkspace2}
                  />
                </div>
                <div className="flex-1">
                  <div className="flex gap-1">
                    {renderModelSelect(availableModels2, selectedModelId2, setSelectedModelId2, t('simulationComparison.selectComparisonModel'), selectedModelId1)}
                    {selectedModelId2 && (
                      <button
                        onClick={() => setSelectedModelId2(undefined)}
                        aria-label={t('common.clear')}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Summary Metrics Bar - Only show when we have comparison */}
        {hasComparison && summary1 && summary2 && (
          <div className="px-4 pb-4 sm:px-6">
            <StatsStrip
              className="md-fade-in"
              items={[
                { label: t('simulationComparison.metrics.demandBaseline'), value: formatEnergy(summary1.total_demand_kwh) },
                { label: t('simulationComparison.metrics.renewableGen'), value: formatEnergy(summary1.renewable_production_kwh) },
                { label: t('simulationComparison.metrics.gridImport'), value: formatEnergy(summary1.grid_import_kwh) },
                { label: t('simulationComparison.metrics.selfSufficiency'), value: formatPercent(summary1.self_sufficiency_rate * 100) },
                { label: t('simulationComparison.metrics.peakDemand'), value: formatPower(summary1.peak_demand_kw) },
                {
                  label: t('simulationComparison.metrics.totalCost'),
                  value: `€${summary1.total_cost_eur.toLocaleString('de-DE', { maximumFractionDigits: 0 })}`,
                },
              ]}
            />
          </div>
        )}
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto bg-muted/30 p-4 sm:p-6">
        {(() => {
          if (isLoading) {
            return (
              <div className="space-y-5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{t('simulationComparison.loading')}</span>
                </div>
                <PanelSkeleton height="h-56" />
                <CardGridSkeleton cards={4} />
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <PanelSkeleton />
                  <PanelSkeleton />
                </div>
              </div>
            );
          }
          if (!model1 || !model2) {
            return (
              <div className="md-fade-in flex flex-col items-center rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
                  <BarChart3 className="h-7 w-7 text-muted-foreground" />
                </div>
                <h2 className="text-base font-semibold tracking-tight text-foreground">{t('simulationComparison.selectModels')}</h2>
                <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
                  {t('simulationComparison.selectModelsDescription')}
                </p>
                {!selectedModelId1 && (
                  <div className="mt-6 rounded-lg border border-border bg-muted/40 px-4 py-2">
                    <p className="text-sm text-muted-foreground">
                      {t('simulationComparison.startBySelectingBaseline')}
                    </p>
                  </div>
                )}
                {selectedModelId1 && !selectedModelId2 && (
                  <div className="mt-6 rounded-lg border border-border bg-muted/40 px-4 py-2">
                    <p className="text-sm text-muted-foreground">
                      {t('simulationComparison.nowSelectComparison')}
                    </p>
                  </div>
                )}
              </div>
            );
          }
          if (error1 || error2) {
            return (
              <div className="md-fade-in flex flex-col items-center rounded-xl border border-destructive/30 bg-card px-6 py-12 text-center shadow-sm">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
                  <AlertCircle className="h-7 w-7 text-destructive" />
                </div>
                <h2 className="text-base font-semibold tracking-tight text-foreground">{t('simulationComparison.unableToLoadResults')}</h2>
                <div className="mt-1.5 max-w-md space-y-1 text-sm text-muted-foreground">
                  {error1 && <p>{t('simulationComparison.errors.baseline')}: {error1}</p>}
                  {error2 && <p>{t('simulationComparison.errors.comparison')}: {error2}</p>}
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Try selecting different models or check that the simulations completed successfully.
                </p>
              </div>
            );
          }
          if (hasComparison && summary1 && summary2) {
            return (
              <div ref={contentRef} className="space-y-6">
                {/* Side-by-side Maps */}
                {showMaps && (
                  <div className="md-rise">
                    <ComparisonMapPanel model1={model1} model2={model2} />
                  </div>
                )}

                {/* Summary Cards */}
                <div className="md-rise" style={{ animationDelay: '60ms' }}>
                  <ComparisonSummary
                    data1={summary1}
                    data2={summary2}
                  />
                </div>

                {/* Charts */}
                <div className="md-rise" style={{ animationDelay: '120ms' }}>
                  <ComparisonCharts
                    results1={structuredResults1}
                    results2={structuredResults2}
                  />
                </div>
              </div>
            );
          }
          return null;
        })()}
      </div>
    </div>
  );
};
