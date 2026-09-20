package city2tabula

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	c2t "spatialhub_backend/internal/city2tabula"
)

const surfaceGeometry = `[
  {"object_id":"DE.A",
   "footprint_geojson":{"type":"MultiPolygon","coordinates":[[[[486100.0,5882100.0]]]]},
   "surfaces":[
     {"id":"s-1","type":"WallSurface","area":12.5,"azimuth":94.4,"tilt":0},
     {"id":"s-2","type":"RoofSurface","area":31.0,"azimuth":180.0,"tilt":35}
   ]}
]`

func getGeometry(t *testing.T, h *Handler, query string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/city2tabula/geometry?"+query, nil)
	h.Geometry(c)
	return w
}

// TestGeometry_ReturnsSurfacesUnwrapped covers the shape the configurator
// depends on: a bare array, not a {data:...} envelope, with the surface ids
// that BuEM envelope elements carry.
func TestGeometry_ReturnsSurfacesUnwrapped(t *testing.T) {
	fake := &fakeC2T{geometryJSON: surfaceGeometry}
	h := &Handler{client: fake.client(t)}

	w := getGeometry(t, h, "country=germany&object_ids=DE.A")

	require.Equal(t, http.StatusOK, w.Code)
	var got []c2t.BuildingGeometry
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got), "the body is a bare array")
	require.Len(t, got, 1)
	assert.Equal(t, "DE.A", got[0].ObjectID)
	require.Len(t, got[0].Surfaces, 2)
}

// TestGeometry_UnknownBuildingIsAnEmptyArray keeps a caller that indexes the
// first element from having to distinguish null from a miss.
func TestGeometry_UnknownBuildingIsAnEmptyArray(t *testing.T) {
	fake := &fakeC2T{geometryJSON: `[]`}
	h := &Handler{client: fake.client(t)}

	w := getGeometry(t, h, "country=germany&object_ids=nope")

	require.Equal(t, http.StatusOK, w.Code)
	assert.JSONEq(t, `[]`, w.Body.String())
}

func TestGeometry_RejectsMissingAndOversizedParams(t *testing.T) {
	fake := &fakeC2T{geometryJSON: surfaceGeometry}
	h := &Handler{client: fake.client(t)}

	for name, query := range map[string]string{
		"no country":    "object_ids=DE.A",
		"no object_ids": "country=germany",
		"empty ids":     "country=germany&object_ids=,,",
		"two ids":       "country=germany&object_ids=DE.A,DE.B",
	} {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, http.StatusBadRequest, getGeometry(t, h, query).Code)
		})
	}
}

// TestGeometry_UpstreamFailureIsBadGateway keeps City2TABULA's own wording,
// which carries database and container names, out of the browser.
func TestGeometry_UpstreamFailureIsBadGateway(t *testing.T) {
	fake := &fakeC2T{geometryFails: true}
	h := &Handler{client: fake.client(t)}

	w := getGeometry(t, h, "country=germany&object_ids=DE.A")

	assert.Equal(t, http.StatusBadGateway, w.Code)
}

func TestSplitObjectIDs(t *testing.T) {
	assert.Equal(t, []string{"a"}, splitObjectIDs("a"))
	assert.Equal(t, []string{"a", "b"}, splitObjectIDs(" a , b "))
	assert.Empty(t, splitObjectIDs(""))
	assert.Empty(t, splitObjectIDs(" , "))
	assert.Equal(t, []string{"a"}, splitObjectIDs("a,"), "a trailing comma is not a missing id")
}
