// Package geo provides resolvers for deriving geographic attributes from
// stored model geometries. country.go implements backend-authoritative
// country resolution from a GeoJSON coordinates field.
package geo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"
)

// Resolver resolves a canonical country name from a GeoJSON geometry.
type Resolver interface {
	Resolve(ctx context.Context, coordinates json.RawMessage) (string, error)
}

// ErrNoCountry is returned when no country can be resolved for the given
// coordinates (e.g. oceans, Antarctica, or unsupported region).
var ErrNoCountry = errors.New("no country could be resolved for these coordinates")

// ErrInvalidCoordinates is returned when the provided coordinates JSON is
// empty or malformed.
var ErrInvalidCoordinates = errors.New("coordinates are missing or invalid")

// NominatimResolver is a Resolver that calls Nominatim reverse geocoding
// and caches results per ~1km coordinate bucket in the database.
type NominatimResolver struct {
	db         *gorm.DB
	httpClient *http.Client
	baseURL    string
	userAgent  string
}

// NewNominatimResolver constructs a resolver. The caller provides the gorm
// DB used for the coordinate_country_cache table.
func NewNominatimResolver(db *gorm.DB) *NominatimResolver {
	return &NominatimResolver{
		db:         db,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		baseURL:    "https://nominatim.openstreetmap.org",
		userAgent:  "enerplanet-backend/1.0 (ops@enerplanet.example)",
	}
}

// Resolve implements Resolver.
func (r *NominatimResolver) Resolve(ctx context.Context, coords json.RawMessage) (string, error) {
	if len(coords) == 0 {
		return "", ErrInvalidCoordinates
	}

	lat, lon, err := CentroidFromGeoJSON(coords)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrInvalidCoordinates, err)
	}

	latKey, lonKey := bucketKey(lat), bucketKey(lon)

	if cached, ok := r.readCache(ctx, latKey, lonKey); ok {
		return cached, nil
	}

	rawCountry, err := r.callNominatim(ctx, lat, lon)
	if err != nil {
		return "", err
	}

	normalized := NormalizeCountry(rawCountry)
	if normalized == "" {
		return "", ErrNoCountry
	}

	r.writeCache(ctx, latKey, lonKey, normalized)
	return normalized, nil
}

// bucketKey rounds a coordinate to ~1.1 km precision so nearby save
// requests share the same cache entry.
func bucketKey(v float64) int {
	return int(math.Round(v * 100))
}

func (r *NominatimResolver) readCache(ctx context.Context, latKey, lonKey int) (string, bool) {
	var country string
	row := r.db.WithContext(ctx).Raw(
		"SELECT country FROM coordinate_country_cache WHERE lat_key = ? AND lon_key = ?",
		latKey, lonKey,
	).Row()
	if err := row.Scan(&country); err != nil || country == "" {
		return "", false
	}
	return country, true
}

func (r *NominatimResolver) writeCache(ctx context.Context, latKey, lonKey int, country string) {
	_ = r.db.WithContext(ctx).Exec(
		`INSERT INTO coordinate_country_cache (lat_key, lon_key, country)
		 VALUES (?, ?, ?)
		 ON CONFLICT (lat_key, lon_key) DO UPDATE SET country = EXCLUDED.country`,
		latKey, lonKey, country,
	).Error
}

type nominatimAddress struct {
	Country string `json:"country"`
}

type nominatimResponse struct {
	Address nominatimAddress `json:"address"`
	Error   string           `json:"error"`
}

func (r *NominatimResolver) callNominatim(ctx context.Context, lat, lon float64) (string, error) {
	q := url.Values{}
	q.Set("format", "jsonv2")
	q.Set("lat", fmt.Sprintf("%.6f", lat))
	q.Set("lon", fmt.Sprintf("%.6f", lon))
	q.Set("zoom", "3") // country-level
	q.Set("accept-language", "en")

	endpoint := r.baseURL + "/reverse?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", fmt.Errorf("build nominatim request: %w", err)
	}
	req.Header.Set("User-Agent", r.userAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := r.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("nominatim reverse geocode failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("nominatim read body: %w", err)
	}
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("nominatim returned status %d: %s", resp.StatusCode, string(body))
	}

	var parsed nominatimResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("nominatim response unparseable: %w", err)
	}
	if parsed.Error != "" {
		return "", fmt.Errorf("nominatim error: %s", parsed.Error)
	}
	if parsed.Address.Country == "" {
		return "", ErrNoCountry
	}
	return parsed.Address.Country, nil
}

// NormalizeCountry maps a free-form country name (in any of the languages
// Nominatim may return) to the canonical lowercase key expected by the PV
// simulation service. Returns "" if unknown.
//
// Keep this table in sync with
// new-photovoltaik-simulation-enerplanet/scripts/start.py COUNTRY_ALIASES.
func NormalizeCountry(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	s = strings.ReplaceAll(s, " ", "_")
	if s == "" {
		return ""
	}
	if canon, ok := countryAliases[s]; ok {
		return canon
	}
	if _, ok := knownCanonical[s]; ok {
		return s
	}
	return ""
}

