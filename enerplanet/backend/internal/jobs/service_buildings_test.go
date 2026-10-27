package jobs

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Every row of the OSM class -> BuEM service id table.
func TestServiceBuildingType_everyMappedClass(t *testing.T) {
	cases := map[string]string{
		"bakery":      "bakery",
		"supermarket": "supermarket", "shop": "supermarket", "retail": "supermarket", "commercial": "supermarket",
		"office": "office",
		"school": "school", "kindergarten": "school", "university": "school",
		"hotel":  "hotel",
		"clinic": "clinic", "hospital": "clinic",
		"restaurant": "restaurant", "cafe": "restaurant",
		"warehouse": "warehouse", "industrial": "warehouse", "workshop": "warehouse",
	}
	for fClass, want := range cases {
		assert.Equal(t, want, serviceBuildingType(fClass), fClass)
	}
	assert.Equal(t, "supermarket", serviceBuildingType(" Shop "), "normalised like the demand estimate")
}

func TestServiceBuildingType_unmappedClasses(t *testing.T) {
	for _, fClass := range []string{"apartments", "detached", "church", "yes", "", "garage"} {
		assert.Equal(t, "", serviceBuildingType(fClass), fClass)
	}
}

func TestBuildingCapacity(t *testing.T) {
	if got := buildingCapacity(map[string]interface{}{"capacity": float64(40)}); got == nil || *got != 40 {
		t.Errorf("float64 40: got %v", got)
	}
	if got := buildingCapacity(map[string]interface{}{"capacity": 12}); got == nil || *got != 12 {
		t.Errorf("int 12: got %v", got)
	}
	for name, props := range map[string]map[string]interface{}{
		"absent": {}, "nil": {"capacity": nil}, "zero": {"capacity": float64(0)},
		"negative": {"capacity": float64(-3)}, "fraction": {"capacity": 2.5}, "string": {"capacity": "40"},
	} {
		assert.Nil(t, buildingCapacity(props), name)
	}
}
