// Package meme translates an EnerPlanET model into a MEME job (the canonical
// multi-framework model, see enerplanet/meme schemas/revised_unified_schema.json)
// and aggregates per-building BuEM series into the node-level series that
// job carries inline.
package meme

// The types below mirror the subset of MEME's Job that this backend emits.
// MEME rejects unknown fields, so only fields MEME defines appear here, with
// its JSON names.

// Job is the body of POST /simulate: api_key at top level, the model and the
// experiment.
type Job struct {
	APIKey     string     `json:"api_key,omitempty"`
	Model      Model      `json:"model"`
	Experiment Experiment `json:"experiment"`
}

// Model is the canonical energy system model.
type Model struct {
	Metadata     Metadata              `json:"metadata"`
	Time         TimeConfig            `json:"time"`
	Carriers     map[string]Carrier    `json:"carriers"`
	Nodes        map[string]Node       `json:"nodes"`
	Timeseries   map[string]TimeSeries `json:"timeseries,omitempty"`
	Technologies map[string]Technology `json:"technologies"`
	Trade        map[string]Trade      `json:"trade,omitempty"`
}

// Metadata names the model.
type Metadata struct {
	Name        string `json:"name"`
	Version     string `json:"version,omitempty"`
	Description string `json:"description,omitempty"`
}

// TimeConfig is the timestep index: ISO 8601 start and end, pandas frequency
// resolution ("1H", "15min").
type TimeConfig struct {
	Start      string `json:"start"`
	End        string `json:"end"`
	Resolution string `json:"resolution,omitempty"`
}

// Carrier is an energy vector.
type Carrier struct {
	Name string `json:"name,omitempty"`
	Unit string `json:"unit,omitempty"`
}

// Node is a spatial point technologies live at.
type Node struct {
	Name   string  `json:"name,omitempty"`
	Coords *Coords `json:"coords,omitempty"`
}

// Coords is a WGS84 position.
type Coords struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

// TimeSeries is an inline per-timestep vector.
type TimeSeries struct {
	Source string    `json:"source"`
	Values []float64 `json:"values,omitempty"`
	Unit   string    `json:"unit,omitempty"`
}

// Technology is a node-local demand, supply, conversion or storage.
type Technology struct {
	Role          string    `json:"role"`
	Node          []string  `json:"node"`
	CarrierIn     []string  `json:"carrier_in,omitempty"`
	CarrierOut    []string  `json:"carrier_out,omitempty"`
	Flows         []Flow    `json:"flows,omitempty"`
	Capacity      *Capacity `json:"capacity,omitempty"`
	DemandProfile string    `json:"demand_profile,omitempty"`
}

// Flow is one port of a multi-carrier conversion; Ratio is per unit of the
// reference input flow.
type Flow struct {
	Carrier   string  `json:"carrier"`
	Direction string  `json:"direction"`
	Ratio     float64 `json:"ratio"`
	Reference bool    `json:"reference,omitempty"`
}

// Capacity bounds a technology; Existing is installed capacity in MW and
// Expandable false fixes it (required by PyPSA's operate mode).
type Capacity struct {
	Existing   float64 `json:"existing"`
	Expandable bool    `json:"expandable"`
	Unit       string  `json:"unit,omitempty"`
}

// Trade is a node's market exchange for one carrier.
type Trade struct {
	Node    string     `json:"node"`
	Carrier string     `json:"carrier"`
	Import  *TradeSide `json:"import,omitempty"`
}

// TradeSide bounds one direction of exchange; Limit is a MW cap.
type TradeSide struct {
	Limit *float64 `json:"limit,omitempty"`
}

// Experiment selects how MEME runs the model.
type Experiment struct {
	Mode      string          `json:"mode,omitempty"`
	Objective string          `json:"objective,omitempty"`
	Operate   *OperateOptions `json:"operate,omitempty"`
	Solver    Solver          `json:"solver"`
}

// OperateOptions configures receding-horizon dispatch; pandas frequency
// strings.
type OperateOptions struct {
	Window  string `json:"window,omitempty"`
	Horizon string `json:"horizon,omitempty"`
}

// Solver names the optimisation solver.
type Solver struct {
	Name string `json:"name"`
}
