package weather

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

type fakeYears struct {
	years map[string][]int
	err   error
}

func (f fakeYears) Years(context.Context) (map[string][]int, error) { return f.years, f.err }

func getYears(h *WeatherHandler) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/weather/years", nil)
	h.GetYears(c)
	return w
}

func TestGetYears_ListsArchivesWithTheDefault(t *testing.T) {
	w := getYears(NewWeatherHandler(fakeYears{years: map[string][]int{"merra-2": {2018, 2019}}}, "merra-2"))

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"default_provider":"merra-2"`)
	assert.Contains(t, w.Body.String(), `"merra-2":[2018,2019]`)
}

func TestGetYears_ReportsAnUnreachableWeatherService(t *testing.T) {
	w := getYears(NewWeatherHandler(fakeYears{err: errors.New("timeout")}, "merra-2"))

	assert.Equal(t, http.StatusBadGateway, w.Code)
	assert.Contains(t, w.Body.String(), "timeout")
}
