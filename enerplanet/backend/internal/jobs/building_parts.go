package jobs

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"gorm.io/datatypes"

	"spatialhub_backend/internal/buem"
	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/models"
	"spatialhub_backend/internal/store/series"
)

// One OSM way can cover several 3D buildings, a terraced row mapped as one
// outline. Each of them runs through BuEM with its own envelope and TABULA
// U-values, under partID, and the results are summed into one result for the
// way. A way gets a result only when every one of its buildings has one:
// a partial sum would undercount it silently, while a failed way falls back
// to its yearly demand for its whole outline.

// partSeparator joins a way's id and a 3D building's object id into the BuEM
// id of one of several buildings of the way.
const partSeparator = "#"

// partID is the BuEM id of the 3D building objectID of way.
func partID(way, objectID string) string {
	return way + partSeparator + objectID
}

// partIDs maps every way covering several 3D buildings to their BuEM ids,
// largest first, the order city2tabula.BuildingsResult.ByRequestedWay keeps.
func partIDs(envelopes map[string][]city2tabula.Building) map[string][]string {
	parts := map[string][]string{}
	for way, buildings := range envelopes {
		if len(buildings) < 2 {
			continue
		}
		for _, b := range buildings {
			parts[way] = append(parts[way], partID(way, b.ObjectID))
		}
	}
	return parts
}

// buildingPart is one BuEM building of a way: its id, the properties it is
// built from and its 3D building (nil when City2TABULA has none).
type buildingPart struct {
	id       string
	props    map[string]interface{}
	envelope *city2tabula.Building
}

// buildingParts lists the BuEM buildings of one way. A way with one 3D
// building, or none, keeps the way's id, so its stored results stay valid. A
// customised block (properties.buem) was edited on the building the
// configurator shows, the largest one, so it replaces only that building's
// run; the way's other settings apply to all of them.
func buildingParts(way string, props map[string]interface{}, envelopes []city2tabula.Building) []buildingPart {
	switch len(envelopes) {
	case 0:
		return []buildingPart{{id: way, props: props}}
	case 1:
		return []buildingPart{{id: way, props: props, envelope: &envelopes[0]}}
	}
	parts := make([]buildingPart, len(envelopes))
	for i := range envelopes {
		p := props
		if i > 0 {
			p = withoutStoredBlock(props)
		}
		parts[i] = buildingPart{id: partID(way, envelopes[i].ObjectID), props: p, envelope: &envelopes[i]}
	}
	return parts
}

// withoutStoredBlock returns props without the customised BuEM block, leaving
// props itself unchanged.
func withoutStoredBlock(props map[string]interface{}) map[string]interface{} {
	if _, ok := props["buem"]; !ok {
		return props
	}
	out := make(map[string]interface{}, len(props))
	for k, v := range props {
		if k != "buem" {
			out[k] = v
		}
	}
	return out
}

// foldPartFailures applies all-or-nothing before BuEM runs: a way any of whose
// 3D buildings could not be prepared is unresolved as a whole, with every
// reason, and none of its buildings is sent. It returns buildings without
// them and drops such ways from parts.
func foldPartFailures(parts map[string][]string, buildings []buem.Building, resolved map[string]BuemResolutionMeta, unresolved map[string]string) []buem.Building {
	drop := map[string]bool{}
	for way, ids := range parts {
		var reasons []string
		for _, id := range ids {
			if r, ok := unresolved[id]; ok {
				reasons = append(reasons, partReason(id, r))
			}
		}
		if len(reasons) == 0 {
			continue
		}
		for _, id := range ids {
			drop[id] = true
			delete(unresolved, id)
			delete(resolved, id)
		}
		unresolved[way] = wayReason(len(ids), reasons)
		delete(parts, way)
	}
	return slices.DeleteFunc(buildings, func(b buem.Building) bool { return drop[b.ID] })
}

// partReason names the 3D building of a part id in a way's failure reason,
// dropping the "building <id>: " prefix BuEM's own errors carry.
func partReason(id, reason string) string {
	_, objectID, _ := strings.Cut(id, partSeparator)
	reason = strings.TrimPrefix(reason, "building "+id+": ")
	return fmt.Sprintf("3D building %s: %s", objectID, reason)
}

func wayReason(buildings int, reasons []string) string {
	slices.Sort(reasons)
	return fmt.Sprintf("%d of the %d 3D buildings this OSM way covers have no result (%s)", len(reasons), buildings, strings.Join(reasons, "; "))
}

// combineParts turns the stored results of each way's 3D buildings into one
// profile for the way (see sumProfiles), and the way's metadata into that of
// its largest building. A way with a failed building fails as a whole.
// Afterwards out and resolved carry ways, not their buildings.
func combineParts(store seriesStore, parts map[string][]string, resolved map[string]BuemResolutionMeta, out *seriesOutcome) error {
	for way, ids := range parts {
		profileIDs, reasons := make([]int64, 0, len(ids)), []string(nil)
		for _, id := range ids {
			if r, ok := out.failed[id]; ok {
				reasons = append(reasons, partReason(id, r))
			} else if p, ok := out.profiles[id]; ok {
				profileIDs = append(profileIDs, p)
			} else {
				reasons = append(reasons, partReason(id, "BuEM returned no result"))
			}
		}
		meta := resolved[ids[0]]
		for _, id := range ids {
			meta.Customised = meta.Customised || resolved[id].Customised
			delete(out.failed, id)
			delete(out.profiles, id)
			delete(resolved, id)
		}
		if len(reasons) > 0 {
			out.failed[way] = wayReason(len(ids), reasons)
			continue
		}
		id, err := sumProfiles(store, profileIDs, out.stored)
		if err != nil {
			out.failed[way] = fmt.Sprintf("summing its %d 3D buildings failed: %v", len(ids), err)
			continue
		}
		out.profiles[way] = id
		resolved[way] = meta
	}
	return loadStoredProfiles(store, out)
}

