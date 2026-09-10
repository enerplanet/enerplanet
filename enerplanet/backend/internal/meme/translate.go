package meme

import (
	"fmt"
	"sort"
	"time"
)

// Carrier ids used in the emitted job.
const (
	CarrierElectricity = "electricity"
	CarrierHeat        = "heat"
)

// UnassignedNode is the synthetic node buildings without a transformer area
// are placed on, with its own unlimited electricity import, so their demand
// is never dropped from the model. A calculation that must insist on a grid
// is a validation in front of the translator, not a different job shape.
const UnassignedNode = "unassigned"

// Fixed dispatch settings. The heat pump per node is sized so its output
// covers that node's peak heat demand exactly; MEME's operate mode forbids
// capacity expansion, so an undersized pump would make the dispatch
// infeasible rather than expensive.
const (
	heatPumpCOP   = 3.0
	solverName    = "highs"
	operateWindow = "24h"
)

// BuildingSeries is one building's BuEM load series, kW average per step,
// as buem-gateway returns them with the hourly series kept.
type BuildingSeries struct {
	OSMID       string
	Node        string // "" when the building has no transformer area
	Heating     []float64
	HotWater    []float64
	Electricity []float64
	Kitchen     []float64
	// KitchenElectric reports whether the kitchen series is electric energy
	// (cooking_carrier electric) rather than gas, which is not an electric
	// load.
	KitchenElectric bool
}

// NodeSeries is one node's summed demand for one carrier, MW average per
// step: what the job carries inline and what is stored per model.
type NodeSeries struct {
	Node    string
	Carrier string
	Values  []float64
}

// NodeInput describes one node of the model to emit.
type NodeInput struct {
	ID       string
	Name     string
	Lat, Lon float64
	// ImportLimitMW caps the node's electricity import (transformer rating);
	// nil means unlimited.
	ImportLimitMW *float64
}

// Input is everything the translator needs; it does no I/O.
type Input struct {
	Name        string
	Start, End  time.Time
	StepMinutes int
	Nodes       []NodeInput
	Series      []NodeSeries
}

// Result is the emitted job plus what the caller should record about it.
type Result struct {
	Job      Job
	Warnings []string
}

// Aggregate sums per-building series into one series per node per carrier,
// converting kW to MW: electricity is the electricity load plus the kitchen
// load when that is electric; heat is space heating plus hot water. A
// building without a node lands on UnassignedNode. Series of different
// lengths are summed over their common prefix, the shortest length winning,
// so a truncated building never invents demand for the others.
func Aggregate(buildings []BuildingSeries) (series []NodeSeries, unassigned int) {
	type key struct{ node, carrier string }
	sums := map[key][]float64{}
	add := func(k key, vals ...[]float64) {
		for _, v := range vals {
			if len(v) == 0 {
				continue
			}
			cur := sums[k]
			if cur == nil {
				cur = make([]float64, len(v))
				copy(cur, v)
			} else {
				if len(v) < len(cur) {
					cur = cur[:len(v)]
				}
				for i := range cur {
					cur[i] += v[i]
				}
			}
			sums[k] = cur
		}
	}
	for _, b := range buildings {
		node := b.Node
		if node == "" {
			node = UnassignedNode
			unassigned++
		}
		add(key{node, CarrierHeat}, b.Heating, b.HotWater)
		elec := [][]float64{b.Electricity}
		if b.KitchenElectric {
			elec = append(elec, b.Kitchen)
		}
		add(key{node, CarrierElectricity}, elec...)
	}
	for k, v := range sums {
		for i := range v {
			v[i] /= 1000 // kW -> MW
		}
		series = append(series, NodeSeries{Node: k.node, Carrier: k.carrier, Values: v})
	}
	sort.Slice(series, func(i, j int) bool {
		if series[i].Node != series[j].Node {
			return series[i].Node < series[j].Node
		}
		return series[i].Carrier < series[j].Carrier
	})
	return series, unassigned
}

