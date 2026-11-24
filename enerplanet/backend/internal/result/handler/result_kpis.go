package result

import (
	"errors"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"

	"platform.local/common/pkg/contracts"
	"platform.local/common/pkg/httputil"
	backendModels "spatialhub_backend/internal/models"
	resultStore "spatialhub_backend/internal/store/result"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Costs, LCOE, energy and installed capacity mirror the results dashboard
// (frontend model-results/ModelResultsViewer.tsx and buildingFlows.ts); keep
// them in step.

type modelKPIResponse struct {
	ModelID  uint       `json:"model_id"`
	Title    string     `json:"title"`
	Status   string     `json:"status"`
	FromDate time.Time  `json:"from_date"`
	ToDate   time.Time  `json:"to_date"`
	KPIs     *modelKPIs `json:"kpis"`
}

type modelKPIs struct {
	// Signed sum of monetary costs over the modelled period, EUR; feed-in income lowers it.
	TotalCostEUR float64 `json:"total_cost_eur"`
	// Annualised investment scaled to the modelled period, EUR; 0 when capacities were fixed.
	InvestmentCostEUR float64 `json:"investment_cost_eur"`
	// Levelised cost of electricity, EUR/kWh; null when the run stores no single value.
	LCOEEURPerKWh *float64 `json:"lcoe_eur_per_kwh"`
	// Demand not served, kWh, all carriers.
	UnmetDemandKWh float64 `json:"unmet_demand_kwh"`
	// Electricity over the modelled period, kWh.
	Energy            energyKPIs        `json:"energy_kwh"`
	InstalledCapacity []installedTech   `json:"installed_capacity"`
	CapacityFactor    []categoryPercent `json:"capacity_factor"`
	GridCheck         gridCheck         `json:"grid_check"`
}

type energyKPIs struct {
	Production          float64 `json:"production"`
	Consumption         float64 `json:"consumption"`
	RenewableProduction float64 `json:"renewable_production"`
	GridImport          float64 `json:"grid_import"`
}

type installedTech struct {
	Technology string `json:"technology"`
	// Power, kW (kWp for PV).
	KW float64 `json:"kw"`
	// Battery storage, kWh; 0 for other technologies.
	KWh       float64 `json:"kwh"`
	Buildings int     `json:"buildings"`
}

type categoryPercent struct {
	Category string `json:"category"`
	// Output over installed capacity times hours, percent.
	Percent float64 `json:"percent"`
}

// gridCheck reports whether the low-voltage power flow solved at every time
// step; available is false when the run has no grid calculation.
type gridCheck struct {
	Available      bool `json:"available"`
	Converged      bool `json:"converged"`
	ConvergedSteps *int `json:"converged_steps"`
	TotalSteps     *int `json:"total_steps"`
}

// GetModelKPIs returns the headline results of one model.
// @Summary Key results of a model
// @Description Title, status, modelled period and headline results. kpis is null until the model has completed. Costs are in EUR for the modelled period; energy in kWh on the electricity carrier.
// @Tags results
// @Produce json
// @Param id path int true "Model ID"
// @Success 200 {object} modelKPIResponse
// @Failure 403 {object} map[string]string
// @Failure 404 {object} map[string]string
// @Security SpatialHubBearer
// @Router /models/{id}/kpis [get]
func (h *ResultHandler) GetModelKPIs(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}
	model, ok := h.fetchModelByID(c, c.Param("id"))
	if !ok || !h.userHasModelAccess(c, model, userCtx) {
		return
	}
	resp := modelKPIResponse{ModelID: model.ID, Title: model.Title, Status: model.Status, FromDate: model.FromDate, ToDate: model.ToDate}
	if model.Status == contracts.StatusCompleted || model.Status == contracts.StatusPublished {
		kpis, err := h.loadKPIs(model.ID)
		if err != nil {
			httputil.InternalError(c, "Failed to load model results")
			return
		}
		resp.KPIs = kpis
	}
	httputil.SuccessResponse(c, resp)
}

