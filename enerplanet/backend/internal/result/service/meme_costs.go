package resultservice

import (
	"os"
	"path/filepath"
	"sort"
)

type costKey struct{ node, tech, costs string }

// calliopeCosts sums each node and technology's cost from the Calliope leg's
// cost parts: annualised investment, fixed and variable operation. These add up
// to Calliope's cost in plan mode. In operate mode Calliope's cost table repeats
// each rolling horizon's total on every kept timestep; the parts do not.
// ok is false when the export has no variable-cost table.
func calliopeCosts(csvDir string) (costs []CostRecord, investment []CostInvestmentRecord, ok bool, err error) {
	if _, statErr := os.Stat(filepath.Join(csvDir, "results_cost_operation_variable.csv")); statErr != nil {
		return nil, nil, false, nil
	}
	total := map[costKey]float64{}
	invested := map[costKey]float64{}
	sum := func(valueCol string, into ...map[costKey]float64) func(map[string]int, []string) error {
		return func(cols map[string]int, row []string) error {
			v, ok := memeFloat(row, cols, valueCol)
			if !ok {
				return nil
			}
			k := costKey{memeString(row, cols, "nodes"), memeString(row, cols, "techs"), memeString(row, cols, "costs")}
			for _, m := range into {
				m[k] += v
			}
			return nil
		}
	}
	parts := []struct {
		file, col string
		into      []map[costKey]float64
	}{
		{"results_cost_operation_variable.csv", "cost_operation_variable", []map[costKey]float64{total}},
		{"results_cost_operation_fixed.csv", "cost_operation_fixed", []map[costKey]float64{total}},
		{"results_cost_investment_annualised.csv", "cost_investment_annualised", []map[costKey]float64{total, invested}},
	}
	for _, p := range parts {
		if err := readMemeCSV(csvDir, p.file, sum(p.col, p.into...)); err != nil {
			return nil, nil, false, err
		}
	}
	for _, k := range sortedCostKeys(total) {
		costs = append(costs, CostRecord{FromLocation: k.node, Costs: k.costs, Techs: k.tech, Value: total[k]})
	}
	for _, k := range sortedCostKeys(invested) {
		investment = append(investment, CostInvestmentRecord{Location: k.node, Costs: k.costs, Tech: k.tech, Value: invested[k]})
	}
	return costs, investment, true, nil
}

func sortedCostKeys(m map[costKey]float64) []costKey {
	keys := make([]costKey, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		a, b := keys[i], keys[j]
		if a.node != b.node {
			return a.node < b.node
		}
		if a.tech != b.tech {
			return a.tech < b.tech
		}
		return a.costs < b.costs
	})
	return keys
}
