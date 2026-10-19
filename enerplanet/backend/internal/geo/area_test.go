package geo

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

const openSquare = `[[12.95,48.83],[12.96,48.83],[12.96,48.84],[12.95,48.84]]`

func TestValidateArea_accepts(t *testing.T) {
	for name, tc := range map[string]struct{ in, want string }{
		"open polygon ring":         {`{"type":"Polygon","coordinates":[` + openSquare + `]}`, `{"type":"Polygon","coordinates":[` + openSquare + `]}`},
		"multipolygon":              {`{"type":"MultiPolygon","coordinates":[[` + openSquare + `]]}`, `{"type":"MultiPolygon","coordinates":[[` + openSquare + `]]}`},
		"altitude is dropped":       {`{"type":"Polygon","coordinates":[[[12.95,48.83,300],[12.96,48.83,300],[12.96,48.84,300]]]}`, `{"type":"Polygon","coordinates":[[[12.95,48.83],[12.96,48.83],[12.96,48.84]]]}`},
		"closed ring is kept as is": {`{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}`, `{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}`},
	} {
		got, err := ValidateArea([]byte(tc.in))
		if err != nil || string(got) != tc.want {
			t.Errorf("%s: got %s, %v; want %s", name, got, err, tc.want)
		}
	}
}

// Every rejection names the problem, so a client can show it.
func TestValidateArea_rejects(t *testing.T) {
	many := strings.Repeat(`[12.95,48.83],`, MaxAreaVertices) + `[12.96,48.83],[12.96,48.84]`
	for name, tc := range map[string]struct{ in, msg string }{
		"not json":            {`{"type":`, "unexpected EOF"},
		"feature collection":  {`{"type":"FeatureCollection","features":[]}`, `unknown field "features"`},
		"point":               {`{"type":"Point","coordinates":[12.9,48.8]}`, `type "Point"`},
		"foreign member":      {`{"type":"Polygon","coordinates":[` + openSquare + `],"crs":{}}`, `unknown field "crs"`},
		"trailing data":       {`{"type":"Polygon","coordinates":[` + openSquare + `]} {}`, "trailing data"},
		"string coordinate":   {`{"type":"Polygon","coordinates":[[["12.9",48.8],[1,1],[2,2]]]}`, "cannot unmarshal string"},
		"latitude range":      {`{"type":"Polygon","coordinates":[[[12.9,95],[13,48],[13,49]]]}`, "(12.9, 95) is outside"},
		"one-value position":  {`{"type":"Polygon","coordinates":[[[12.9],[13,48],[13,49]]]}`, "has 1 values"},
		"two distinct points": {`{"type":"Polygon","coordinates":[[[1,1],[2,2],[1,1],[2,2]]]}`, "2 distinct positions"},
		"no rings":            {`{"type":"Polygon","coordinates":[]}`, "polygon 0 has no rings"},
		"no polygons":         {`{"type":"MultiPolygon","coordinates":[]}`, "0 polygons"},
		"too many vertices":   {`{"type":"Polygon","coordinates":[[` + many + `]]}`, fmt.Sprintf("more than %d vertices", MaxAreaVertices)},
		"number overflow":     {`{"type":"Polygon","coordinates":[[[1e400,48],[13,48],[13,49]]]}`, "cannot unmarshal number 1e400"},
	} {
		_, err := ValidateArea([]byte(tc.in))
		if !errors.Is(err, ErrInvalidArea) || !strings.Contains(err.Error(), tc.msg) {
			t.Errorf("%s: err = %v, want ErrInvalidArea mentioning %q", name, err, tc.msg)
		}
	}
}