// sumProfiles stores the step-by-step sum of the profiles ids, with the
// summary combined across them (buem.CombineSummary) and every other field
// taken from the first, largest building. The sum is keyed by its parts'
// profiles, so the same buildings are summed once.
func sumProfiles(store seriesStore, ids []int64, stored map[int64]series.StoredProfile) (int64, error) {
	key := sumKey(ids)
	existing, err := store.StoredKeys([]string{key})
	if err != nil {
		return 0, err
	}
	if id, ok := existing[key]; ok {
		return id, nil
	}
	head := stored[ids[0]]
	parts := make([]map[string][]float64, len(ids))
	units := map[string]string{}
	for i, id := range ids {
		p := stored[id]
		if !p.StartTime.Equal(head.StartTime) || p.ResolutionMinutes != head.ResolutionMinutes {
			return 0, fmt.Errorf("profile %d starts %s every %d min, profile %d %s every %d min", id, p.StartTime, p.ResolutionMinutes, ids[0], head.StartTime, head.ResolutionMinutes)
		}
		parts[i] = map[string][]float64{}
		for _, name := range p.SeriesNames {
			v, err := store.Values(id, name)
			if err != nil {
				return 0, err
			}
			if u, seen := units[name]; seen && u != v.Unit {
				return 0, fmt.Errorf("series %s is in %s in profile %d and in %s elsewhere", name, v.Unit, id, u)
			}
			units[name] = v.Unit
			parts[i][name] = float64s(v.Vals)
		}
	}
	sum, err := buem.SumSeries(parts)
	if err != nil {
		return 0, err
	}
	blocks := make([]json.RawMessage, len(ids))
	for i, id := range ids {
		blocks[i] = json.RawMessage(stored[id].Summary)
	}
	summary, err := buem.CombineSummary(blocks, sum, head.ResolutionMinutes)
	if err != nil {
		return 0, err
	}
	data := make(map[string]series.SeriesData, len(sum))
	for name, values := range sum {
		data[name] = series.SeriesData{Unit: units[name], Values: float32s(values)}
	}
	producer := ""
	if head.ProducerVersion != nil {
		producer = *head.ProducerVersion
	}
	return store.Save(series.NewProfile{
		Key:               key,
		Origin:            models.SeriesOriginBuem,
		ProducerVersion:   producer,
		StartTime:         head.StartTime,
		ResolutionMinutes: head.ResolutionMinutes,
		Summary:           datatypes.JSON(summary),
		Series:            data,
	})
}

// sumKey keys the sum of the profiles ids. It is a 64-character hash to fit
// models.SeriesProfile.Key; hashing a "buem-sum:" prefix with the ids keeps it
// apart from BuEM request keys, which hash the request.
func sumKey(ids []int64) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = strconv.FormatInt(id, 10)
	}
	h := sha256.Sum256([]byte("buem-sum:" + strings.Join(parts, ",")))
	return hex.EncodeToString(h[:])
}

// combinePartResults sums the raw BuEM results of each way's 3D buildings into
// one result under the way's id, for the run_buem path that merges results
// into the topology. A way missing a result, or with a failed one, gets an
// error result naming them.
func combinePartResults(results []buem.BuildingResult, parts map[string][]string) []buem.BuildingResult {
	byID := make(map[string]buem.BuildingResult, len(results))
	for _, r := range results {
		byID[r.ID] = r
	}
	out := make([]buem.BuildingResult, 0, len(results))
	inPart := map[string]bool{}
	for way, ids := range parts {
		partResults, reasons := make([]buem.BuildingResult, 0, len(ids)), []string(nil)
		for _, id := range ids {
			inPart[id] = true
			r, ok := byID[id]
			switch {
			case !ok:
				reasons = append(reasons, partReason(id, "BuEM returned no result"))
			case r.Error != "" || len(r.BUEM) == 0:
				reasons = append(reasons, partReason(id, r.Error))
			default:
				partResults = append(partResults, r)
			}
		}
		if len(reasons) > 0 {
			out = append(out, buem.BuildingResult{ID: way, Error: wayReason(len(ids), reasons)})
			continue
		}
		combined, err := buem.CombineResults(way, partResults)
		if err != nil {
			combined = buem.BuildingResult{ID: way, Error: fmt.Sprintf("summing its %d 3D buildings failed: %v", len(ids), err)}
		}
		out = append(out, combined)
	}
	for _, r := range results {
		if !inPart[r.ID] {
			out = append(out, r)
		}
	}
	return out
}

func float64s(values []float32) []float64 {
	out := make([]float64, len(values))
	for i, v := range values {
		out[i] = float64(v)
	}
	return out
}

func float32s(values []float64) []float32 {
	out := make([]float32, len(values))
	for i, v := range values {
		out[i] = float32(v)
	}
	return out
}
