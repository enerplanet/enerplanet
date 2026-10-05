package resultservice

import (
	"math"
	"testing"
)

// wireDocFixture mirrors the shape of a real Coati document: a transmission tech
// classified by tech_metadata, its capacity keyed "loc::tech" for both
// endpoints, and transmission_flow carrying the net arrival at To. Its tech name
// is not an arc name, so it exercises naming/Coati-rating paths only.
func wireDocFixture() *CoatiResultsDocument {
	return &CoatiResultsDocument{
		Timestamps: []string{"2025-01-01T00:00:00", "2025-01-01T01:00:00"},
		Capacities: map[string]float64{
			"n1::line1": 300,
			"n2::line1": 300,
			"n1::chp":   100,
		},
		TechMetadata: map[string]CoatiTechMetadata{
			"line1": {Parent: "transmission", CarrierOut: "electricity"},
			"chp":   {Parent: "conversion", CarrierOut: "electricity"},
		},
		TransmissionFlow: map[string]CoatiTransmission{
			"n1::n2": {From: "n1", To: "n2", Timeseries: []float64{120, -20}},
		},
	}
}

// lvWireDocFixture is a realistic LV arc: the T1K topology names a wire
// lv_<i>_trafo_<grid>, so the rating lookup derives the grid from the name's
// trailing token.
func lvWireDocFixture() *CoatiResultsDocument {
	return &CoatiResultsDocument{
		Timestamps: []string{"2025-01-01T00:00:00", "2025-01-01T01:00:00"},
		Capacities: map[string]float64{
			"n1::lv_1_trafo_82":        1.0,
			"ntrafo_82::lv_1_trafo_82": 1.0,
		},
		TechMetadata: map[string]CoatiTechMetadata{
			"lv_1_trafo_82": {Parent: "transmission", CarrierOut: "electricity"},
		},
		TransmissionFlow: map[string]CoatiTransmission{
			"n1::ntrafo_82": {From: "n1", To: "ntrafo_82", Timeseries: []float64{0.5, -0.02}},
		},
	}
}

// grid82Ratings is the per-grid map a model config with grid 82's cables
// (weakest NYY_4_16 = 103 A @ 0.4 kV -> ~0.07136 MVA) resolves to.
func grid82Ratings() map[string]float64 {
	return wireRatingsByGrid(map[string]interface{}{
		"lines": map[string]interface{}{
			"features": []interface{}{
				map[string]interface{}{"properties": map[string]interface{}{
					"grid_result_id": float64(82), "cable_type": "NYY_4_16"}},
				map[string]interface{}{"properties": map[string]interface{}{
					"grid_result_id": float64(82), "cable_type": "NAYY_4_120"}},
			},
		},
	})
}

func TestMapWireLoadingUsesTheRealCableRating(t *testing.T) {
	rows := mapWireLoading(lvWireDocFixture(), grid82Ratings())
	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2 (one per timestep)", len(rows))
	}

	first := rows[0]
	if first.Line != "lv_1_trafo_82" {
		t.Errorf("Line = %q, want the transmission tech name", first.Line)
	}
	if first.Bus0 != "n1" || first.Bus1 != "ntrafo_82" {
		t.Errorf("endpoints = %q/%q, want n1/ntrafo_82", first.Bus0, first.Bus1)
	}
	if first.P0 != 500 {
		t.Errorf("P0 = %v, want 500 kW (the document's 0.5 MW arrival, scaled)", first.P0)
	}
	if first.P1 != nil {
		t.Errorf("P1 = %v, want nil: the Coati document folds both directions into one net series per node pair, so no other-endpoint flow exists", *first.P1)
	}
	if first.Timestep.IsZero() {
		t.Error("Timestep was not parsed")
	}
	// 0.5 MVA / ~0.07136 MVA ≈ 700.7%: the flow exceeds the grid's weakest
	// cable, so the real utilisation flags > 100. The percentage is computed
	// from the RAW MW flow against the MVA rating, NOT the kW-scaled P0.
	if first.Percent == nil {
		t.Fatal("Percent is nil, want the real grid-cable utilisation")
	}
	if *first.Percent <= 100 {
		t.Errorf("Percent = %v, want > 100 (flow exceeds the grid's weakest cable)", *first.Percent)
	}
	if math.Abs(*first.Percent-700.7) > 5 {
		t.Errorf("Percent = %v, want ≈700.7 against the ~0.0714 MVA grid rating", *first.Percent)
	}

	// The magnitude drives the utilisation; the sign is preserved on the flow.
	if rows[1].P0 != -20 {
		t.Errorf("P0 = %v, want -20 kW (~-0.02 MW scaled)", rows[1].P0)
	}
	if rows[1].Percent == nil || *rows[1].Percent <= 0 {
		t.Errorf("Percent = %v, want the positive utilisation of |−0.02|", rows[1].Percent)
	}
}

