package pypsapass

import (
	_ "embed"
	"encoding/json"
)

//go:embed catalog.json
var catalogJSON []byte

// unmarshalCatalog fills cfg from the embedded catalog.json. It is a separate,
// overridable indirection so tests can drive build() with a synthetic Config
// while production always loads the embedded, versionable catalogue.
var unmarshalCatalog = func(c *Config) error {
	return json.Unmarshal(catalogJSON, c)
}