var knownCanonical = map[string]struct{}{
	"germany": {}, "france": {}, "austria": {}, "switzerland": {},
	"netherlands": {}, "belgium": {}, "poland": {}, "sweden": {},
	"norway": {}, "finland": {}, "denmark": {}, "ireland": {},
	"czechia": {}, "romania": {}, "hungary": {}, "greece": {},
	"croatia": {}, "bulgaria": {}, "slovakia": {}, "slovenia": {},
	"luxembourg": {}, "estonia": {}, "latvia": {}, "lithuania": {},
	"spain": {}, "italy": {}, "portugal": {}, "uk": {},
}

var countryAliases = map[string]string{
	"deutschland": "germany", "frankreich": "france", "oesterreich": "austria",
	"osterreich": "austria", "österreich": "austria", "schweiz": "switzerland",
	"niederlande": "netherlands", "belgien": "belgium", "polen": "poland",
	"schweden": "sweden", "norwegen": "norway", "finnland": "finland",
	"dänemark": "denmark", "daenemark": "denmark", "irland": "ireland",
	"tschechien": "czechia", "tschechische_republik": "czechia",
	"rumänien": "romania", "rumaenien": "romania", "ungarn": "hungary",
	"griechenland": "greece", "kroatien": "croatia", "bulgarien": "bulgaria",
	"slowakei": "slovakia", "slowenien": "slovenia", "luxemburg": "luxembourg",
	"estland": "estonia", "lettland": "latvia", "litauen": "lithuania",
	"spanien": "spain", "italien": "italy",
	"united_kingdom": "uk", "great_britain": "uk",
	"the_netherlands": "netherlands", "holland": "netherlands",
	"allemagne": "germany", "autriche": "austria", "suisse": "switzerland",
	"pays-bas": "netherlands", "pays_bas": "netherlands", "belgique": "belgium",
	"pologne": "poland", "suède": "sweden", "suede": "sweden",
	"norvège": "norway", "norvege": "norway", "finlande": "finland",
	"danemark": "denmark", "irlande": "ireland", "tchéquie": "czechia",
	"tchequie": "czechia", "république_tchèque": "czechia",
	"republique_tcheque": "czechia", "roumanie": "romania",
	"hongrie": "hungary", "grèce": "greece", "grece": "greece",
	"croatie": "croatia", "bulgarie": "bulgaria", "slovaquie": "slovakia",
	"slovénie": "slovenia", "slovenie": "slovenia", "estonie": "estonia",
	"lettonie": "latvia", "lituanie": "lithuania", "espagne": "spain",
	"italie": "italy", "royaume-uni": "uk", "royaume_uni": "uk",
}

// CentroidFromGeoJSON extracts a lat/lon centroid from a GeoJSON geometry
// stored as raw JSON. Supports Point, Polygon, and MultiPolygon.
// Coordinates in GeoJSON are [lon, lat]; the returned tuple is (lat, lon).
func CentroidFromGeoJSON(raw json.RawMessage) (lat float64, lon float64, err error) {
	var geom map[string]interface{}
	if err := json.Unmarshal(raw, &geom); err != nil {
		return 0, 0, fmt.Errorf("invalid geojson: %w", err)
	}
	return centroidFromGeom(geom)
}

func centroidFromGeom(geom map[string]interface{}) (float64, float64, error) {
	gt, _ := geom["type"].(string)
	coords, ok := geom["coordinates"]
	if !ok {
		return 0, 0, errors.New("geometry missing coordinates")
	}
	var pts [][]float64
	switch gt {
	case "Point":
		arr, ok := coords.([]interface{})
		if !ok || len(arr) < 2 {
			return 0, 0, errors.New("invalid Point coordinates")
		}
		return toFloat(arr[1]), toFloat(arr[0]), nil
	case "Polygon":
		pts = outerRing(coords)
	case "MultiPolygon":
		arr, ok := coords.([]interface{})
		if !ok || len(arr) == 0 {
			return 0, 0, errors.New("empty MultiPolygon")
		}
		pts = outerRing(arr[0])
	default:
		return 0, 0, fmt.Errorf("unsupported geometry type: %s", gt)
	}
	if len(pts) == 0 {
		return 0, 0, errors.New("no points in geometry")
	}
	var sx, sy float64
	for _, p := range pts {
		sx += p[0]
		sy += p[1]
	}
	n := float64(len(pts))
	// points are [lon, lat]
	return sy / n, sx / n, nil
}

func outerRing(polyCoords interface{}) [][]float64 {
	rings, ok := polyCoords.([]interface{})
	if !ok || len(rings) == 0 {
		return nil
	}
	outer, ok := rings[0].([]interface{})
	if !ok {
		return nil
	}
	var pts [][]float64
	for _, p := range outer {
		pt, ok := p.([]interface{})
		if !ok || len(pt) < 2 {
			continue
		}
		pts = append(pts, []float64{toFloat(pt[0]), toFloat(pt[1])})
	}
	return pts
}

func toFloat(v interface{}) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case float32:
		return float64(x)
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case json.Number:
		f, _ := x.Float64()
		return f
	}
	return 0
}