// Without a resolvable rating there is nothing honest to divide by: the flow is
// kept, the percentage is omitted rather than fabricated (never the Coati
// artefact).
func TestMapWireLoadingOmitsPercentWithoutARating(t *testing.T) {
	for _, ratings := range []map[string]float64{nil, {"99": 0.1}} {
		rows := mapWireLoading(lvWireDocFixture(), ratings)
		if len(rows) != 2 {
			t.Fatalf("got %d rows, want 2 (ratings=%v)", len(rows), ratings)
		}
		if rows[0].Percent != nil {
			t.Errorf("Percent = %v, want nil when no rating resolves (ratings=%v)", *rows[0].Percent, ratings)
		}
		if rows[0].Line != "lv_1_trafo_82" {
			t.Errorf("Line = %q, want the arc name", rows[0].Line)
		}
	}
}

// The equipment catalogue has no MV cable, so an MV arc carries no percent even
// when its grid resolves a rating.
func TestMapWireLoadingOmitsPercentForMVArcs(t *testing.T) {
	doc := &CoatiResultsDocument{
		Timestamps: []string{"2025-01-01T00:00:00"},
		Capacities: map[string]float64{
			"n1::mv_1_trafo_82":        5,
			"ntrafo_82::mv_1_trafo_82": 5,
		},
		TechMetadata: map[string]CoatiTechMetadata{
			"mv_1_trafo_82": {Parent: "transmission", CarrierOut: "electricity"},
		},
		TransmissionFlow: map[string]CoatiTransmission{
			"n1::ntrafo_82": {From: "n1", To: "ntrafo_82", Timeseries: []float64{5}},
		},
	}
	rows := mapWireLoading(doc, grid82Ratings())
	if len(rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(rows))
	}
	if rows[0].Percent != nil {
		t.Errorf("Percent = %v, want nil for an MV arc (no MV cable rating exists)", *rows[0].Percent)
	}
}

// A conversion link is a Link too, but it is not a wire: tech_metadata decides.
func TestMapWireLoadingIgnoresNonTransmissionTechs(t *testing.T) {
	ratings := wireRatings(wireDocFixture())
	if _, ok := ratings["chp"]; ok {
		t.Errorf("wireRatings included the conversion link: %v", ratings)
	}
	if ratings["line1"] != 300 {
		t.Errorf("ratings = %v, want line1 -> 300", ratings)
	}
}

func TestWireRatingsTakesTheMaximumAcrossEndpoints(t *testing.T) {
	doc := wireDocFixture()
	doc.Capacities["n2::line1"] = 250
	if got := wireRatings(doc)["line1"]; got != 300 {
		t.Errorf("rating = %v, want the maximum seen (300)", got)
	}
}

func TestWireNamesByEndpointsDropsAmbiguousPairs(t *testing.T) {
	doc := wireDocFixture()
	// A second transmission tech over the same node pair: the derivation is
	// ambiguous, so no name may be claimed.
	doc.Capacities["n1::line2"] = 100
	doc.Capacities["n2::line2"] = 100
	doc.TechMetadata["line2"] = CoatiTechMetadata{Parent: "transmission"}

	if names := wireNamesByEndpoints(doc); len(names) != 0 {
		t.Errorf("names = %v, want none for an ambiguous pair", names)
	}

	rows := mapWireLoading(doc, nil)
	if rows[0].Line != "n1::n2" {
		t.Errorf("Line = %q, want the node-pair fallback", rows[0].Line)
	}
}

func TestMapWireLoadingHandlesEmptyDocuments(t *testing.T) {
	if rows := mapWireLoading(nil, nil); rows != nil {
		t.Errorf("nil document produced %d rows", len(rows))
	}
	if rows := mapWireLoading(&CoatiResultsDocument{}, nil); rows != nil {
		t.Errorf("empty document produced %d rows", len(rows))
	}
}

// The series length is bounded by the timestamps, so a short timestamp list
// cannot produce rows with an unpaired timestamp.
func TestMapWireLoadingBoundsSeriesByTimestamps(t *testing.T) {
	doc := wireDocFixture()
	doc.Timestamps = doc.Timestamps[:1]
	if rows := mapWireLoading(doc, nil); len(rows) != 1 {
		t.Errorf("got %d rows, want 1 (bounded by timestamps)", len(rows))
	}
}
