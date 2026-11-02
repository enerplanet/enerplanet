package jobs

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"

	"spatialhub_backend/internal/weather"
)

func TestWeatherFailureReason(t *testing.T) {
	rejected := fmt.Errorf("%w: HTTP 422: no servable archive for merra-2 in 2023", weather.ErrRejected)
	assert.Equal(t,
		"no weather data for this area (weather-serve rejected the request: HTTP 422: no servable archive for merra-2 in 2023)",
		weatherFailureReason(rejected))
	assert.Equal(t, reasonWeatherUnavailable, weatherFailureReason(errors.New("weather-serve timed out: read timeout")))
	assert.Equal(t, reasonWeatherUnavailable, weatherFailureReason(context.DeadlineExceeded))
}
