package weather

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	weatherclient "spatialhub_backend/internal/weather"
)

type fakeArchives struct {
	archives map[string]weatherclient.Archive
	err      error
}

func (f fakeArchives) Archives(context.Context) (map[string]weatherclient.Archive, error) {
	return f.archives, f.err
}

func getYears(h *WeatherHandler) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/weather/years", nil)
	h.GetYears(c)
	return w
}

func TestGetYears_ListsArchivesWithTheDefault(t *testing.T) {
	archives := map[string]weatherclient.Archive{"merra-2": {Years: []int{2018, 2019}, Scenarios: []string{"p50"}, ScenarioSourceYears: []int{1980, 2024}}}
	w := getYears(NewWeatherHandler(fakeArchives{archives: archives}, "merra-2"))

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"default_provider":"merra-2"`)
	assert.Contains(t, w.Body.String(), `"merra-2":[2018,2019]`)
	assert.Contains(t, w.Body.String(), `"scenario_coverage":{"merra-2":{"scenarios":["p50"],"source_years":[1980,2024]}}`)
}

func TestGetYears_ReportsAnUnreachableWeatherService(t *testing.T) {
	w := getYears(NewWeatherHandler(fakeArchives{err: errors.New("timeout")}, "merra-2"))

	assert.Equal(t, http.StatusBadGateway, w.Code)
	assert.Contains(t, w.Body.String(), "timeout")
}