// Translate emits the MEME job for in: one node per transformer area (plus
// UnassignedNode when a series names it), one demand technology per node per
// carrier reading an inline series, a heat pump per node with heat demand
// converting electricity to heat at fixed capacity, and an electricity import
// per node. Series are sliced to the time window and short ones padded with
// their last value, because MEME sizes the calendar from the longest series
// and never truncates.
func Translate(in Input) (Result, error) {
	if in.StepMinutes <= 0 {
		return Result{}, fmt.Errorf("meme: step must be positive, got %d minutes", in.StepMinutes)
	}
	if !in.End.After(in.Start) {
		return Result{}, fmt.Errorf("meme: end %s is not after start %s", in.End.Format(time.RFC3339), in.Start.Format(time.RFC3339))
	}
	steps := int(in.End.Sub(in.Start)/(time.Duration(in.StepMinutes)*time.Minute)) + 1

	nodes := map[string]Node{}
	limits := map[string]*float64{}
	for _, n := range in.Nodes {
		nodes[n.ID] = Node{Name: n.Name, Coords: &Coords{Lat: n.Lat, Lon: n.Lon}}
		limits[n.ID] = n.ImportLimitMW
	}

	var res Result
	m := Model{
		Metadata: Metadata{Name: in.Name},
		Time: TimeConfig{
			Start:      in.Start.UTC().Format(time.RFC3339),
			End:        in.End.UTC().Format(time.RFC3339),
			Resolution: resolution(in.StepMinutes),
		},
		Carriers: map[string]Carrier{
			CarrierElectricity: {Name: "Electricity", Unit: "MW"},
			CarrierHeat:        {Name: "Heat", Unit: "MW"},
		},
		Nodes:        nodes,
		Timeseries:   map[string]TimeSeries{},
		Technologies: map[string]Technology{},
		Trade:        map[string]Trade{},
	}

	heatNodes := map[string]float64{} // node -> peak heat MW
	for _, s := range in.Series {
		if _, ok := m.Nodes[s.Node]; !ok {
			if s.Node != UnassignedNode {
				return Result{}, fmt.Errorf("meme: series for unknown node %q (carrier %s)", s.Node, s.Carrier)
			}
			m.Nodes[UnassignedNode] = Node{Name: "Buildings without a transformer area"}
		}
		if s.Carrier != CarrierElectricity && s.Carrier != CarrierHeat {
			return Result{}, fmt.Errorf("meme: unsupported carrier %q on node %s", s.Carrier, s.Node)
		}
		vals, padded := fitToWindow(s.Values, steps)
		if padded > 0 {
			res.Warnings = append(res.Warnings, fmt.Sprintf("node %s %s: series has %d steps, window has %d; padded with the last value", s.Node, s.Carrier, len(s.Values), steps))
		}
		id := s.Node + "_" + s.Carrier
		m.Timeseries[id] = TimeSeries{Source: "inline", Values: vals, Unit: "MW"}
		m.Technologies["demand_"+id] = Technology{
			Role: "demand", Node: []string{s.Node}, CarrierIn: []string{s.Carrier}, DemandProfile: id,
		}
		if s.Carrier == CarrierHeat {
			heatNodes[s.Node] = maxOf(vals)
		}
	}

	for id := range m.Nodes {
		m.Trade["import_electricity_"+id] = Trade{
			Node: id, Carrier: CarrierElectricity, Import: &TradeSide{Limit: limits[id]},
		}
		if peak, ok := heatNodes[id]; ok {
			m.Technologies["heat_pump_"+id] = Technology{
				Role: "conversion", Node: []string{id},
				CarrierIn: []string{CarrierElectricity}, CarrierOut: []string{CarrierHeat},
				Flows: []Flow{
					{Carrier: CarrierElectricity, Direction: "in", Ratio: 1, Reference: true},
					{Carrier: CarrierHeat, Direction: "out", Ratio: heatPumpCOP},
				},
				Capacity: &Capacity{Existing: peak / heatPumpCOP, Expandable: false, Unit: "MW"},
			}
		}
	}

	res.Job = Job{
		Model: m,
		Experiment: Experiment{
			Mode: "operate", Objective: "min_cost",
			Operate: &OperateOptions{Window: operateWindow, Horizon: operateWindow},
			Solver:  Solver{Name: solverName},
		},
	}
	return res, nil
}

// fitToWindow returns exactly steps values: the series cut to the window, or
// extended with its last value. padded is how many values were added.
func fitToWindow(values []float64, steps int) (out []float64, padded int) {
	if len(values) >= steps {
		return append([]float64(nil), values[:steps]...), 0
	}
	out = make([]float64, steps)
	copy(out, values)
	last := 0.0
	if len(values) > 0 {
		last = values[len(values)-1]
	}
	for i := len(values); i < steps; i++ {
		out[i] = last
	}
	return out, steps - len(values)
}

func maxOf(v []float64) float64 {
	m := 0.0
	for _, x := range v {
		if x > m {
			m = x
		}
	}
	return m
}

// resolution renders a step length as the pandas frequency string MEME
// expects.
func resolution(minutes int) string {
	if minutes%60 == 0 {
		return fmt.Sprintf("%dH", minutes/60)
	}
	return fmt.Sprintf("%dmin", minutes)
}
