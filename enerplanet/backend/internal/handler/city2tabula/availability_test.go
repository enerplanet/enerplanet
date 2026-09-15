package city2tabula

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/api/contracts"
	"spatialhub_backend/internal/models"
)

// fakeGrid stands in for the cached-region store.
type fakeGrid struct {
	regions []models.CachedRegion
	err     error
}

func (f fakeGrid) GridRegionsOverlapping(west, south, east, north float64) ([]models.CachedRegion, error) {
	return f.regions, f.err
}

func bremenRegion() []models.CachedRegion {
	return []models.CachedRegion{{CountryCode: "DE", StateCode: "hb", GridCount: 12}}
}

// getAvailability drives the handler over a valid area and returns the recorder
// plus the decoded body.
func getAvailability(t *testing.T, h *Handler, query string) (*httptest.ResponseRecorder, contracts.HeatAvailabilityResponse) {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/heat/availability?"+query, nil)
	h.Availability(c)
	var resp contracts.HeatAvailabilityResponse
	if w.Body.Len() > 0 {
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	}
	return w, resp
}

const loenenArea = "country=netherlands&xmin=6.0180&ymin=52.0978&xmax=6.0356&ymax=52.1079"

// TestAvailability_States covers the three answers and, in particular, keeps
// "both datasets present but nothing linked" distinct from "a dataset is
// missing": the first needs a City2TABULA link run, the second needs data.
func TestAvailability_States(t *testing.T) {
	tests := []struct {
		name          string
		linked        int
		buildingsJSON string
		regions       []models.CachedRegion
		wantStatus    string
		wantAvailable bool
		want3D        bool
		wantGrid      bool
	}{
		{
			name:          "linked buildings and a grid are ready",
			linked:        124,
			regions:       bremenRegion(),
			wantStatus:    "ready",
			wantAvailable: true,
			want3D:        true,
			wantGrid:      true,
		},
		{
			name:          "both datasets present but nothing linked is linkable",
			linked:        0,
			buildingsJSON: twoWallBuilding,
			regions:       bremenRegion(),
			wantStatus:    "linkable",
			want3D:        true,
			wantGrid:      true,
		},
		{
			name:          "3D data with no grid is partial",
			linked:        0,
			buildingsJSON: twoWallBuilding,
			wantStatus:    "partial",
			want3D:        true,
		},
		{
			name:          "a grid with no 3D data is partial",
			linked:        0,
			buildingsJSON: `[]`,
			regions:       bremenRegion(),
			wantStatus:    "partial",
			wantGrid:      true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeC2T{coverageCount: tt.linked, buildingsJSON: tt.buildingsJSON}
			h := &Handler{client: fake.client(t), grid: fakeGrid{regions: tt.regions}}

			w, resp := getAvailability(t, h, loenenArea)

			assert.Equal(t, http.StatusOK, w.Code)
			assert.Equal(t, tt.wantStatus, resp.Status)
			assert.Equal(t, tt.wantAvailable, resp.Available)
			assert.Equal(t, tt.want3D, resp.Has3DData)
			assert.Equal(t, tt.wantGrid, resp.HasGrid)
			assert.Equal(t, tt.linked, resp.LinkedBuildings)
		})
	}
}

// TestAvailability_ReadySkipsTheBuildingCount asserts the second City2TABULA
// call is not made once something is linked: a linked building is a building,
// and that call fetches every building in the area to count them.
func TestAvailability_ReadySkipsTheBuildingCount(t *testing.T) {
	// buildingsJSON is left invalid, so a c2t-buildings call would fail the run.
	fake := &fakeC2T{coverageCount: 3, buildingsJSON: `not json`}
	h := &Handler{client: fake.client(t), grid: fakeGrid{regions: bremenRegion()}}

	w, resp := getAvailability(t, h, loenenArea)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "ready", resp.Status)
}

func TestAvailability_NamesTheOverlappingGridRegions(t *testing.T) {
	fake := &fakeC2T{coverageCount: 1}
	h := &Handler{client: fake.client(t), grid: fakeGrid{regions: bremenRegion()}}

	_, resp := getAvailability(t, h, loenenArea)

	assert.Equal(t, []string{"DE/hb"}, resp.GridRegions)
}

func TestAvailability_RejectsAnUnusableArea(t *testing.T) {
	tests := []struct {
		name  string
		query string
	}{
		{"no country", "xmin=6.0&ymin=52.0&xmax=6.1&ymax=52.1"},
		{"missing bbox", "country=netherlands"},
		{"non-numeric edge", "country=netherlands&xmin=west&ymin=52.0&xmax=6.1&ymax=52.1"},
		{"inverted bbox", "country=netherlands&xmin=6.1&ymin=52.0&xmax=6.0&ymax=52.1"},
		{"empty bbox", "country=netherlands&xmin=6.0&ymin=52.0&xmax=6.0&ymax=52.1"},
		{"outside WGS84", "country=netherlands&xmin=6.0&ymin=52.0&xmax=181&ymax=52.1"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &Handler{client: (&fakeC2T{}).client(t), grid: fakeGrid{}}
			w, _ := getAvailability(t, h, tt.query)
			assert.Equal(t, http.StatusBadRequest, w.Code)
		})
	}
}

func TestAvailability_UpstreamFailureIsBadGateway(t *testing.T) {
	fake := &fakeC2T{coverageFails: true}
	h := &Handler{client: fake.client(t), grid: fakeGrid{regions: bremenRegion()}}

	w, _ := getAvailability(t, h, loenenArea)

	assert.Equal(t, http.StatusBadGateway, w.Code)
}

func TestAvailability_UnsupportedCountryIsBadRequest(t *testing.T) {
	// c2t-coverage is answered normally; the follow-up building count is the
	// call that rejects the country, and its message must still reach the user.
	fake := &fakeC2T{coverageCount: 0, buildingsBadRequest: true}
	h := &Handler{client: fake.client(t), grid: fakeGrid{}}

	w, _ := getAvailability(t, h, loenenArea)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "no TABULA data available")
}

func TestAvailability_GridStoreFailureIsNotReportedAsNoGrid(t *testing.T) {
	fake := &fakeC2T{coverageCount: 5}
	h := &Handler{client: fake.client(t), grid: fakeGrid{err: errors.New("connection refused")}}

	w, resp := getAvailability(t, h, loenenArea)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	assert.Empty(t, resp.Status, "a failed grid lookup must not answer with a coverage verdict")
}

// TestAvailability_ExhaustedRetriesAreNotAVerdict pins the answer for an area
// City2TABULA cannot answer for. A country with no data loaded fails the whole
// target rather than returning zero (City2TABULA answers HTTP 500 when the
// building_link table is absent, which TentaCron retries to its cap), and that
// must not read as coverage: it is indistinguishable from the service being
// down.
func TestAvailability_ExhaustedRetriesAreNotAVerdict(t *testing.T) {
	fake := &fakeC2T{coverageExhausted: true}
	h := &Handler{client: fake.client(t), grid: fakeGrid{regions: bremenRegion()}}

	w, resp := getAvailability(t, h, loenenArea)

	assert.Equal(t, http.StatusBadGateway, w.Code)
	assert.Empty(t, resp.Status)
	assert.False(t, resp.Available)
	assert.NotContains(t, w.Body.String(), "building_link",
		"the upstream database error must not reach the caller")
}
