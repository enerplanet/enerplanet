package result

import (
	resultStore "spatialhub_backend/internal/store/result"

	"github.com/gin-gonic/gin"
)

func (h *ResultHandler) buildStructuredResultsResponse(modelIDUint uint, carrier string) gin.H {
	response := h.store.GetStructuredResults(modelIDUint)

	if carrier != "" {
		// Single carrier summary
		cs := h.store.GetCarrierSummary(modelIDUint, carrier)
		response["carrier"] = carrier
		response["sum_production"] = cs.SumProduction
		response["sum_consumption"] = cs.SumConsumption
		response["renewable_production"] = cs.RenewableProduction
		response["grid_import"] = cs.GridImport
		response["peak_demand"] = cs.PeakDemand
		response["timestep_count"] = cs.TimestepCount
		response["prod_aggregates"] = cs.ProdAggregates
		response["con_aggregates"] = cs.ConAggregates
	} else {
		// All carrier summaries
		allSummaries := h.store.GetAllCarrierSummaries(modelIDUint)
		response["carrier_summaries"] = allSummaries

		// Still set the "power" summary at top-level for backward compat
		if cs, ok := allSummaries["power"]; ok {
			response["sum_production"] = cs.SumProduction
			response["sum_consumption"] = cs.SumConsumption
			response["renewable_production"] = cs.RenewableProduction
			response["grid_import"] = cs.GridImport
			response["peak_demand"] = cs.PeakDemand
			response["timestep_count"] = cs.TimestepCount
			response["prod_aggregates"] = cs.ProdAggregates
			response["con_aggregates"] = cs.ConAggregates
		}
	}

	return gin.H(response)
}

func (h *ResultHandler) fetchLocationTimeSeriesData(modelIDUint uint, location string, dateRange dateRangeFilter, carrier string, response gin.H) {
	dr := resultStore.DateRange{Begin: dateRange.begin, End: dateRange.end}

	if prod, err := h.store.GetLocationCarrierProd(modelIDUint, location, dr, carrier); err == nil {
		response["production"] = prod
	}
	if con, err := h.store.GetLocationCarrierCon(modelIDUint, location, dr, carrier); err == nil {
		response["consumption"] = con
	}
	if cf, err := h.store.GetLocationCapacityFactor(modelIDUint, location, dr); err == nil {
		response["capacity_factor"] = cf
	}

	h.fetchLocationStaticData(modelIDUint, location, response)
}

type dateRangeFilter struct {
	begin string
	end   string
}

func (h *ResultHandler) fetchLocationStaticData(modelIDUint uint, location string, response gin.H) {
	if energyCap, err := h.store.GetLocationEnergyCap(modelIDUint, location); err == nil {
		response["energy_cap"] = energyCap
	}
	if costs, err := h.store.GetLocationCosts(modelIDUint, location); err == nil {
		response["costs"] = costs
	}
	if voltage, err := h.store.GetLocationPyPSAVoltage(modelIDUint, location); err == nil && len(voltage) > 0 {
		response["voltage"] = voltage
	}
	if power, err := h.store.GetLocationPyPSAPower(modelIDUint, location); err == nil && len(power) > 0 {
		response["power"] = power
	}
}
