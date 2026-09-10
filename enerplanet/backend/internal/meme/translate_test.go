package meme

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const steps = 8760 // one year, hourly

// fixture builds 300 buildings over two transformer areas plus a few without
// one, with series in kW: building i draws i kW electricity, 2i kW heating,
// 0.5i kW hot water, 0.1i kW kitchen, constant over the year.
func fixture() []BuildingSeries {
	flat := func(v float64) []float64 {
		s := make([]float64, steps)
		for i := range s {
			s[i] = v
		}
		return s
	}
	var out []BuildingSeries
	for i := 1; i <= 300; i++ {
		node := "trafo_1"
		switch {
		case i > 290:
			node = "" // no transformer area
		case i > 150:
			node = "trafo_2"
		}
		out = append(out, BuildingSeries{
			OSMID: fmt.Sprint(i), Node: node,
			Heating: flat(2 * float64(i)), HotWater: flat(0.5 * float64(i)),
			Electricity: flat(float64(i)), Kitchen: flat(0.1 * float64(i)),
			KitchenElectric: i%2 == 0,
		})
	}
	return out
}

func TestAggregate_sumsPerNodePerCarrierInMW(t *testing.T) {
	series, unassigned := Aggregate(fixture())

	assert.Equal(t, 10, unassigned, "buildings 291..300 have no transformer area")
	byKey := map[string][]float64{}
	for _, s := range series {
		byKey[s.Node+"/"+s.Carrier] = s.Values
	}
	require.Len(t, byKey, 6, "two transformer nodes plus the unassigned node, two carriers each")

	// trafo_1: buildings 1..150. heat = sum(2i + 0.5i) = 2.5 * 11325 kW
	require.Len(t, byKey["trafo_1/heat"], steps)
	assert.InDelta(t, 2.5*11325/1000, byKey["trafo_1/heat"][0], 1e-9)
	// electricity = sum(i) + kitchen of even i (0.1 * sum of even i = 0.1 * 5700)
	assert.InDelta(t, (11325+0.1*5700)/1000, byKey["trafo_1/electricity"][0], 1e-9)
	// unassigned: buildings 291..300, sum(i) = 2955, even i sum = 1480
	assert.InDelta(t, (2955+0.1*1480)/1000, byKey["unassigned/electricity"][0], 1e-9)
	assert.Equal(t, byKey["trafo_1/heat"][0], byKey["trafo_1/heat"][steps-1], "constant input stays constant")
}

func TestAggregate_shortestSeriesWins(t *testing.T) {
	series, _ := Aggregate([]BuildingSeries{
		{OSMID: "a", Node: "n", Heating: []float64{1000, 1000, 1000}},
		{OSMID: "b", Node: "n", Heating: []float64{1000, 1000}},
	})
	require.Len(t, series, 1)
	assert.Equal(t, []float64{2, 2}, series[0].Values, "summed over the common prefix, never extrapolated")
}

func translateFixture(t *testing.T) (Input, Result) {
	t.Helper()
	series, _ := Aggregate(fixture())
	limit := 0.63
	in := Input{
		Name:        "Loenen smoke",
		Start:       time.Date(2018, 1, 1, 0, 0, 0, 0, time.UTC),
		End:         time.Date(2018, 12, 31, 23, 0, 0, 0, time.UTC),
		StepMinutes: 60,
		Nodes: []NodeInput{
			{ID: "trafo_1", Name: "Trafo 1", Lat: 52.10, Lon: 6.02, ImportLimitMW: &limit},
			{ID: "trafo_2", Name: "Trafo 2", Lat: 52.11, Lon: 6.03},
		},
		Series: series,
	}
	res, err := Translate(in)
	require.NoError(t, err)
	return in, res
}

