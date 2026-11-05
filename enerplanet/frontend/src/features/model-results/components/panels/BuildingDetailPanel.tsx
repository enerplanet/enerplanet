import { useState, useEffect, useMemo, useCallback } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Activity, Euro, GitMerge, Loader2, Sun, Zap } from "lucide-react";
import { fetchLocationTimeSeries, LocationTimeSeriesData } from "../../api";
import { BuildingResultData } from "../map/ResultsMapTypes";
import { useTranslation } from "@spatialhub/i18n";
import { formatCurrency, formatNumber } from "@/utils/formatNumber";
import { useThemeColors } from "@/features/simulation-charts/pypsa/chartUtils";
import { carrierDisplay, formatCarrierEnergy, formatCarrierPower } from "../../carrierUnits";
import { allocateFlows, ambientHeat, CarrierResult, flowLabel, installedCapacities, selfSufficiency, summariseFlows } from "../../buildingFlows";
import SaveChartButton from "../ui/SaveChartButton";
import ChartInfoTooltip from "../ui/ChartInfoTooltip";
import { BuildingProfileChart, ProfileResolution, Season } from "./BuildingProfileChart";

interface WindTurbineInfo {
  nominal_power: number;
  hub_height: number[];
  rotor_diameter: number;
  turbine_id: number;
}

interface BuildingDetailPanelProps {
  building: BuildingResultData;
  modelId: number;
  carrier?: string;
  /** Carriers the run has results for. */
  carriers?: string[];
  /** Grid prices of the run, ct/kWh; used to price this building's line exchange. */
  gridPrices?: { import_ct_per_kwh: number; export_ct_per_kwh: number };
  turbineData?: Record<string, WindTurbineInfo>;
  /** Heated floor area BuEM used (A_ref), m². */
  floorArea?: number;
}

type TFn = ReturnType<typeof useTranslation>["t"];

const PANEL_CLASS = "rounded-xl border border-border bg-card p-3 shadow-sm";
const SIDE_PANEL_CLASS = "h-full rounded-xl border border-border bg-card px-3 py-2 shadow-sm";
const AMBIENT_COLOR = "#84cc16";
/** Runs at least this long count as a year, matching the Cost tab. */
const FULL_YEAR_HOURS = 8760 * 0.95;

/** Installed capacities at the node, one row per technology; PV summed over the roof surfaces. */
function installedHere(data: LocationTimeSeriesData | undefined) {
  return installedCapacities(data?.energy_cap ?? []);
}

/** Small uppercase heading with an optional info icon for the explanation. */
function CardTitle({ icon: Icon, title, info, saveAs, children }: { icon: typeof Zap; title: string; info?: string; saveAs?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
        {info && <ChartInfoTooltip title={title} description={info} />}
        {saveAs && <SaveChartButton name={saveAs} />}
      </h4>
      {children}
    </div>
  );
}