func (h *ResultHandler) loadKPIs(modelID uint) (*modelKPIs, error) {
	var in kpiInputs
	var err error
	if in.cost, err = h.store.GetResultsCost(modelID); err != nil {
		return nil, err
	}
	if in.investment, err = h.store.GetResultsCostInvestment(modelID); err != nil {
		return nil, err
	}
	if in.lcoe, err = h.store.GetResultsModelTotalLevelisedCost(modelID); err != nil {
		return nil, err
	}
	if in.capacity, err = h.store.GetResultsEnergyCap(modelID); err != nil {
		return nil, err
	}
	if in.unmetDemand, err = h.store.GetUnmetDemandTotal(modelID); err != nil {
		return nil, err
	}
	if in.grid, err = h.gridCheck(modelID); err != nil {
		return nil, err
	}
	in.summaries = h.store.GetAllCarrierSummaries(modelID)
	kpis := computeKPIs(in)
	return &kpis, nil
}

// gridCheck reads the power-flow verdict the Grid tab shows: the bundle's
// convergence summary, else the legacy settings flag.
func (h *ResultHandler) gridCheck(modelID uint) (gridCheck, error) {
	if dir := h.pypsaExtractedPath(modelID); dir != "" {
		if summary, err := readPyPSAConvergenceSummary(dir); err == nil && summary.TotalSnapshots > 0 {
			return gridCheck{Available: true, Converged: summary.ConvergedSnapshots == summary.TotalSnapshots,
				ConvergedSteps: &summary.ConvergedSnapshots, TotalSteps: &summary.TotalSnapshots}, nil
		}
	}
	settings, err := h.store.GetResultsPyPSASettings(modelID)
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return gridCheck{}, nil
	case err != nil:
		return gridCheck{}, err
	}
	return gridCheck{Available: true, Converged: settings.Converged}, nil
}

type kpiInputs struct {
	cost        []backendModels.ResultsCost
	investment  []backendModels.ResultsCostInvestment
	lcoe        []backendModels.ResultsModelTotalLevelisedCost
	capacity    []backendModels.ResultsEnergyCap
	unmetDemand float64
	summaries   map[string]resultStore.CarrierSummary
	grid        gridCheck
}

func computeKPIs(in kpiInputs) modelKPIs {
	installed := installedCapacities(in.capacity)
	k := modelKPIs{UnmetDemandKWh: in.unmetDemand, GridCheck: in.grid, InstalledCapacity: installed,
		CapacityFactor: capacityFactorByCategory(installed, in.summaries)}
	for _, r := range in.cost {
		if isMonetaryCost(r.Costs) {
			k.TotalCostEUR += r.Value
		}
	}
	for _, r := range in.investment {
		if isMonetaryCost(r.Costs) {
			k.InvestmentCostEUR += math.Abs(r.Value)
		}
	}
	k.LCOEEURPerKWh = powerLCOE(in.lcoe)
	power := in.summaries["power"]
	k.Energy = energyKPIs{Production: math.Abs(power.SumProduction), Consumption: math.Abs(power.SumConsumption),
		RenewableProduction: math.Abs(power.RenewableProduction), GridImport: math.Abs(power.GridImport)}
	return k
}

// isMonetaryCost treats an empty or unknown cost class as money and excludes emission classes.
func isMonetaryCost(class string) bool {
	c := strings.ToLower(class)
	for _, money := range []string{"monetary", "money", "eur"} {
		if strings.Contains(c, money) {
			return true
		}
	}
	for _, emission := range []string{"co2", "emission", "carbon", "ghg"} {
		if strings.Contains(c, emission) {
			return false
		}
	}
	return true
}

// powerLCOE converts the stored EUR/MWh electricity LCOE to EUR/kWh,
// preferring "monetary" rows. Operate-mode runs store one row per time step
// without the step, from which no period LCOE follows, so it returns nil
// unless exactly one row remains.
func powerLCOE(rows []backendModels.ResultsModelTotalLevelisedCost) *float64 {
	var money, monetary []float64
	for _, r := range rows {
		if strings.ToLower(r.Carrier) != "power" || !isMonetaryCost(r.Costs) || math.IsNaN(r.Value) || math.IsInf(r.Value, 0) {
			continue
		}
		money = append(money, r.Value)
		if strings.Contains(strings.ToLower(r.Costs), "monetary") {
			monetary = append(monetary, r.Value)
		}
	}
	if len(monetary) > 0 {
		money = monetary
	}
	if len(money) != 1 {
		return nil
	}
	v := math.Abs(money[0]) / 1000
	return &v
}

var (
	notEquipment = regexp.MustCompile(`_demand$|transmission|transformer|_import$|_export$`)
	isBattery    = regexp.MustCompile(`battery|storage`)
)

