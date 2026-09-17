package jobs

import (
	"encoding/json"

	"spatialhub_backend/internal/city2tabula"
)

// clientEnvelopeProp is where the building configurator writes an envelope a
// user has edited, on the building's own topology node, in the same element
// shape City2TABULA produces. It is absent for every building nobody has
// edited.
const clientEnvelopeProp = "buem_envelope"

// clientEnvelopeElements reads that envelope. It reports false for anything
// unusable rather than returning a partial list, because half an envelope is
// worse than the resolved one it would replace.
func clientEnvelopeElements(props map[string]interface{}) ([]city2tabula.EnvelopeElement, bool) {
	raw, ok := props[clientEnvelopeProp]
	if !ok {
		return nil, false
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return nil, false
	}
	var elements []city2tabula.EnvelopeElement
	if err := json.Unmarshal(encoded, &elements); err != nil || len(elements) == 0 {
		return nil, false
	}
	return elements, true
}
