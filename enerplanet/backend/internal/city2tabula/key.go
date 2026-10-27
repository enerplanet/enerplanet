package city2tabula

import "strings"

// objectKeyPrefix marks a building key that is a City2TABULA object id: a
// custom-grid building made from its 3D footprint, which has no OSM way of its
// own. It travels in the osm_id slot, so every string-keyed path carries it.
const objectKeyPrefix = "c2t:"

// ObjectKey is the building key for a 3D building with the given object id.
func ObjectKey(objectID string) string { return objectKeyPrefix + objectID }

// ObjectIDOfKey returns the object id a building key names, and false when
// the key is an OSM way.
func ObjectIDOfKey(key string) (string, bool) {
	return strings.CutPrefix(key, objectKeyPrefix)
}
