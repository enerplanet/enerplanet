package geo

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
)

// Limits on an area geometry accepted from a client. They bound the work one
// area causes downstream; a drawn area has tens of vertices, an imported
// administrative boundary a few thousand.
const (
	MaxAreaPolygons = 100
	MaxAreaVertices = 10000
)

// ErrInvalidArea is wrapped by every ValidateArea rejection.
var ErrInvalidArea = errors.New("invalid area geometry")

type areaGeometry struct {
	Type        string          `json:"type"`
	Coordinates json.RawMessage `json:"coordinates"`
}

// ValidateArea checks an area against the GeoJSON rules of RFC 7946: a
// Polygon or MultiPolygon in WGS84, positions of longitude, latitude and an
// optional altitude, every ring with at least three distinct positions. A ring
// may be open, since clients send drawn rings without the closing position.
// It returns the geometry rebuilt from the parsed numbers, so only checked
// values are passed on; the altitude is dropped.
func ValidateArea(raw []byte) (json.RawMessage, error) {
	var g areaGeometry
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&g); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidArea, err)
	}
	if dec.More() {
		return nil, fmt.Errorf("%w: trailing data after the geometry", ErrInvalidArea)
	}

	var polygons [][][][]float64
	switch g.Type {
	case "Polygon":
		var p [][][]float64
		if err := json.Unmarshal(g.Coordinates, &p); err != nil {
			return nil, fmt.Errorf("%w: Polygon coordinates: %v", ErrInvalidArea, err)
		}
		polygons = [][][][]float64{p}
	case "MultiPolygon":
		if err := json.Unmarshal(g.Coordinates, &polygons); err != nil {
			return nil, fmt.Errorf("%w: MultiPolygon coordinates: %v", ErrInvalidArea, err)
		}
	default:
		return nil, fmt.Errorf("%w: type %q, want Polygon or MultiPolygon", ErrInvalidArea, g.Type)
	}

	clean, err := checkPolygons(polygons)
	if err != nil {
		return nil, err
	}
	out := struct {
		Type        string `json:"type"`
		Coordinates any    `json:"coordinates"`
	}{Type: g.Type, Coordinates: clean}
	if g.Type == "Polygon" {
		out.Coordinates = clean[0]
	}
	return json.Marshal(out)
}

// checkPolygons applies the count limits and the ring rules, returning the
// polygons with every position cut to longitude and latitude.
func checkPolygons(polygons [][][][]float64) ([][][][2]float64, error) {
	if len(polygons) == 0 || len(polygons) > MaxAreaPolygons {
		return nil, fmt.Errorf("%w: %d polygons, want 1 to %d", ErrInvalidArea, len(polygons), MaxAreaPolygons)
	}
	clean := make([][][][2]float64, len(polygons))
	vertices := 0
	for pi, polygon := range polygons {
		if len(polygon) == 0 {
			return nil, fmt.Errorf("%w: polygon %d has no rings", ErrInvalidArea, pi)
		}
		clean[pi] = make([][][2]float64, len(polygon))
		for ri, ring := range polygon {
			vertices += len(ring)
			if vertices > MaxAreaVertices {
				return nil, fmt.Errorf("%w: more than %d vertices", ErrInvalidArea, MaxAreaVertices)
			}
			r, err := checkRing(ring)
			if err != nil {
				return nil, fmt.Errorf("%w: polygon %d ring %d: %v", ErrInvalidArea, pi, ri, err)
			}
			clean[pi][ri] = r
		}
	}
	return clean, nil
}

// checkRing checks each position's dimension and range and that the ring
// holds at least three distinct positions.
func checkRing(ring [][]float64) ([][2]float64, error) {
	out := make([][2]float64, len(ring))
	distinct := map[[2]float64]bool{}
	for i, pos := range ring {
		if len(pos) != 2 && len(pos) != 3 {
			return nil, fmt.Errorf("position %d has %d values, want 2 or 3", i, len(pos))
		}
		lon, lat := pos[0], pos[1]
		if lon < -180 || lon > 180 || lat < -90 || lat > 90 {
			return nil, fmt.Errorf("position %d (%g, %g) is outside longitude -180..180, latitude -90..90", i, lon, lat)
		}
		out[i] = [2]float64{lon, lat}
		distinct[out[i]] = true
	}
	if len(distinct) < 3 {
		return nil, fmt.Errorf("%d distinct positions, want at least 3", len(distinct))
	}
	return out, nil
}

// Touches reports whether any vertex of footprint lies inside area. Both are
// GeoJSON Polygons or MultiPolygons in the same CRS.
// Vertex test only: a footprint that an area edge crosses without any
// footprint vertex inside is not reported.
func Touches(area, footprint json.RawMessage) bool {
	areaPolys, err := polygonsOf(area)
	if err != nil {
		return false
	}
	footPolys, err := polygonsOf(footprint)
	if err != nil {
		return false
	}
	for _, poly := range footPolys {
		for _, ring := range poly {
			for _, p := range ring {
				for _, a := range areaPolys {
					if contains(a, p) {
						return true
					}
				}
			}
		}
	}
	return false
}

// polygonsOf reads a Polygon or MultiPolygon as polygons of rings of [x, y].
func polygonsOf(raw json.RawMessage) ([][][][]float64, error) {
	var g areaGeometry
	if err := json.Unmarshal(raw, &g); err != nil {
		return nil, err
	}
	switch g.Type {
	case "Polygon":
		var p [][][]float64
		err := json.Unmarshal(g.Coordinates, &p)
		return [][][][]float64{p}, err
	case "MultiPolygon":
		var mp [][][][]float64
		err := json.Unmarshal(g.Coordinates, &mp)
		return mp, err
	}
	return nil, fmt.Errorf("type %q, want Polygon or MultiPolygon", g.Type)
}

// contains is the even-odd test of p against every ring of polygon, so a
// point in a hole is outside.
func contains(polygon [][][]float64, p []float64) bool {
	if len(p) < 2 {
		return false
	}
	x, y := p[0], p[1]
	inside := false
	for _, ring := range polygon {
		for i, j := 0, len(ring)-1; i < len(ring); j, i = i, i+1 {
			if len(ring[i]) < 2 || len(ring[j]) < 2 {
				continue
			}
			xi, yi, xj, yj := ring[i][0], ring[i][1], ring[j][0], ring[j][1]
			if (yi > y) != (yj > y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi {
				inside = !inside
			}
		}
	}
	return inside
}
