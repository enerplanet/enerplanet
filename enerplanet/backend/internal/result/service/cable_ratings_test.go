package resultservice

import (
	"math"
	"testing"
)

func TestCableSNomMVA(t *testing.T) {
	// NYY_4_16 = 103 A @ 0.4 kV -> sqrt(3) * 0.4 * 103 / 1000 ≈ 0.07136 MVA.
	got, ok := cableSNomMVA("NYY_4_16", 0.4, 1)
	if !ok {
		t.Fatal("cableSNomMVA(NYY_4_16) reported unknown")
	}
	if math.Abs(got-0.0714) > 1e-4 {
		t.Errorf("s_nom = %v, want ≈0.0714 MVA", got)
	}

	// num_parallel scales the rating.
	if got2, _ := cableSNomMVA("NYY_4_16", 0.4, 2); math.Abs(got2-2*got) > 1e-9 {
		t.Errorf("s_nom with 2 parallel = %v, want %v", got2, 2*got)
	}

	if _, ok := cableSNomMVA("NOPE_4_16", 0.4, 1); ok {
		t.Error("an unknown cable type must not resolve a rating")
	}
}

func TestArcPipeAndGrid(t *testing.T) {
	pipe, grid, ok := arcPipeAndGrid("lv_1_trafo_82")
	if !ok || pipe != "lv" || grid != "82" {
		t.Errorf("arcPipeAndGrid(lv_1_trafo_82) = (%q,%q,%v), want (lv,82,true)", pipe, grid, ok)
	}
	// An MV arc parses its grid too; resolveWireRating is what rejects the pipe.
	pipe, grid, ok = arcPipeAndGrid("mv_1_trafo_82")
	if !ok || pipe != "mv" || grid != "82" {
		t.Errorf("arcPipeAndGrid(mv_1_trafo_82) = (%q,%q,%v), want (mv,82,true)", pipe, grid, ok)
	}

	for _, bad := range []string{"line1", "lv_1_trafo_", "lv_1_trafo_x", ""} {
		if _, _, ok := arcPipeAndGrid(bad); ok {
			t.Errorf("arcPipeAndGrid(%q) accepted a non-arc name", bad)
		}
	}
}

// A synthetic config with two grids and mixed cable types: each grid resolves
// its SMALLEST max_i_a (conservative), keyed by grid_result_id.
func TestWireRatingsByGridTakesTheSmallestCablePerGrid(t *testing.T) {
	config := map[string]interface{}{
		"lines": map[string]interface{}{
			"features": []interface{}{
				map[string]interface{}{"properties": map[string]interface{}{
					"grid_result_id": float64(82), "cable_type": "NAYY_4_120"}}, // 242 A
				map[string]interface{}{"properties": map[string]interface{}{
					"grid_result_id": float64(82), "cable_type": "NYY_4_16"}}, // 103 A (min)
				map[string]interface{}{"properties": map[string]interface{}{
					"grid_result_id": float64(99), "cable_type": "NYY_4_70"}}, // 232 A
				map[string]interface{}{"properties": map[string]interface{}{
					"grid_result_id": float64(99), "cable_type": "NFA2X_4_50"}}, // 165 A (min)
				// A row with an unknown cable type is ignored, not guessed.
				map[string]interface{}{"properties": map[string]interface{}{
					"grid_result_id": float64(99), "cable_type": "UNKNOWN"}},
			},
		},
	}

	ratings := wireRatingsByGrid(config)
	want82, _ := cableSNomMVA("NYY_4_16", 0.4, 1)
	want99, _ := cableSNomMVA("NFA2X_4_50", 0.4, 1)
	if math.Abs(ratings["82"]-want82) > 1e-12 {
		t.Errorf("grid 82 rating = %v, want %v (NYY_4_16)", ratings["82"], want82)
	}
	if math.Abs(ratings["99"]-want99) > 1e-12 {
		t.Errorf("grid 99 rating = %v, want %v (NFA2X_4_50)", ratings["99"], want99)
	}
	if len(ratings) != 2 {
		t.Errorf("ratings = %v, want exactly the two grids", ratings)
	}
}

func TestWireRatingsByGridHandlesMissingConfig(t *testing.T) {
	for _, config := range []map[string]interface{}{
		nil,
		{},
		{"lines": map[string]interface{}{}},
		{"lines": map[string]interface{}{"features": []interface{}{}}},
		{"lines": map[string]interface{}{"features": []interface{}{
			map[string]interface{}{"properties": map[string]interface{}{"grid_result_id": float64(82), "cable_type": "UNKNOWN"}}}},
		},
	} {
		if ratings := wireRatingsByGrid(config); len(ratings) != 0 {
			t.Errorf("config %v resolved ratings %v, want none", config, ratings)
		}
	}
}

// resolveWireRating keys an LV arc to its grid's real rating and rejects
// anything else (MV pipe, unknown grid, node-pair fallback names).
func TestResolveWireRating(t *testing.T) {
	ratings := map[string]float64{"82": 0.0714}

	if r, ok := resolveWireRating("lv_1_trafo_82", ratings); !ok || math.Abs(r-0.0714) > 1e-12 {
		t.Errorf("lv arc rating = (%v,%v), want (0.0714,true)", r, ok)
	}
	for _, name := range []string{"mv_1_trafo_82", "lv_1_trafo_99", "n1::ntrafo_82", "line1"} {
		if _, ok := resolveWireRating(name, ratings); ok {
			t.Errorf("resolveWireRating(%q) resolved a rating, want none", name)
		}
	}
	if _, ok := resolveWireRating("lv_1_trafo_82", nil); ok {
		t.Error("a nil rating map must resolve nothing")
	}
}
