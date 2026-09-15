package city2tabula

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/api/contracts"
)

// areaBuildings is City2TABULA's bbox response: it reports no PyLovo link, so
// osm_id is empty and match_type is 0 on every row.
const areaBuildings = `[
  {"object_id":"NL.A","osm_id":"","match_type":0,"number_of_storeys":2,"room_height":2.5,
   "footprint_area":80,"tabula_variant_code":"NL.N.SFH.05.Gen",
   "surfaces":[{"id":"w1","type":"WallSurface","area":30,"azimuth":180,"tilt":0}]},
  {"object_id":"NL.B","osm_id":"","match_type":0,"number_of_storeys":1,"room_height":2.4,
   "footprint_area":40,"tabula_variant_code":"NL.N.SFH.05.Gen",
   "surfaces":[{"id":"w2","type":"WallSurface","area":20,"azimuth":90,"tilt":0}]}
]`

const areaGeometry = `[
  {"object_id":"NL.A","footprint_geojson":{"type":"MultiPolygon","crs":{"type":"name","properties":{"name":"EPSG:28992"}},"coordinates":[[[[198203.0,458493.5]]]]}}
]`

func postArea(t *testing.T, h *Handler, body string) (*httptest.ResponseRecorder, contracts.AreaEnrichResponse) {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/city2tabula/enrich/area", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	h.EnrichArea(c)
	var resp contracts.AreaEnrichResponse
	if w.Body.Len() > 0 {
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	}
	return w, resp
}

const areaBody = `{"country":"netherlands","bbox":{"xmin":6.0162,"ymin":52.0988,"xmax":6.0384,"ymax":52.1130}}`

// TestEnrichArea_KeysByObjectIDAndAttachesGeometry covers the reason this
// endpoint exists: a caller with only an area, and no building list, still
// gets envelopes and footprints.
func TestEnrichArea_KeysByObjectIDAndAttachesGeometry(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: areaBuildings, geometryJSON: areaGeometry}
	h := &Handler{client: fake.client(t)}

	w, resp := postArea(t, h, areaBody)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, 2, resp.Total)
	assert.Equal(t, 1, resp.WithGeometry, "only NL.A has a footprint")
	require.Contains(t, resp.Data, "NL.A")
	require.Contains(t, resp.Data, "NL.B")
	assert.NotEmpty(t, resp.Data["NL.A"].FootprintGeoJSON)
	assert.Empty(t, resp.Data["NL.B"].FootprintGeoJSON)
	assert.NotEmpty(t, resp.Data["NL.A"].Buem.Building.Envelope.Elements,
		"the envelope is the point of the endpoint")
}

// TestEnrichArea_GeometryFailureStillReturnsEnvelopes asserts the geometry call
// degrades rather than failing the request: envelope data is useful without
// footprints, and geometry needs a separate upstream target that may be absent.
func TestEnrichArea_GeometryFailureStillReturnsEnvelopes(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: areaBuildings, geometryFails: true}
	h := &Handler{client: fake.client(t)}

	w, resp := postArea(t, h, areaBody)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, 2, resp.Total)
	assert.Zero(t, resp.WithGeometry)
	assert.NotEmpty(t, resp.Data["NL.A"].Buem.Building.Envelope.Elements)
}

func TestEnrichArea_RejectsBadInput(t *testing.T) {
	for _, tt := range []struct{ name, body string }{
		{"no country", `{"bbox":{"xmin":6.0,"ymin":52.0,"xmax":6.1,"ymax":52.1}}`},
		{"inverted bbox", `{"country":"netherlands","bbox":{"xmin":6.1,"ymin":52.0,"xmax":6.0,"ymax":52.1}}`},
		{"empty bbox", `{"country":"netherlands","bbox":{"xmin":6.0,"ymin":52.0,"xmax":6.0,"ymax":52.1}}`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			h := &Handler{client: (&fakeC2T{}).client(t)}
			w, _ := postArea(t, h, tt.body)
			assert.Equal(t, http.StatusBadRequest, w.Code)
		})
	}
}
