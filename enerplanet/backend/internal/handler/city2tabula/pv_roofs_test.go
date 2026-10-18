package city2tabula

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func getPVRoofs(t *testing.T, h *Handler, query string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/city2tabula/pv-roofs?"+query, nil)
	h.PVRoofs(c)
	return w
}

func TestPVRoofs_ListsRoofsWithPlacement(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: `{"buildings":[{"object_id":"DE.A","osm_id":"42","surfaces":[
		{"id":"r-south","type":"RoofSurface","area":40,"azimuth":180,"tilt":55},
		{"id":"r-north","type":"RoofSurface","area":40,"azimuth":0,"tilt":55},
		{"id":"w-1","type":"WallSurface","area":80,"azimuth":180,"tilt":0}]}],"attributions":[]}`}
	h := &Handler{client: fake.client(t)}

	w := getPVRoofs(t, h, "country=germany&osm_id=42")

	require.Equal(t, http.StatusOK, w.Code)
	assert.JSONEq(t, `{"roofs":[
		{"surface_id":"r-south","tilt":35,"azimuth":180,"area":40,"usable_share":0.8,"qualifies":true},
		{"surface_id":"r-north","tilt":35,"azimuth":0,"area":40,"usable_share":0.8,"qualifies":false}]}`, w.Body.String())
}

func TestPVRoofs_NoBuildingIsEmptyList(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: `{"buildings":[],"attributions":[]}`}
	h := &Handler{client: fake.client(t)}

	w := getPVRoofs(t, h, "country=germany&osm_id=42")

	require.Equal(t, http.StatusOK, w.Code)
	assert.JSONEq(t, `{"roofs":[]}`, w.Body.String())
}

func TestPVRoofs_ResolvesCountryFromCoordinates(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: `{"buildings":[],"attributions":[]}`}
	h := &Handler{client: fake.client(t), country: &fakeCountry{country: "germany"}}

	w := getPVRoofs(t, h, "osm_id=42&lon=12.95&lat=48.83")

	require.Equal(t, http.StatusOK, w.Code)
}

func TestPVRoofs_RequiresOSMIDAndALocation(t *testing.T) {
	h := &Handler{client: (&fakeC2T{}).client(t), country: &fakeCountry{country: "germany"}}
	for _, query := range []string{"osm_id=42", "country=germany", "osm_id=42&lon=x&lat=48", ""} {
		assert.Equal(t, http.StatusBadRequest, getPVRoofs(t, h, query).Code, query)
	}
}