func TestTranslate_emitsOneDemandPerNodePerCarrierAndAHeatPumpPerNode(t *testing.T) {
	_, res := translateFixture(t)
	m := res.Job.Model

	require.Len(t, m.Nodes, 3, "two transformer nodes plus the synthetic unassigned node")
	assert.Contains(t, m.Nodes, UnassignedNode)
	require.Len(t, m.Timeseries, 6)
	for id, ts := range m.Timeseries {
		assert.Equal(t, "inline", ts.Source, id)
		assert.Equal(t, "MW", ts.Unit, id)
		assert.Len(t, ts.Values, steps, id)
	}
	demands, pumps := 0, 0
	for name, tech := range m.Technologies {
		switch tech.Role {
		case "demand":
			demands++
			_, ok := m.Timeseries[tech.DemandProfile]
			assert.True(t, ok, "%s: demand_profile %q must name an emitted series", name, tech.DemandProfile)
		case "conversion":
			pumps++
			assert.Equal(t, []string{CarrierElectricity}, tech.CarrierIn)
			assert.Equal(t, []string{CarrierHeat}, tech.CarrierOut)
			assert.False(t, tech.Capacity.Expandable, "%s: operate mode forbids expansion", name)
			peak := maxOf(m.Timeseries[tech.Node[0]+"_heat"].Values)
			assert.InDelta(t, peak/heatPumpCOP, tech.Capacity.Existing, 1e-12, "%s sized to the node's peak heat over COP", name)
		}
	}
	assert.Equal(t, 6, demands)
	assert.Equal(t, 3, pumps, "every node with heat demand gets a pump, the unassigned one included")

	// every carrier with demand at a node has supply or conversion there
	for _, tech := range m.Technologies {
		if tech.Role != "demand" {
			continue
		}
		node, carrier := tech.Node[0], tech.CarrierIn[0]
		_, hasImport := m.Trade["import_electricity_"+node]
		_, hasPump := m.Technologies["heat_pump_"+node]
		if carrier == CarrierElectricity {
			assert.True(t, hasImport, "electricity demand at %s needs an import", node)
		} else {
			assert.True(t, hasPump, "heat demand at %s needs the heat pump", node)
		}
	}
	require.NotNil(t, m.Trade["import_electricity_trafo_1"].Import.Limit)
	assert.Equal(t, 0.63, *m.Trade["import_electricity_trafo_1"].Import.Limit, "transformer rating caps the import")
	assert.Nil(t, m.Trade["import_electricity_"+UnassignedNode].Import.Limit, "the unassigned node has no transformer constraint")

	assert.Equal(t, "operate", res.Job.Experiment.Mode)
	assert.Equal(t, "1H", m.Time.Resolution)
	assert.Equal(t, "2018-01-01T00:00:00Z", m.Time.Start)
}

func TestTranslate_jsonHasOnlyMemeFields(t *testing.T) {
	_, res := translateFixture(t)
	b, err := json.Marshal(res.Job)
	require.NoError(t, err)
	var top map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(b, &top))
	assert.ElementsMatch(t, []string{"model", "experiment"}, keys(top), "api_key is set at dispatch, nothing else at top level")
	var model map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(top["model"], &model))
	assert.ElementsMatch(t, []string{"metadata", "time", "carriers", "nodes", "timeseries", "technologies", "trade"}, keys(model))
	assert.Less(t, len(b), 2<<20, "a 300-building job at two nodes stays far below TentaCron's 10 MiB cap (%d bytes)", len(b))
}

func TestTranslate_slicesAndPadsToTheWindow(t *testing.T) {
	in := Input{
		Name: "w", Start: time.Date(2018, 1, 1, 0, 0, 0, 0, time.UTC), End: time.Date(2018, 1, 1, 3, 0, 0, 0, time.UTC), StepMinutes: 60,
		Nodes: []NodeInput{{ID: "n"}},
		Series: []NodeSeries{
			{Node: "n", Carrier: CarrierElectricity, Values: []float64{1, 2, 3, 4, 5, 6}}, // longer than the 4-step window
			{Node: "n", Carrier: CarrierHeat, Values: []float64{7, 8}},                    // shorter
		},
	}
	res, err := Translate(in)
	require.NoError(t, err)
	assert.Equal(t, []float64{1, 2, 3, 4}, res.Job.Model.Timeseries["n_electricity"].Values)
	assert.Equal(t, []float64{7, 8, 8, 8}, res.Job.Model.Timeseries["n_heat"].Values, "padded with the last value")
	require.Len(t, res.Warnings, 1)
	assert.Contains(t, res.Warnings[0], "padded")
}

func TestTranslate_rejectsUnknownNodeAndBadWindow(t *testing.T) {
	start := time.Date(2018, 1, 1, 0, 0, 0, 0, time.UTC)
	_, err := Translate(Input{Name: "x", Start: start, End: start.Add(time.Hour), StepMinutes: 60,
		Series: []NodeSeries{{Node: "ghost", Carrier: CarrierHeat, Values: []float64{1}}}})
	assert.ErrorContains(t, err, `unknown node "ghost"`)

	_, err = Translate(Input{Name: "x", Start: start, End: start, StepMinutes: 60})
	assert.ErrorContains(t, err, "not after start")

	_, err = Translate(Input{Name: "x", Start: start, End: start.Add(time.Hour), StepMinutes: 0})
	assert.ErrorContains(t, err, "step must be positive")
}

func TestResolution(t *testing.T) {
	assert.Equal(t, "1H", resolution(60))
	assert.Equal(t, "3H", resolution(180))
	assert.Equal(t, "15min", resolution(15))
}

func keys(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
