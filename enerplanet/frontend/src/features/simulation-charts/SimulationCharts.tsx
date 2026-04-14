import { FC, useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  GitCompare,
  ArrowRight,
  X,
  Loader2,
  BarChart3,
  ArrowLeft,
  Zap,
  TrendingUp,
  DollarSign,
  Sun,
  Network,
  Gauge,
  AlertCircle,
  Download,
  Map as MapIcon
} from 'lucide-react';
import { modelService, Model } from '@/features/model-dashboard/services/modelService';
import { Workspace } from '@/components/workspace/services/workspaceService';
import { useWorkspaceStore } from '@/components/workspace/store/workspace-store';
import { WorkspaceSelector } from '@/components/workspace/WorkspaceSelector';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button } from '@spatialhub/ui';
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

// Metric Card Component
const MetricCard: FC<{
  icon: React.ElementType;
  label: string;
  value: string;
  subtitle?: string;
  colorKey: string;
}> = ({ icon: Icon, label, value, subtitle }) => {
  return (
    <div className="bg-card border border-border rounded-xl p-3 flex items-center gap-3 hover:shadow-sm transition-shadow">
      <div className="p-2 bg-muted rounded-lg">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground font-medium truncate">{label}</p>
        <p className="text-base font-bold text-foreground truncate">{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
      </div>
    </div>
  );
};

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
    <div className="h-full bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-card border-b border-border flex-shrink-0">
        {/* Accent strip */}
        <div className="h-[3px] bg-muted" />

        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/app/model-dashboard')}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-muted-foreground" />
              </button>

              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-muted rounded-lg">
                  <GitCompare className="w-5 h-5 text-foreground" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-foreground tracking-tight">{t('simulationComparison.title')}</h1>
                  <p className="text-xs text-muted-foreground">
                    {t('simulationComparison.subtitle')}
                  </p>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            {hasComparison && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowMaps(!showMaps)}
                  className="flex items-center gap-2"
                >
                  <MapIcon className="w-4 h-4" />
                  {showMaps ? t('simulationComparison.hideMaps') : t('simulationComparison.showMaps')}
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleExportPDF}
                  disabled={isExporting}
                  className="flex items-center gap-2"
                >
                  {isExporting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {t('simulationComparison.exportPdf')}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Comparison Controls */}
        <div className="px-6 pb-3">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 items-center">

            {/* Side 1 - Baseline */}
            <div className="bg-card border border-border rounded-lg px-3 py-2">
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
            <div className="bg-card border border-border rounded-lg px-3 py-2">
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
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedModelId2(undefined)}
                        className="shrink-0 h-8 w-8"
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Summary Metrics Bar - Only show when we have comparison */}
        {hasComparison && summary1 && summary2 && (
          <div className="px-6 pb-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <MetricCard
                icon={Zap}
                label={t('simulationComparison.metrics.demandBaseline')}
                value={formatEnergy(summary1.total_demand_kwh)}
                colorKey="demand"
              />
              <MetricCard
                icon={Sun}
                label={t('simulationComparison.metrics.renewableGen')}
                value={formatEnergy(summary1.renewable_production_kwh)}
                colorKey="renewable"
              />
              <MetricCard
                icon={Network}
                label={t('simulationComparison.metrics.gridImport')}
                value={formatEnergy(summary1.grid_import_kwh)}
                colorKey="grid"
              />
              <MetricCard
                icon={TrendingUp}
                label={t('simulationComparison.metrics.selfSufficiency')}
                value={formatPercent(summary1.self_sufficiency_rate * 100)}
                colorKey="sufficiency"
              />
              <MetricCard
                icon={Gauge}
                label={t('simulationComparison.metrics.peakDemand')}
                value={formatPower(summary1.peak_demand_kw)}
                colorKey="peak"
              />
              <MetricCard
                icon={DollarSign}
                label={t('simulationComparison.metrics.totalCost')}
                value={`€${summary1.total_cost_eur.toLocaleString('de-DE', { maximumFractionDigits: 0 })}`}
                colorKey="cost"
              />
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto bg-muted/30 p-6">
        {(() => {
          if (isLoading) {
            return (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <div className="relative mx-auto mb-6 w-16 h-16">
                    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500/20 to-violet-500/20 animate-pulse" />
                    <div className="absolute inset-2 rounded-full bg-card flex items-center justify-center">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                  </div>
                  <p className="text-muted-foreground font-medium">{t('simulationComparison.loading')}</p>
                </div>
              </div>
            );
          }
          if (!model1 || !model2) {
            return (
              <div className="bg-card rounded-xl border border-border border-dashed">
                <div className="flex flex-col items-center justify-center text-center py-16">
                  <div className="relative mb-6">
                    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500/20 via-indigo-500/15 to-violet-500/20 blur-sm scale-110" />
                    <div className="relative p-5 bg-muted rounded-full">
                      <BarChart3 className="w-12 h-12 text-muted-foreground/60" />
                    </div>
                  </div>
                  <h2 className="text-lg font-bold text-foreground mb-2">{t('simulationComparison.selectModels')}</h2>
                  <p className="text-muted-foreground max-w-md">
                    {t('simulationComparison.selectModelsDescription')}
                  </p>
                  {!selectedModelId1 && (
                    <div className="mt-5 px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                      <p className="text-sm text-blue-700 dark:text-blue-300">
                        {t('simulationComparison.startBySelectingBaseline')}
                      </p>
                    </div>
                  )}
                  {selectedModelId1 && !selectedModelId2 && (
                    <div className="mt-5 px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                      <p className="text-sm text-amber-700 dark:text-amber-300">
                        {t('simulationComparison.nowSelectComparison')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          }
          if (error1 || error2) {
            return (
              <div className="bg-card rounded-xl border border-destructive/30 overflow-hidden">
                <div className="h-1 bg-gradient-to-r from-red-500 to-rose-500" />
                <div className="flex flex-col items-center justify-center text-center py-10 px-8">
                  <div className="p-4 bg-destructive/10 rounded-full mb-4">
                    <AlertCircle className="w-10 h-10 text-destructive" />
                  </div>
                  <h2 className="text-lg font-bold text-foreground mb-2">{t('simulationComparison.unableToLoadResults')}</h2>
                  <div className="text-sm text-muted-foreground max-w-md space-y-1">
                    {error1 && <p>{t('simulationComparison.errors.baseline')}: {error1}</p>}
                    {error2 && <p>{t('simulationComparison.errors.comparison')}: {error2}</p>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-4">
                    Try selecting different models or check that the simulations completed successfully.
                  </p>
                </div>
              </div>
            );
          }
          if (hasComparison && summary1 && summary2) {
            return (
              <div ref={contentRef} className="space-y-6">
                {/* Side-by-side Maps */}
                {showMaps && (
                  <ComparisonMapPanel model1={model1} model2={model2} />
                )}

                {/* Summary Cards */}
                <ComparisonSummary
                  data1={summary1}
                  data2={summary2}
                />

                {/* Charts */}
                <ComparisonCharts
                  results1={structuredResults1}
                  results2={structuredResults2}
                />
              </div>
            );
          }
          return null;
        })()}
      </div>
    </div>
  );
};
