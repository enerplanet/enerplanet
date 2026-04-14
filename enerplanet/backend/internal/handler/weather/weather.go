package weather

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"

	"github.com/gin-gonic/gin"
)

type CurrentWeatherData struct {
	Temperature float64  `json:"temperature"`
	WeatherCode int      `json:"weather_code"`
	Description string   `json:"description"`
	WindSpeed   float64  `json:"wind_speed"`
	Humidity    int      `json:"humidity"`
	UVIndex     *float64 `json:"uv_index,omitempty"`
}

type WeatherHandler struct{}

func NewWeatherHandler() *WeatherHandler {
	return &WeatherHandler{}
}

// GetCurrentWeather returns current weather for provided coordinates or defaults to Galicia
func (h *WeatherHandler) GetCurrentWeather(c *gin.Context) {
	latQ := strings.TrimSpace(c.Query("lat"))
	lonQ := strings.TrimSpace(c.Query("lon"))
	latitude := 42.5751
	longitude := -8.1339
	if latQ != "" && lonQ != "" {
		if latVal, err := strconv.ParseFloat(latQ, 64); err == nil && latVal >= -90 && latVal <= 90 {
			if lonVal, err2 := strconv.ParseFloat(lonQ, 64); err2 == nil && lonVal >= -180 && lonVal <= 180 {
				latitude = latVal
				longitude = lonVal
			}
		}
	}

	url := fmt.Sprintf("https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,uv_index&timezone=UTC",
		latitude, longitude)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		httputil.InternalError(c, "Failed to create weather request")
		return
	}

	client := &http.Client{Timeout: constants.HTTPTimeoutExternal}
	resp, err := client.Do(req)
	if err != nil {
		httputil.InternalError(c, "Failed to fetch weather data")
		return
	}
	defer func() { _ = resp.Body.Close() }()

	var apiResponse struct {
		Current struct {
			Time        string   `json:"time"`
			Temperature float64  `json:"temperature_2m"`
			WeatherCode int      `json:"weather_code"`
			WindSpeed   float64  `json:"wind_speed_10m"`
			Humidity    int      `json:"relative_humidity_2m"`
			UVIndex     *float64 `json:"uv_index"`
		} `json:"current"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&apiResponse); err != nil {
		httputil.InternalError(c, "Failed to parse weather data")
		return
	}

	currentWeather := CurrentWeatherData{
		Temperature: apiResponse.Current.Temperature,
		WeatherCode: apiResponse.Current.WeatherCode,
		Description: getWeatherDescription(apiResponse.Current.WeatherCode),
		WindSpeed:   apiResponse.Current.WindSpeed,
		Humidity:    apiResponse.Current.Humidity,
		UVIndex:     apiResponse.Current.UVIndex,
	}

	httputil.SuccessResponse(c, gin.H{
		"location": fmt.Sprintf("%.4f, %.4f", latitude, longitude),
		"current":  currentWeather,
	})
}

// GetWeather calls GetCurrentWeather for backward compatibility
func (h *WeatherHandler) GetWeather(c *gin.Context) {
	h.GetCurrentWeather(c)
}

func getWeatherDescription(code int) string {
	descriptions := map[int]string{
		0:  "Clear sky",
		1:  "Mainly clear",
		2:  "Partly cloudy",
		3:  "Overcast",
		45: "Fog",
		48: "Depositing rime fog",
		51: "Light drizzle",
		53: "Moderate drizzle",
		55: "Dense drizzle",
		56: "Light freezing drizzle",
		57: "Dense freezing drizzle",
		61: "Slight rain",
		63: "Moderate rain",
		65: "Heavy rain",
		66: "Light freezing rain",
		67: "Heavy freezing rain",
		71: "Slight snow fall",
		73: "Moderate snow fall",
		75: "Heavy snow fall",
		77: "Snow grains",
		80: "Slight rain showers",
		81: "Moderate rain showers",
		82: "Violent rain showers",
		85: "Slight snow showers",
		86: "Heavy snow showers",
		95: "Thunderstorm",
		96: "Thunderstorm with slight hail",
		99: "Thunderstorm with heavy hail",
	}

	if desc, exists := descriptions[code]; exists {
		return desc
	}
	return "Unknown"
}
