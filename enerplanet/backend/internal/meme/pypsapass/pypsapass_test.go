package pypsapass

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// full(opts) routes through the embedded catalogue (Build), the production path.
func full(t *testing.T, opts LoadOptions) *PowerFlow {
	t.Helper()
	pf, err := Build(opts)
	require.NoError(t, err)
	return pf
}

func TestBuild_busLineTrafoFromTopology(t *testing.T) {
	pf := full(t, LoadOptions{
		Pypsa: map[string]interface{}{},
		Topology: []map[string]interface{}{
			{
				"from": map[string]interface{}{
					"id": "1",
					"properties": map[string]interface{}{
						"id": "1", "feature_type": "BasePOI", "f_class": "residential",
					},
				},
				"to": map[string]interface{}{
					"id": "trafo_0",
					"properties": map[string]interface{}{
						"id": "trafo_0", "feature_type": "TopologyNode", "f_class": "transformer",
						"rated_power_kva": 400,
					},
				},
				"length": 0.05, // km
				"pipe":   "lv",
			},
		},
		NumTimesteps: 3,
	})

	// Buses: building n1 (LV), trafo ntrafo_0 (LV), trafo MV side ntrafo_0_mv.
	var names []string
	for _, b := range pf.Buses {
		names = append(names, b.Name)
	}
	require.ElementsMatch(t, []string{"n1", "ntrafo_0", "ntrafo_0_mv"}, names)

	// Trafo: 400 kVA -> 0.4 MVA, MV->LV side ordering.
	require.Len(t, pf.Transformers, 1)
	tr := pf.Transformers[0]
	require.Equal(t, "ntrafo_0_mv", tr.Bus0)
	require.Equal(t, "ntrafo_0", tr.Bus1)
	require.InDelta(t, 0.4, tr.SNomMVA, 1e-9)

	// Line: lv_0, n1 <-> ntrafo_0, 0.05 km, params from default LV cable.
	require.Len(t, pf.Lines, 1)
	line := pf.Lines[0]
	require.Equal(t, "n1", line.Bus0)
	require.Equal(t, "ntrafo_0", line.Bus1)
	require.Equal(t, "lv_0", line.Name)
}

func TestBuild_lineElectricalParamsFromCatalogue(t *testing.T) {
	pf := full(t, LoadOptions{
		Pypsa: map[string]interface{}{"line_type_lv": "NAYY_4_150"},
		Topology: []map[string]interface{}{
			{
				"from":   map[string]interface{}{"id": "a"},
				"to":     map[string]interface{}{"id": "b"},
				"length": 1.0, // km
				"pipe":   "lv",
			},
		},
	})
	require.Len(t, pf.Lines, 1)
	line := pf.Lines[0]
	// NAYY_4_150: r=208 mOhm/km, x=80 mOhm/km -> over 1 km: 0.208 / 0.080 Ohm.
	require.InDelta(t, 0.208, line.ROhm, 1e-9)
	require.InDelta(t, 0.080, line.XOhm, 1e-9)
	// s_nom from max_i_a (270 A) at LV 0.4 kV: sqrt(3)*0.4kV*270A -> MV·... MVA.
	require.Greater(t, line.SNomMVA, 0.0)
}

func TestBuild_generatorsAndLoadsFromCarrierSeries(t *testing.T) {
	pf := full(t, LoadOptions{
		Topology: []map[string]interface{}{
			{
				"from":   map[string]interface{}{"id": "1"},
				"to":     map[string]interface{}{"id": "trafo_0"},
				"length": 0.05,
				"pipe":   "lv",
			},
		},
		CarrierProd: []CarrierSeries{
			{FromLocation: "n1", Tech: "pv", Timeseries: []float64{1.0, 2.0, 0}},
		},
		CarrierCon: []CarrierSeries{
			{FromLocation: "n1", Tech: "load", Timeseries: []float64{0.5, 0, 0.3}},
		},
		NumTimesteps: 3,
	})

	require.Len(t, pf.Generators, 1)
	gen := pf.Generators[0]
	require.Equal(t, "n1", gen.Bus)
	require.Equal(t, "PQ", gen.Control)
	// unit 1.0: passthrough — MEME Calliope results are natively MW.
	require.InDelta(t, 1.0, gen.PSet[0], 1e-9)
	require.InDelta(t, 2.0, gen.PSet[1], 1e-9)

	require.Len(t, pf.Loads, 1)
	require.InDelta(t, 0.5, pf.Loads[0].PSet[0], 1e-9)
}

func TestBuild_seriesBoundedByNumTimesteps(t *testing.T) {
	pf := full(t, LoadOptions{
		CarrierProd: []CarrierSeries{
			{FromLocation: "n1", Tech: "pv", Timeseries: []float64{1, 2, 3, 4, 5}},
		},
		NumTimesteps: 2,
	})
	require.Len(t, pf.Generators, 1)
	require.Len(t, pf.Generators[0].PSet, 2)
}
