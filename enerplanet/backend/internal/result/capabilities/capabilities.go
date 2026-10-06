// Package capabilities declares what a result source is able to provide, so a
// consumer renders only the parts of a result that actually exist.
//
// Provenance is persisted per model (models.result_source) and written by
// whichever ingest path produced the parsed results. The capability set is
// derived from the source here, so the mapping has exactly one definition and a
// new, more capable source needs no change in any consumer.
//
package capabilities

// Source identifies the pipeline that produced a model's parsed results.
type Source string

const (
	// SourceLegacy is the retired webservice power-flow path: the full
	// electrical result (bus voltage, reactive power, per-line loading,
	// transformers, a convergence verdict).
	SourceLegacy Source = "legacy"

	// SourceMeme is MEME via Coati: dispatch and capacity results on a
	// transport graph. Wires carry an active flow and a capacity, so consumers
	// get utilisation; no voltage, reactive power, transformer or convergence
	// data exists in this result.
	SourceMeme Source = "meme"

	// SourceFullGridPF is a future pf-capable source (reclaimed upstream in
	// MEME, or a dedicated target). Coverage matches SourceLegacy.
	SourceFullGridPF Source = "full-grid-pf"
)

// Capabilities is the set of data a result contains.
//
// A false value means "this result does not contain that data" — a consumer
// must hide the corresponding component, not render an empty state, because an
// empty state reads as a clean bill of health for a check that never ran.
type Capabilities struct {
	// Convergence reports that a power-flow convergence verdict is present.
	Convergence bool `json:"convergence"`
	// Voltage reports that per-bus voltage series are present.
	Voltage bool `json:"voltage"`
	// Power reports that per-bus active/reactive power series are present.
	Power bool `json:"power"`
	// Transformers reports that transformer flow/loading series are present.
	Transformers bool `json:"transformers"`
	// LineLoading reports that per-wire flow and rating rows are present.
	LineLoading bool `json:"lineLoading"`
	// UtilizationOnly reports that LineLoading rows are flow/capacity
	// utilisation rather than electrical loading. Consumers relabel in this
	// case — the data is real, only its meaning differs.
	UtilizationOnly bool `json:"utilizationOnly"`
	// Curtailment reports that renewable curtailment can be derived.
	Curtailment bool `json:"curtailment"`
	// Losses reports that transmission losses can be derived.
	Losses bool `json:"losses"`
}

// For returns the capability set of a source.
//
// An unrecognised or empty source claims nothing. We never assume data exists:
// the backfill migration (migrations/047) is what guarantees already-parsed
// models carry a source, so an empty one means "nothing parsed yet".
func For(s Source) Capabilities {
	switch s {
	case SourceLegacy, SourceFullGridPF:
		return Capabilities{
			Convergence:  true,
			Voltage:      true,
			Power:        true,
			Transformers: true,
			LineLoading:  true,
			Curtailment:  true,
			Losses:       true,
		}
	case SourceMeme:
		return Capabilities{
			LineLoading:     true,
			UtilizationOnly: true,
			// A Coati/MEME bundle carries no PyPSA curtailment file and its
			// transport arcs have no impedance, so neither a curtailment nor a
			// loss series can be derived. Claiming them made the Grid render a
			// meaningless "0.00 kW" per line.
			Curtailment: false,
			Losses:      false,
		}
	default:
		return Capabilities{}
	}
}
