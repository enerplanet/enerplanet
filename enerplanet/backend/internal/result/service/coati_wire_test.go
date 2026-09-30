package resultservice

import (
	"math"
	"testing"
)

// wireDocFixture mirrors the shape of a real Coati document (verified against a
// PyPSA network.nc solve): a transmission tech classified by tech_metadata, its
// capacity keyed "loc::tech" for both endpoints, and transmission_flow carrying
// the net arrival at To.
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

func TestMapWireLoadingNamesTheWireAndComputesUtilisation(t *testing.T) {
	rows := mapWireLoading(wireDocFixture())
	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2 (one per timestep)", len(rows))
	}

	first := rows[0]
	if first.Line != "line1" {
		t.Errorf("Line = %q, want the transmission tech name", first.Line)
	}
	if first.Bus0 != "n1" || first.Bus1 != "n2" {
		t.Errorf("endpoints = %q/%q, want n1/n2", first.Bus0, first.Bus1)
	}
	if first.P0 != 120 {
		t.Errorf("P0 = %v, want 120 (the net arrival from the document)", first.P0)
	}
	if first.Timestep.IsZero() {
		t.Error("Timestep was not parsed")
	}
	if first.Percent == nil || math.Abs(*first.Percent-40) > 1e-9 {
		t.Errorf("Percent = %v, want 40 (120/300)", first.Percent)
	}

	// Negative flow (reversed arc) keeps its sign and uses its magnitude.
	if rows[1].P0 != -20 {
		t.Errorf("P0 = %v, want -20", rows[1].P0)
	}
	if rows[1].Percent == nil || math.Abs(*rows[1].Percent-6.666666666666667) > 1e-6 {
		t.Errorf("Percent = %v, want ~6.67 (|−20|/300)", rows[1].Percent)
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

// Without a rating there is nothing honest to divide by: the flow is kept, the
// percentage is omitted rather than guessed.
func TestMapWireLoadingOmitsPercentWithoutARating(t *testing.T) {
	doc := wireDocFixture()
	doc.Capacities = nil
	rows := mapWireLoading(doc)
	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(rows))
	}
	if rows[0].Percent != nil {
		t.Errorf("Percent = %v, want nil when no rating exists", *rows[0].Percent)
	}
	// No capacities, so the wire cannot be named by endpoints — the node pair
	// is the truthful fallback.
	if rows[0].Line != "n1::n2" {
		t.Errorf("Line = %q, want the node-pair fallback", rows[0].Line)
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

	rows := mapWireLoading(doc)
	if rows[0].Line != "n1::n2" {
		t.Errorf("Line = %q, want the node-pair fallback", rows[0].Line)
	}
}

func TestMapWireLoadingHandlesEmptyDocuments(t *testing.T) {
	if rows := mapWireLoading(nil); rows != nil {
		t.Errorf("nil document produced %d rows", len(rows))
	}
	if rows := mapWireLoading(&CoatiResultsDocument{}); rows != nil {
		t.Errorf("empty document produced %d rows", len(rows))
	}
}

// The series length is bounded by the timestamps, so a short timestamp list
// cannot produce rows with an unpaired timestamp.
func TestMapWireLoadingBoundsSeriesByTimestamps(t *testing.T) {
	doc := wireDocFixture()
	doc.Timestamps = doc.Timestamps[:1]
	if rows := mapWireLoading(doc); len(rows) != 1 {
		t.Errorf("got %d rows, want 1 (bounded by timestamps)", len(rows))
	}
}
