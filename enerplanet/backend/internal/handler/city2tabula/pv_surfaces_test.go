package city2tabula

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func getPVSurfaces(t *testing.T, h *Handler, query string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/city2tabula/pv-surfaces?"+query, nil)
	h.PVSurfaces(c)
	return w
}

func TestPVSurfaces_ListsRoofsAndWallsWithPlacement(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: `{"buildings":[{"object_id":"DE.A","osm_id":"42","surfaces":[
		{"id":"r-south","type":"RoofSurface","area":40,"azimuth":180,"tilt":55},
		{"id":"r-north","type":"RoofSurface","area":40,"azimuth":0,"tilt":55},
		{"id":"w-1","type":"WallSurface","area":80,"azimuth":180,"tilt":0}]}],"attributions":[]}`}
	h := &Handler{client: fake.client(t)}

	w := getPVSurfaces(t, h, "country=germany&osm_id=42")

	require.Equal(t, http.StatusOK, w.Code)
	assert.JSONEq(t, `{"surfaces":[
		{"surface_id":"r-south","tilt":35,"azimuth":180,"area":40,"usable_share":0.8,"kind":"roof","qualifies":true,"suggested":true,"object_id":"DE.A"},
		{"surface_id":"r-north","tilt":35,"azimuth":0,"area":40,"usable_share":0.8,"kind":"roof","qualifies":false,"suggested":false,"object_id":"DE.A"},
		{"surface_id":"w-1","tilt":90,"azimuth":180,"area":80,"usable_share":0.8,"kind":"wall","qualifies":false,"suggested":true,"object_id":"DE.A"}]}`, w.Body.String())
}

// A way covering several 3D buildings lists every building's surfaces, each
// with its building, so the view can name the ones it does not show.
func TestPVSurfaces_TagsEachSurfaceWithItsBuilding(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: `{"buildings":[
		{"object_id":"DE.A","osm_id":"42","surfaces":[{"id":"a-roof","type":"RoofSurface","area":40,"azimuth":180,"tilt":55}]},
		{"object_id":"DE.B","osm_id":"42","surfaces":[{"id":"b-roof","type":"RoofSurface","area":30,"azimuth":180,"tilt":55}]}],"attributions":[]}`}
	h := &Handler{client: fake.client(t)}

	w := getPVSurfaces(t, h, "country=germany&osm_id=42")

	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"surface_id":"a-roof"`)
	assert.Contains(t, w.Body.String(), `"surface_id":"b-roof"`)
	assert.Regexp(t, `"surface_id":"a-roof"[^}]*"object_id":"DE.A"`, w.Body.String())
	assert.Regexp(t, `"surface_id":"b-roof"[^}]*"object_id":"DE.B"`, w.Body.String())
}

func TestPVSurfaces_NoBuildingIsEmptyList(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: `{"buildings":[],"attributions":[]}`}
	h := &Handler{client: fake.client(t)}

	w := getPVSurfaces(t, h, "country=germany&osm_id=42")

	require.Equal(t, http.StatusOK, w.Code)
	assert.JSONEq(t, `{"surfaces":[]}`, w.Body.String())
}

func TestPVSurfaces_ResolvesCountryFromCoordinates(t *testing.T) {
	fake := &fakeC2T{buildingsJSON: `{"buildings":[],"attributions":[]}`}
	h := &Handler{client: fake.client(t), country: &fakeCountry{country: "germany"}}

	w := getPVSurfaces(t, h, "osm_id=42&lon=12.95&lat=48.83")

	require.Equal(t, http.StatusOK, w.Code)
}

func TestPVSurfaces_RequiresOSMIDAndALocation(t *testing.T) {
	h := &Handler{client: (&fakeC2T{}).client(t), country: &fakeCountry{country: "germany"}}
	for _, query := range []string{"osm_id=42", "country=germany", "osm_id=42&lon=x&lat=48", ""} {
		assert.Equal(t, http.StatusBadRequest, getPVSurfaces(t, h, query).Code, query)
	}
}