/** One headline figure in the header row. */
function Kpi({ label, value, unit, info }: { label: string; value: string; unit?: string; info?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card px-2.5 py-1.5 shadow-sm">
      <div className="flex items-center text-[10px] uppercase text-muted-foreground">
        <span className="leading-tight">{label}</span>
        {info && <ChartInfoTooltip title={label} description={info} />}
      </div>
      <div className="whitespace-nowrap text-base font-semibold tabular-nums text-foreground">
        {value}{unit && value !== "–" && <span className="ml-1 text-[11px] font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

/** Row of small toggle buttons. */
export function Toggle<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)}
          className={`rounded px-2 py-0.5 text-xs ${v === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Supplies to uses over the run, all carriers in one diagram, joined at the heat pump. */
/** Splits a long name at the space nearest its middle, so compact labels need less width. */
function twoLines(name: string): string {
  if (name.length <= 16) return name;
  const spaces = [...name.matchAll(/ /g)].map((m) => m.index!);
  if (spaces.length === 0) return name;
  const cut = spaces.reduce((best, i) => (Math.abs(i - name.length / 2) < Math.abs(best - name.length / 2) ? i : best));
  return `${name.slice(0, cut)}\n${name.slice(cut + 1)}`;
}

/** `compact` wraps long names, puts each value with one decimal under its name, and narrows the side margins. */
export function BuildingSankey({ results, t, label = flowLabel, compact = false }: { results: CarrierResult[]; t: TFn; label?: typeof flowLabel; compact?: boolean }) {
  const colors = useThemeColors();
  const option = useMemo<EChartsOption>(() => {
    const nodes = new Map<string, string>();
    const links: { source: string; target: string; value: number }[] = [];
    for (const r of results) {
      const name = (key: string) => label(key, r.carrier, t);
      r.flows.forEach((f) => nodes.set(name(f.key), f.color));
      for (const l of allocateFlows(r.flows)) {
        if (l.kwh > 0.5 && name(l.from) !== name(l.to)) links.push({ source: name(l.from), target: name(l.to), value: l.kwh });
      }
    }
    const ambient = t("results.buildingDetail.flow.ambient", "Ambient heat");
    for (const a of ambientHeat(results.flatMap((r) => r.flows))) {
      nodes.set(ambient, AMBIENT_COLOR);
      links.push({ source: ambient, target: label(a.key, "heat", t), value: a.kwh });
    }
    const targets = new Set(links.map((l) => l.target));
    return {
      animation: false,
      tooltip: {
        trigger: "item",
        confine: true,
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        textStyle: { color: colors.text, fontSize: 11 },
        formatter: (p: any) => p.dataType === "edge"
          ? `${p.data.source} → ${p.data.target}<br/>${formatCarrierEnergy(p.data.value, "power")}`
          : `${p.name}<br/>${formatCarrierEnergy(p.value, "power")}`,
      },
      series: [{
        type: "sankey",
        left: compact ? 95 : 170, right: compact ? 125 : 230, top: 8, bottom: 8,
        nodeWidth: 14,
        nodeGap: compact ? 24 : 16,
        draggable: false,
        emphasis: { focus: "adjacency" },
        data: [...nodes].map(([name, color]) => ({
          name,
          itemStyle: { color, borderColor: color },
          label: { position: targets.has(name) ? "right" as const : "left" as const },
        })),
        links,
        lineStyle: { color: "gradient", curveness: 0.5, opacity: 0.45 },
        label: { color: colors.text, fontSize: 11, formatter: (p: any) => `${compact ? twoLines(p.name) : p.name}${compact ? "\n" : "  "}{v|${formatCarrierEnergy(p.value, "power", compact ? 1 : 2)}}`, rich: { v: { color: colors.textMuted, fontSize: 10 } } },
      }],
    };
  }, [results, t, colors, label, compact]);
  return <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge />;
}

/** Installed capacities at the node: PV in kWp, battery as power and storage. */
function InstalledPanel({ data, t, windName }: { data?: LocationTimeSeriesData; t: TFn; windName?: string }) {
  const rows = installedHere(data).map((r) => {
    const name = r.family.includes("wind") && windName ? windName : flowLabel(r.family, "power", t);
    if (r.family.includes("pv")) return [name, `${formatNumber(r.kw, 1)} kWp`];
    return [name, r.kwh > 0 ? `${formatNumber(r.kw, 1)} kW · ${formatNumber(r.kwh, 1)} kWh` : `${formatNumber(r.kw, 1)} kW`];
  });
  return (
    <div className={SIDE_PANEL_CLASS}>
      <CardTitle icon={Sun} title={t("results.buildingDetail.installedTechnologies", "Installed technologies")} />
      <table className="mt-1 w-full text-xs">
        <tbody>
          {rows.map(([name, value]) => (
            <tr key={name} className="border-t border-border/60 first:border-0">
              <td className="py-0.5 text-foreground">{name}</td>
              <td className="py-0.5 text-right tabular-nums whitespace-nowrap text-foreground">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">{t("results.buildingDetail.nothingInstalled", "No equipment at this building.")}</p>}
    </div>
  );
}

interface CostLine { label: string; value: number; color: string; bold?: boolean }

/** This building's line exchange at the run's prices, plus equipment and gas cost where the run stores them. */
function costLines(data: LocationTimeSeriesData | undefined, power: CarrierResult | undefined,
  gridPrices: BuildingDetailPanelProps["gridPrices"], t: TFn): CostLine[] {
  if (!gridPrices || !power) return [];
  const flow = (key: string) => power.flows.find((f) => f.key === key);
  const stored = (gas: boolean) => (data?.costs ?? [])
    .filter((c) => c.costs === "monetary" && c.value > 0 && c.techs.endsWith("_import") === gas)
    .reduce((s, c) => s + c.value, 0);
  const equipment = stored(false);
  const gas = stored(true);
  const bought = ((flow("lineIn")?.totalKwh ?? 0) * gridPrices.import_ct_per_kwh) / 100;
  const sold = ((flow("lineOut")?.totalKwh ?? 0) * gridPrices.export_ct_per_kwh) / 100;
  const lines: CostLine[] = [
    { label: t("results.buildingDetail.importCost", "Import cost"), value: bought, color: flow("lineIn")?.color ?? "#94a3b8" },
    { label: t("results.buildingDetail.exportRevenue", "Export revenue"), value: -sold, color: flow("lineOut")?.color ?? "#0d9488" },
  ];
  if (equipment > 0) lines.push({ label: t("results.buildingDetail.equipment", "Equipment"), value: equipment, color: "#f59e0b" });
  if (gas > 0) lines.push({ label: t("results.buildingDetail.gas", "Gas"), value: gas, color: "#a16207" });
  lines.push({ label: t("results.buildingDetail.netTotal", "Net total"), value: bought - sold + equipment + gas, color: "#3b82f6", bold: true });
  return lines;
}

/** Cost over the run as horizontal bars around a zero line: costs to the right, revenue to the left. */
function CostPanel({ lines, gridPrices, t }: { lines: CostLine[]; gridPrices: BuildingDetailPanelProps["gridPrices"]; t: TFn }) {
  const max = Math.max(1, ...lines.map((l) => Math.abs(l.value)));
  const info = gridPrices && t("results.buildingDetail.costInfo",
    "Electricity bought at {{imp}} ct/kWh and sold at {{exp}} ct/kWh. Some of the bought electricity may be a neighbour's PV, which the model does not charge for. Equipment cost appears only when the run stores it.",
    { imp: formatNumber(gridPrices.import_ct_per_kwh, 1), exp: formatNumber(gridPrices.export_ct_per_kwh, 1) });
  return (
    <div className={SIDE_PANEL_CLASS}>
      <CardTitle icon={Euro} title={t("results.buildingDetail.runCost", "Cost over the run")} info={info || undefined} />
      <div className="mt-1.5 space-y-1">
        {lines.map((l) => (
          <div key={l.label} className={`grid grid-cols-[6rem_1fr_4rem] items-center gap-2 text-xs ${l.bold ? "font-semibold" : ""}`}>
            <span className="truncate text-foreground">{l.label}</span>
            <div className="relative h-3">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
              <div className="absolute inset-y-0 rounded-sm" style={{
                background: l.color,
                width: `${(Math.abs(l.value) / max) * 50}%`,
                [l.value < 0 ? "right" : "left"]: "50%",
              }} />
            </div>
            <span className="text-right tabular-nums text-foreground">{formatCurrency(l.value, 0)}</span>
          </div>
        ))}
      </div>
      {lines.length === 0 && <p className="text-xs text-muted-foreground">{t("results.buildingDetail.noPrices", "No grid prices for this run.")}</p>}
    </div>
  );
}

/** Loads the node's results for every carrier of the run. */
function useBuildingResults(modelId: number, location: string | undefined, carriers: string[]) {
  const [byCarrier, setByCarrier] = useState<Record<string, LocationTimeSeriesData>>({});
  const [loading, setLoading] = useState(false);
  const key = carriers.join(",");
  useEffect(() => {
    if (!location) return;
    const controller = new AbortController();
    setLoading(true);
    Promise.all(key.split(",").map((c) => fetchLocationTimeSeries(modelId, location, undefined, undefined, c, controller.signal)))
      .then((list) => {
        const next: Record<string, LocationTimeSeriesData> = {};
        key.split(",").forEach((c, i) => { if (list[i]) next[c] = list[i]!; });
        setByCarrier(next);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [modelId, location, key]);
  return { byCarrier, loading };
}

/** Headline figures for the header row; a dash where the run lacks the input. */
function kpiTiles(results: CarrierResult[], installed: ReturnType<typeof installedHere>, lines: CostLine[], floorArea: number | undefined, t: TFn) {
  const power = results.find((r) => r.carrier === "power")?.flows ?? [];
  const fullYear = (results[0]?.timesteps.length ?? 0) >= FULL_YEAR_HOURS;
  const heatDemand = results.find((r) => r.carrier === "heat")?.flows.find((f) => f.key === "demand")?.totalKwh;
  const pvKwh = power.find((f) => f.key === "pv_supply")?.totalKwh;
  const pvKwp = installed.find((r) => r.family === "pv_supply")?.kw;
  const share = selfSufficiency(power);
  const net = lines.find((l) => l.bold)?.value;
  const peak = power.find((f) => f.key === "lineIn")?.peakKw;
  const dash = "–";
  return [
    { label: t("results.buildingDetail.kpi.selfSufficiency", "Self-sufficiency"), value: share == null ? dash : `${formatNumber(share * 100, 0)}%`,
      info: t("results.buildingDetail.kpi.selfSufficiencyInfo", "Share of the electricity used here that did not come from the street line: 1 minus line import divided by use (Luthander et al., 2015).") },
    { label: t("results.buildingDetail.kpi.netCost", "Net energy cost"), value: net == null ? dash : formatCurrency(net, 0),
      info: t("results.buildingDetail.kpi.netCostInfo", "Over the run, as in the cost breakdown below.") },
    { label: t("results.buildingDetail.kpi.peakImport", "Peak grid import"), value: peak == null ? dash : formatCarrierPower(peak, "power") },
    { label: t("results.buildingDetail.kpi.specificHeat", "Specific heat demand"),
      value: heatDemand && floorArea ? formatNumber(heatDemand / floorArea, 0) : dash, unit: fullYear ? "kWh/m²a" : "kWh/m²",
      info: t("results.buildingDetail.kpi.specificHeatInfo", "Space heating and hot water of the run, divided by the heated floor area BuEM used.") },
    { label: t("results.buildingDetail.kpi.pvYield", "PV specific yield"),
      value: pvKwh && pvKwp ? formatNumber(pvKwh / pvKwp, 0) : dash, unit: "kWh/kWp",
      info: t("results.buildingDetail.kpi.pvYieldInfo", "PV generation of the run divided by the PV capacity on all roof surfaces.") },
  ];
}

const BuildingDetailPanel = ({ building, modelId, carrier = "", carriers, gridPrices, turbineData = {}, floorArea }: BuildingDetailPanelProps) => {
  const { t } = useTranslation();
  const carrierList = carriers && carriers.length > 0
    ? [...carriers].sort((a, b) => Number(b === "power") - Number(a === "power"))
    : [carrier || "power"];
  const { byCarrier, loading } = useBuildingResults(modelId, building.matchedLocationId, carrierList);
  const [profileCarrier, setProfileCarrier] = useState(carrierList[0]);
  const [resolution, setResolution] = useState<ProfileResolution>("monthly");
  const [season, setSeason] = useState<Season>("winter");

  const results = useMemo<CarrierResult[]>(() =>
    carrierList
      .filter((c) => byCarrier[c])
      .map((c) => ({ carrier: c, ...summariseFlows(byCarrier[c].production ?? [], byCarrier[c].consumption ?? [], c) }))
      .filter((r) => r.flows.length > 0),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [byCarrier, carrierList.join(",")]);

  const anyData = byCarrier[carrierList[0]] ?? Object.values(byCarrier)[0];
  const installed = installedHere(anyData);
  const lines = costLines(anyData, results.find((r) => r.carrier === "power"), gridPrices, t);
  const kpis = kpiTiles(results, installed, lines, floorArea, t);
  const profile = results.find((r) => r.carrier === profileCarrier) ?? results[0];
  const label = useCallback((key: string) => flowLabel(key, profile?.carrier ?? "power", t), [profile?.carrier, t]);
  const carrierName = (c: string) => { const d = carrierDisplay(c); return d.labelKey ? t(d.labelKey, c) : c; };

  const header = results.length > 0 && (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 @min-[720px]:grid-cols-5">
      {kpis.map((k) => <Kpi key={k.label} {...k} />)}
    </div>
  );

  if (loading || results.length === 0) {
    return (
      <div className="space-y-3 p-3">
        {header}
        <div className={`${PANEL_CLASS} flex items-center gap-2 text-sm text-muted-foreground`}>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {loading ? t("results.buildingDetail.loadingTimeSeries", "Loading time series...")
            : building.matchedLocationId ? t("results.buildingDetail.noEnergyData") : t("results.buildingDetail.noSimulationLinked")}
        </div>
      </div>
    );
  }

  return (
    <div className="@container space-y-3 p-3">
      {header}

      <div className="grid gap-3 sm:grid-cols-2">
        <InstalledPanel data={anyData} t={t} windName={Object.keys(turbineData)[0]} />
        <CostPanel lines={lines} gridPrices={gridPrices} t={t} />
      </div>

      <div className={PANEL_CLASS}>
        <CardTitle icon={GitMerge} title={t("results.buildingDetail.energyFlowRun", "Energy flow over the run")} saveAs="building-energy-flow"
          info={t("results.buildingDetail.sankeyInfoRun", "Each hour, the energy supplied is shared over that hour's uses in proportion to their size, then summed over the run. The run reports totals per technology, so the split between sources is an estimate. Ambient heat is what the heat pump takes from the air or ground: its heat output minus its electricity input.")} />
        {/* Width capped so the three node columns stay close enough for the links to read. */}
        <div className="mx-auto h-[340px] w-full max-w-5xl">
          <BuildingSankey results={results} t={t} />
        </div>
      </div>

      <div className={PANEL_CLASS}>
        <CardTitle icon={Activity} title={t("results.buildingDetail.profile", "Sources and uses")} saveAs="sources-and-uses"
          info={t("results.buildingDetail.profileInfo", "Above zero: where the energy comes from. Below zero: what it is used for. The typical day averages each hour of the day over the selected months, in kW. Winter is December to February, summer June to August.")}>
          <div className="flex flex-wrap justify-end gap-2">
            {results.length > 1 && (
              <Toggle value={profile.carrier} onChange={setProfileCarrier}
                options={results.map((r) => [r.carrier, carrierName(r.carrier)] as [string, string])} />
            )}
            <Toggle value={resolution} onChange={setResolution} options={[
              ["monthly", t("results.buildingDetail.monthly", "Monthly")],
              ["daily", t("results.buildingDetail.daily", "Daily")],
              ["typical", t("results.buildingDetail.typicalDay", "Typical day")],
            ]} />
            {resolution === "typical" && (
              <Toggle value={season} onChange={setSeason} options={[
                ["winter", t("results.buildingDetail.winter", "Winter")],
                ["summer", t("results.buildingDetail.summer", "Summer")],
                ["year", t("results.buildingDetail.wholeYear", "Whole year")],
              ]} />
            )}
          </div>
        </CardTitle>
        <div className="h-[340px]">
          <BuildingProfileChart timesteps={profile.timesteps} flows={profile.flows} carrier={profile.carrier} label={label}
            resolution={resolution} season={season}
            emptyText={t("results.energy.noHoursInSeason", "No hour of this run falls in these months.")} />
        </div>
      </div>
    </div>
  );
};

export default BuildingDetailPanel;
