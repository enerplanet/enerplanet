package result

import (
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	backendModels "spatialhub_backend/internal/models"
	resultStore "spatialhub_backend/internal/store/result"
	"spatialhub_backend/internal/testutil"
)

func TestComputeKPIs(t *testing.T) {
	to := "b2"
	in := kpiInputs{
		cost: []backendModels.ResultsCost{
			{Costs: "monetary", Techs: "pv_supply_1_0", Value: 1200},
			{Costs: "monetary", Techs: "grid_export", Value: -200}, // feed-in income
			{Costs: "co2", Techs: "transformer_supply", Value: 999},
			{Costs: "", Techs: "battery_1", Value: 50},
		},
		investment: []backendModels.ResultsCostInvestment{
			{Costs: "monetary", Value: 800},
			{Costs: "monetary", Value: -100},
			{Costs: "emissions", Value: 77},
		},
		lcoe: []backendModels.ResultsModelTotalLevelisedCost{
			{Carrier: "heat", Costs: "monetary", Value: 90},
			{Carrier: "power", Costs: "total", Value: -120},
			{Carrier: "power", Costs: "monetary", Value: 150},
		},
		capacity: []backendModels.ResultsEnergyCap{
			{ID: 1, Tech: "pv_supply_1_0", FromLocation: "b1", Value: 5},
			{ID: 2, Tech: "pv_supply_1_1", FromLocation: "b1", Value: 3},
			{ID: 3, Tech: "pv_supply_2_0", FromLocation: "b2", Value: 4},
			{ID: 4, Tech: "battery_1", FromLocation: "b1", Value: 2},
			{ID: 5, Tech: "battery_1", FromLocation: "b1", Value: 0.01},
			{ID: 6, Tech: "heat_pump_1", FromLocation: "b1", Value: 0},
			{ID: 7, Tech: "power_transmission", FromLocation: "b1", ToLocation: &to, Value: 30},
			{ID: 8, Tech: "transformer_supply", FromLocation: "t1", Value: 100},
			{ID: 9, Tech: "electricity_demand", FromLocation: "b1", Value: 9},
		},
		unmetDemand: 12.5,
		summaries: map[string]resultStore.CarrierSummary{
			"power": {SumProduction: 1000, SumConsumption: -900, RenewableProduction: 600, GridImport: 400, TimestepCount: 10,
				ProdAggregates: []resultStore.TechAggregate{{Techs: "pv_supply_1_0", Total: 30}, {Techs: "pv_supply_2_0", Total: 18},
					{Techs: "battery_1", Total: 5}, {Techs: "transformer_supply", Total: 400}}},
			"heat": {ProdAggregates: []resultStore.TechAggregate{{Techs: "heat_pump_1", Total: 40}}},
		},
		grid: gridCheck{Available: true, Converged: true},
	}

	k := computeKPIs(in)

	require.Equal(t, 1050.0, k.TotalCostEUR, "signed monetary sum: feed-in lowers it, emissions excluded")
	require.Equal(t, 900.0, k.InvestmentCostEUR, "absolute monetary sum")
	require.NotNil(t, k.LCOEEURPerKWh)
	require.InDelta(t, 0.15, *k.LCOEEURPerKWh, 1e-12, "power row, monetary preferred, EUR/MWh to EUR/kWh")
	require.Equal(t, 12.5, k.UnmetDemandKWh)
	require.Equal(t, energyKPIs{Production: 1000, Consumption: 900, RenewableProduction: 600, GridImport: 400}, k.Energy)
	require.Equal(t, []installedTech{
		{Technology: "pv_supply", KW: 12, Buildings: 2},
		{Technology: "battery", KW: 2, KWh: 10, Buildings: 1},
	}, k.InstalledCapacity)
	// pv: 48 kWh / (12 kW * 10 steps) = 40 %; battery is storage, heat pump has no capacity
	require.Len(t, k.CapacityFactor, 1)
	require.Equal(t, "solar", k.CapacityFactor[0].Category)
	require.InDelta(t, 40.0, k.CapacityFactor[0].Percent, 1e-9)
	require.Equal(t, in.grid, k.GridCheck)
}

func TestPowerLCOEAbsent(t *testing.T) {
	require.Nil(t, powerLCOE([]backendModels.ResultsModelTotalLevelisedCost{{Carrier: "heat", Costs: "monetary", Value: 80}}))
	perStep := []backendModels.ResultsModelTotalLevelisedCost{
		{Carrier: "power", Costs: "monetary", Value: 252.6}, {Carrier: "power", Costs: "monetary", Value: 238.4},
	}
	require.Nil(t, powerLCOE(perStep), "operate-mode rows per time step give no period LCOE")
}

func TestTechFamily(t *testing.T) {
	for tech, want := range map[string]string{
		"pv_supply_1_0":     "pv_supply",
		"gas_3_import":      "gas_import",
		"battery_12:b1":     "battery",
		"heat_pump":         "heat_pump",
		"wind_onshore_2_10": "wind_onshore",
	} {
		require.Equal(t, want, techFamily(tech), tech)
	}
}

func TestGetModelKPIsAccessAndUnfinishedModel(t *testing.T) {
	for _, tc := range []struct {
		name, user string
		status     int
		body       string
	}{
		{"owner sees a running model without kpis", "user-a", 200, `"kpis":null`},
		{"other user is refused", "user-b", 403, "Access denied"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock := testutil.NewMockDB(t)
			mock.MatchExpectationsInOrder(false)
			mock.ExpectQuery(`SELECT \* FROM "models" WHERE id = \$1`).WithArgs("12", 1).
				WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "user_email", "title", "status"}).AddRow(12, "user-a", "user-a@example.com", "Model A", "running"))
			mock.ExpectQuery(`SELECT \* FROM "models" WHERE id = \$1`).
				WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "user_email", "title", "status"}).AddRow(12, "user-a", "user-a@example.com", "Model A", "running"))
			mock.ExpectQuery(`SELECT count\(\*\) FROM "model_shares"`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
			router := gin.New()
			router.Use(func(c *gin.Context) {
				c.Set("user_id", tc.user)
				c.Set("user_email", tc.user+"@example.com")
				c.Set("access_level", "intermediate")
			})
			router.GET("/api/models/:id/kpis", NewResultHandler(db, nil, nil, "", nil).GetModelKPIs)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest("GET", "/api/models/12/kpis", nil))
			require.Equal(t, tc.status, w.Code, w.Body.String())
			require.Contains(t, w.Body.String(), tc.body)
		})
	}
}