// techFamily strips per-node numbers: pv_supply_1_0 -> pv_supply, gas_3_import -> gas_import.
func techFamily(tech string) string {
	parts := strings.Split(strings.SplitN(tech, ":", 2)[0], "_")
	kept := parts[:1]
	for _, p := range parts[1:] {
		if strings.Trim(p, "0123456789") != "" || p == "" {
			kept = append(kept, p)
		}
	}
	return strings.Join(kept, "_")
}

// installedCapacities sums equipment per technology family. Per tech and
// building the first row (by id) is power in kW, the second battery storage
// in MWh.
func installedCapacities(rows []backendModels.ResultsEnergyCap) []installedTech {
	sorted := append([]backendModels.ResultsEnergyCap(nil), rows...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].ID < sorted[j].ID })
	type nodeKey struct{ tech, node string }
	var order []nodeKey
	byNode := map[nodeKey][]float64{}
	for _, r := range sorted {
		if (r.ToLocation != nil && *r.ToLocation != "") || notEquipment.MatchString(r.Tech) {
			continue
		}
		key := nodeKey{r.Tech, r.FromLocation}
		if _, seen := byNode[key]; !seen {
			order = append(order, key)
		}
		byNode[key] = append(byNode[key], r.Value)
	}
	type total struct {
		kw, kwh float64
		nodes   map[string]bool
	}
	var families []string
	totals := map[string]*total{}
	for _, key := range order {
		values := byNode[key]
		if values[0] <= 0 {
			continue
		}
		family := techFamily(key.tech)
		t := totals[family]
		if t == nil {
			t = &total{nodes: map[string]bool{}}
			totals[family] = t
			families = append(families, family)
		}
		t.kw += values[0]
		t.nodes[key.node] = true
		if isBattery.MatchString(family) && len(values) > 1 {
			t.kwh += values[1] * 1000
		}
	}
	out := make([]installedTech, 0, len(families))
	for _, f := range families {
		out = append(out, installedTech{Technology: f, KW: totals[f].kw, KWh: totals[f].kwh, Buildings: len(totals[f].nodes)})
	}
	return out
}

// techCategory groups a technology as the compare page does.
func techCategory(tech string) string {
	t := normalizeTech(tech)
	switch {
	case strings.Contains(t, "pv") || strings.Contains(t, "solar"):
		return "solar"
	case strings.Contains(t, "wind"):
		return "wind"
	case strings.Contains(t, "biomass"):
		return "biomass"
	case strings.Contains(t, "geothermal"):
		return "geothermal"
	case strings.Contains(t, "battery") || strings.Contains(t, "storage"):
		return "storage"
	case strings.Contains(t, "heat_pump"):
		return "heat_pump"
	case strings.Contains(t, "air_conditioner"):
		return "air_conditioner"
	case strings.Contains(t, "transformer") || strings.Contains(t, "grid"):
		return "grid"
	}
	return "other"
}

func normalizeTech(tech string) string {
	return strings.TrimSpace(strings.SplitN(strings.ToLower(tech), ":", 2)[0])
}

// capacityFactorByCategory is each category's output over installed capacity
// times the number of time steps, in percent (hourly steps, as the dashboard
// assumes). Stored capacity factor rows are not used: current runs write one
// row per time step without the step, so they cannot be weighted correctly.
func capacityFactorByCategory(installed []installedTech, summaries map[string]resultStore.CarrierSummary) []categoryPercent {
	steps := float64(summaries["power"].TimestepCount)
	if steps == 0 {
		return []categoryPercent{}
	}
	output := map[string]float64{}
	for _, summary := range summaries {
		for _, a := range summary.ProdAggregates {
			output[techFamily(normalizeTech(a.Techs))] += math.Abs(a.Total)
		}
	}
	type sum struct{ output, kw float64 }
	sums := map[string]*sum{}
	var categories []string
	for _, t := range installed {
		category := techCategory(t.Technology)
		if category == "other" || category == "grid" || category == "storage" {
			continue
		}
		if sums[category] == nil {
			sums[category] = &sum{}
			categories = append(categories, category)
		}
		sums[category].output += output[t.Technology]
		sums[category].kw += t.KW
	}
	out := []categoryPercent{}
	for _, c := range categories {
		out = append(out, categoryPercent{Category: c, Percent: 100 * sums[c].output / (sums[c].kw * steps)})
	}
	return out
}
