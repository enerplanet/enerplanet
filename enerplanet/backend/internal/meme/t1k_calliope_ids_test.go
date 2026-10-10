package meme

import (
	"encoding/json"
	"regexp"
	"testing"

	"github.com/stretchr/testify/require"
)

// calliopeKey is the id pattern MEME's Calliope target enforces on every
// generated key (definition.{nodes,techs,data_tables}): no leading digit or
// underscore, and no characters outside \w (so no hyphens). PyPSA tolerates
// richer ids, but MEME fails the WHOLE multi-target pypsa,calliope job if
// Calliope rejects it, so the emitted job must stay inside this pattern.
var calliopeKey = regexp.MustCompile(`^[^_^0-9][0-9A-Za-z_]*$`)

// TestTranslatePayload_calliopeLegalIDs guards the invariant that broke the
// first live run: the mapping used to mint `1`, `demand-1`, `grid-trafo_82`,
// which Calliope rejects (nodes/techs are its model keys). Node ids are now
// prefixed (`n1`) and tech/trade ids use `_`, and every reference must follow.
func TestTranslatePayload_calliopeLegalIDs(t *testing.T) {
	got, err := TranslatePayload(elOnlyPayload())
	require.NoError(t, err)

	var job map[string]interface{}
	require.NoError(t, json.Unmarshal(got.Job, &job))
	model, _ := job["model"].(map[string]interface{})
	require.NotNil(t, model)

	nodes, _ := model["nodes"].(map[string]interface{})
	require.NotEmpty(t, nodes, "job has nodes")

	// Every top-level key family Calliope validates.
	for _, family := range []string{"nodes", "technologies", "trade", "transmission"} {
		m, _ := model[family].(map[string]interface{})
		for key := range m {
			require.Regexp(t, calliopeKey, key, "%s key %q must be Calliope-legal", family, key)
		}
	}

	// Nodes own a `techs` object whose keys are calliope-validated too.
	for node, raw := range nodes {
		n, _ := raw.(map[string]interface{})
		techs, _ := n["techs"].(map[string]interface{})
		for key := range techs {
			require.Regexp(t, calliopeKey, key, "nodes.%s.techs key %q must be Calliope-legal", node, key)
		}
	}

	// References must resolve: a transmission arc's endpoints, and every tech's
	// node, have to name an existing node key.
	transmissions, _ := model["transmission"].(map[string]interface{})
	for name, raw := range transmissions {
		tr, _ := raw.(map[string]interface{})
		for _, side := range []string{"from", "to"} {
			id, _ := tr[side].(string)
			require.Contains(t, nodes, id, "transmission %s %s=%q must reference an existing node", name, side, id)
		}
	}
	techs, _ := model["technologies"].(map[string]interface{})
	for name, raw := range techs {
		tech, _ := raw.(map[string]interface{})
		id, _ := tech["node"].(string)
		require.Contains(t, nodes, id, "technology %s node=%q must reference an existing node", name, id)
	}
}
