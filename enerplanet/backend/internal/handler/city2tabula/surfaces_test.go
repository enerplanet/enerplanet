package city2tabula

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const surfacesPage = `{"buildings":[{"object_id":"DEBY_LOD2_1","osm_ids":["223728275"],"surfaces":[
	{"id":"r1","type":"RoofSurface","geometry":{"type":"Polygon","coordinates":[[[12.95,48.83,330],[12.96,48.83,330],[12.96,48.84,335],[12.95,48.83,330]]]}}]}],
	"attributions":[],"next_cursor":"c2"}`

func getSurfaces(t *testing.T, h *Handler, query string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/city2tabula/surfaces?"+query, nil)
	h.Surfaces(c)
	return w
}

// TestSurfaces_PassesBboxAndCursorAndReturnsThePage checks that the bbox and
// cursor reach City2TABULA and the page comes back with its cursor and ids.
func TestSurfaces_PassesBboxAndCursorAndReturnsThePage(t *testing.T) {
	fake := &fakeC2T{surfacesJSON: surfacesPage}
	h := &Handler{client: fake.client(t)}

	w := getSurfaces(t, h, "country=germany&xmin=12.9&ymin=48.8&xmax=13.0&ymax=48.9&cursor=c1")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "germany", fake.surfacesPayload["country"])
	assert.Equal(t, 12.9, fake.surfacesPayload["xmin"])
	assert.Equal(t, 48.9, fake.surfacesPayload["ymax"])
	assert.Equal(t, "c1", fake.surfacesPayload["cursor"])

	var page SurfacesResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &page))
	assert.Equal(t, "germany", page.Country)
	require.Len(t, page.Buildings, 1)
	assert.Equal(t, []string{"223728275"}, page.Buildings[0].OSMIDs)
	assert.Equal(t, "r1", page.Buildings[0].Surfaces[0].ID)
	require.NotNil(t, page.NextCursor)
	assert.Equal(t, "c2", *page.NextCursor)

	getSurfaces(t, h, "country=germany&xmin=12.9&ymin=48.8&xmax=13.0&ymax=48.9")
	assert.NotContains(t, fake.surfacesPayload, "cursor", "the first page sends no cursor")
}

// TestSurfaces_WorksOutTheCountryFromTheBbox checks that a request without a
// country is answered for the country at the bbox centre, and names it.
func TestSurfaces_WorksOutTheCountryFromTheBbox(t *testing.T) {
	fake := &fakeC2T{surfacesJSON: surfacesPage}
	country := &fakeCountry{country: "netherlands"}
	h := &Handler{client: fake.client(t), country: country}

	w := getSurfaces(t, h, "xmin=6.0&ymin=52.0&xmax=6.2&ymax=52.2")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "netherlands", fake.surfacesPayload["country"])
	assert.Contains(t, country.gotGeoJSON, "6.1,52.1")
	var page SurfacesResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &page))
	assert.Equal(t, "netherlands", page.Country)
}

// TestSurfaces_RejectsMissingCountryAndBadBbox checks the 400s answered before
// any call to City2TABULA.
func TestSurfaces_RejectsMissingCountryAndBadBbox(t *testing.T) {
	fake := &fakeC2T{surfacesJSON: surfacesPage}
	h := &Handler{client: fake.client(t)}

	assert.Equal(t, http.StatusBadRequest, getSurfaces(t, h, "xmin=12.9&ymin=48.8&xmax=13.0&ymax=48.9").Code,
		"without a country resolver, the country is required")
	assert.Equal(t, http.StatusBadRequest, getSurfaces(t, h, "country=germany&xmin=13.0&ymin=48.8&xmax=12.9&ymax=48.9").Code)
	assert.Equal(t, http.StatusBadRequest, getSurfaces(t, h, "country=germany&xmin=a&ymin=48.8&xmax=13.0&ymax=48.9").Code)
	assert.Nil(t, fake.surfacesPayload)
}
