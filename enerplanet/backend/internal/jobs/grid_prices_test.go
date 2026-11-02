package jobs

import (
	"encoding/json"
	"testing"

	"spatialhub_backend/internal/models"
)

func TestMergeGridPrices(t *testing.T) {
	germany := models.GridElectricityPrice{Country: "germany", ImportCtPerKWh: 38.35, ExportCtPerKWh: 7.7}
	cases := []struct {
		name    string
		config  string
		want    gridPrices
		wantErr bool
	}{
		{"no config", ``, gridPrices{38.35, 7.7}, false},
		{"no override", `{"mode": "plan"}`, gridPrices{38.35, 7.7}, false},
		{"own purchase price only", `{"electricity_prices": {"import_ct_per_kwh": 34}}`, gridPrices{34, 7.7}, false},
		{"both own prices", `{"electricity_prices": {"import_ct_per_kwh": 34, "export_ct_per_kwh": 7.9}}`, gridPrices{34, 7.9}, false},
		{"reset to default", `{"electricity_prices": {"import_ct_per_kwh": null}}`, gridPrices{38.35, 7.7}, false},
		{"feed-in above purchase", `{"electricity_prices": {"export_ct_per_kwh": 40}}`, gridPrices{}, true},
		{"free purchase", `{"electricity_prices": {"import_ct_per_kwh": 0}}`, gridPrices{}, true},
		{"negative feed-in", `{"electricity_prices": {"export_ct_per_kwh": -1}}`, gridPrices{}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := mergeGridPrices(germany, json.RawMessage(tc.config))
			if tc.wantErr {
				if err == nil {
					t.Fatalf("want an error, got %+v", got)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("got %+v, %v; want %+v", got, err, tc.want)
			}
		})
	}
}

func TestApplyGridPricesSetsTransformersOnly(t *testing.T) {
	node := func(featureType string) map[string]interface{} {
		return map[string]interface{}{"properties": map[string]interface{}{"feature_type": featureType}}
	}
	building, trafo, upstream := node("BasePOI"), node("TopologyNode"), node("TopologyNode")
	topology := []interface{}{
		map[string]interface{}{"from": building, "to": trafo},
		map[string]interface{}{"from": trafo, "to": upstream},
		map[string]interface{}{"from": node("BasePOI")},
	}
	applyGridPrices(topology, gridPrices{ImportCt: 34, ExportCt: 7.9})

	for name, n := range map[string]map[string]interface{}{"trafo": trafo, "upstream": upstream} {
		props := n["properties"].(map[string]interface{})
		if props["grid_import_price"] != 0.34 || props["grid_export_price"] != 0.079 {
			t.Errorf("%s prices = %v / %v, want 0.34 / 0.079 EUR/kWh", name, props["grid_import_price"], props["grid_export_price"])
		}
	}
	if _, ok := building["properties"].(map[string]interface{})["grid_import_price"]; ok {
		t.Error("a building must not carry grid prices")
	}
}
