package pylovo

import (
	"encoding/json"
	"reflect"
	"testing"

	"spatialhub_backend/internal/city2tabula"
)

func ptr[T any](v T) *T { return &v }

func building3D(objectID, code string, area float64, ways ...string) city2tabula.Building {
	b := city2tabula.Building{ObjectID: objectID, FootprintAreaSqm: ptr(area), NumberOfStoreys: ptr(int32(2))}
	if code != "" {
		b.FunctionCode = ptr(code)
	}
	if len(ways) > 0 {
		b.OSMID, b.OSMIDs = ways[0], ways
	}
	return b
}

// A terraced row drawn as one OSM outline becomes its 3D houses; a structure
// on a way removes nothing else; a way with no 3D building stays.
func TestPlanFootprints(t *testing.T) {
	copies := []siteCopy{
		{BuildingID: 1, OSMID: "row", FClass: "terrace"},
		{BuildingID: 2, OSMID: "shed", FClass: "roof"},
		{BuildingID: 3, OSMID: "no3d", FClass: "house"},
		{BuildingID: 4, OSMID: "campus", FClass: "university"},
	}
	linked := []city2tabula.Building{
		building3D("A", "31001_1000", 80, "row"),
		building3D("B", "31001_1000", 75, "row"),
		building3D("C", "51009_1610", 40, "shed"),
		building3D("D", "31001_3020", 900, "campus"),
		building3D("E", "51009_1610", 30, "campus"),
	}
	inArea := []city2tabula.Building{
		building3D("A", "31001_1000", 80),
		building3D("F", "31001_2000", 120),
		building3D("G", "", 20),
		building3D("H", "31001_2000", 120),
	}
	footprints := map[string]json.RawMessage{}
	for _, id := range []string{"A", "B", "C", "D", "E", "F", "G", "H"} {
		footprints[id] = json.RawMessage(`"` + id + `"`)
	}
	outside := map[string]bool{`"H"`: true}
	inSite := func(f json.RawMessage) bool { return !outside[string(f)] }

	plan := planFootprints(copies, linked, inArea, footprints, inSite)

	var got []string
	for _, a := range plan.add {
		got = append(got, a.SourceID+"="+a.FClass)
	}
	if want := []string{"A=terrace", "B=terrace", "D=university", "F=yes"}; !reflect.DeepEqual(got, want) {
		t.Errorf("added = %v, want %v", got, want)
	}
	if want := []int{1, 2, 4}; !reflect.DeepEqual(plan.exclude, want) {
		t.Errorf("excluded = %v, want %v", plan.exclude, want)
	}
	if plan.kept != 1 || plan.buildingCount() != 5 {
		t.Errorf("kept = %d, count = %d, want 1 and 5", plan.kept, plan.buildingCount())
	}
}

// A linked building whose footprint could not be fetched keeps its OSM copy.
func TestPlanFootprints_missingFootprintKeepsCopy(t *testing.T) {
	copies := []siteCopy{{BuildingID: 1, OSMID: "w1", FClass: "house"}}
	plan := planFootprints(copies, []city2tabula.Building{building3D("A", "31001_1000", 80, "w1")}, nil, nil, func(json.RawMessage) bool { return true })

	if len(plan.add) != 0 || len(plan.exclude) != 0 || plan.kept != 1 {
		t.Errorf("plan = %+v, want the copy kept and nothing added", plan)
	}
}

// The 3D use decides a building's class; a residential one keeps the more
// specific OSM class, and the 3D use "other" says nothing.
func TestPlanFootprints_classFrom3DUse(t *testing.T) {
	copies := []siteCopy{
		{BuildingID: 1, OSMID: "garage", FClass: "yes"},
		{BuildingID: 2, OSMID: "tagged", FClass: "house"},
		{BuildingID: 3, OSMID: "row", FClass: "terrace"},
		{BuildingID: 4, OSMID: "untagged", FClass: "yes"},
		{BuildingID: 5, OSMID: "farm", FClass: "yes"},
		{BuildingID: 6, OSMID: "unknown", FClass: "barn"},
	}
	withUse := func(b city2tabula.Building, use string) city2tabula.Building {
		b.UseType = ptr(use)
		return b
	}
	linked := []city2tabula.Building{
		withUse(building3D("A", "31001_2463", 40, "garage"), "ancillary"),
		withUse(building3D("B", "31001_2463", 40, "tagged"), "ancillary"),
		withUse(building3D("C", "31001_1000", 80, "row"), "residential"),
		withUse(building3D("D", "31001_1000", 80, "untagged"), "residential"),
		withUse(building3D("E", "31001_2700", 200, "farm"), "agriculture"),
		withUse(building3D("F", "31001_9998", 60, "unknown"), "other"),
	}
	footprints := map[string]json.RawMessage{}
	for _, id := range []string{"A", "B", "C", "D", "E", "F"} {
		footprints[id] = json.RawMessage(`"` + id + `"`)
	}

	plan := planFootprints(copies, linked, nil, footprints, func(json.RawMessage) bool { return true })

	var got []string
	for _, a := range plan.add {
		got = append(got, a.SourceID+"="+a.FClass)
	}
	want := []string{"A=garage", "B=garage", "C=terrace", "D=residential", "E=agricultural", "F=barn"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("added = %v, want %v", got, want)
	}
}
