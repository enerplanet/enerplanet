package meme

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// elOnlyPayload is a minimal electricity-only CalculationPayload built the way
// payload.BuildCalculationPayload does: topology of building + transformer
// features with f_class/rated_power/techs, no techs so no physics PV (MEME
// rejects physics performance without a precomputed profile).
func elOnlyPayload() []byte {
	return []byte(`{
  "user_id":"u1","model_id":"el_test_1","session_id":"1","country":"NL","lkr":"Apeldoorn",
  "callback_url":"http://backend:8000/api/v1/calculation/callback/999",
  "start_date":"2018-01-01T00:00:00.000Z","end_date":"2018-01-02T00:00:00.000Z","resolution":60,
  "energy_vectors":["electricity"],
  "topology":[
    {"from":{
       "type":"Feature","geometry":{"type":"Point","coordinates":[6.02745,52.10148]},
       "id":"trafo_1","properties":{"id":"trafo_1","osm_id":"Trafo_1","feature_type":"TopologyNode","f_class":"transformer","demand_energy":0,"demand_heat":0,"rated_power":160},
       "techs":null,"custom_demand_timeseries":null},
     "to":{
       "type":"Feature","geometry":{"type":"Point","coordinates":[6.03102,52.10355]},
       "id":"trafo_2","properties":{"id":"trafo_2","osm_id":"Trafo_2","feature_type":"TopologyNode","f_class":"transformer","demand_energy":0,"demand_heat":0,"rated_power":250},
       "techs":null,"custom_demand_timeseries":null},
     "length":0.18,"pipe":"mv"},
    {"from":{
       "type":"Feature","geometry":{"type":"Point","coordinates":[6.02745,52.10148]},
       "id":"b1","properties":{"id":"b1","osm_id":"268428040","feature_type":"BasePOI","f_class":"house","demand_energy":3745,"demand_heat":5803,"area":72.53},
       "techs":null,"custom_demand_timeseries":null},
     "to":{
       "type":"Feature","geometry":{"type":"Point","coordinates":[6.02732,52.10132]},
       "id":"trafo_1","properties":{"id":"trafo_1","osm_id":"Trafo_1","feature_type":"TopologyNode","f_class":"transformer","demand_energy":0,"demand_heat":0,"rated_power":160},
       "techs":null,"custom_demand_timeseries":null},
     "length":0.0182,"pipe":"lv"}
  ]
}`)
}

func TestTranslatePayload_emitsElectricityJob(t *testing.T) {
	got, err := TranslatePayload(elOnlyPayload())
	require.NoError(t, err)

	var job map[string]interface{}
	require.NoError(t, json.Unmarshal(got.Job, &job))

	model, _ := job["model"].(map[string]interface{})
	require.NotNil(t, model, "job has a model")

	carriers, _ := model["carriers"].(map[string]interface{})
	require.NotNil(t, carriers)
	assert.Contains(t, carriers, "electricity", "electricity carrier present")
	assert.NotContains(t, carriers, "heat", "no heat carrier yet (heat-patch.md)")

	exp, _ := job["experiment"].(map[string]interface{})
	require.NotNil(t, exp)
	assert.Equal(t, "plan", exp["mode"])

	// MEME rejects allow_unmet_demand for pypsa; the embedded mapping must not
	// carry it so the job validates against both pypsa and calliope.
	assert.NotContains(t, exp, "allow_unmet_demand", "MEME PyPSA target rejects allow_unmet_demand")
}

func TestTranslatePayload_rejectsBrokenInput(t *testing.T) {
	_, err := TranslatePayload([]byte(`{"topology":`))
	assert.Error(t, err, "malformed payload surfaces as an error")
}