package jobs

import (
	"encoding/json"
	"fmt"

	"gorm.io/datatypes"
	"gorm.io/gorm"

	commonModels "platform.local/common/pkg/models"

	"platform.local/platform/logger"
)

// demandFallbackWarning is stored in results when some buildings have no BuEM series.
type demandFallbackWarning struct {
	Code     string `json:"code"`
	Fallback int    `json:"fallback"`
	Total    int    `json:"total"`
}

const demandFallbackCode = "demand_fallback"

// demandCoverage counts the payload's buildings and those with a BuEM
// electricity series, leaving out the covered ways (see dropFurtherWayDemand),
// whose demand another way's series already carries.
func demandCoverage(topology []interface{}, covered map[string]bool) (withSeries, total int) {
	for _, feature := range payloadBuildings(topology) {
		props, _ := feature["properties"].(map[string]interface{})
		if covered[fmt.Sprint(props["osm_id"])] {
			continue
		}
		total++
		series, _ := props["demand_series"].(map[string]interface{})
		if _, ok := series["electricity"]; ok {
			withSeries++
		}
	}
	return withSeries, total
}

// checkDemandCoverage fails when no building has a series and warns when some lack one.
func checkDemandCoverage(topology []interface{}, covered map[string]bool) (*demandFallbackWarning, error) {
	with, total := demandCoverage(topology, covered)
	if total > 0 && with == 0 {
		return nil, fmt.Errorf("none of the model's %d buildings has an hourly demand profile: no 3D data was found for them, so BuEM could not run", total)
	}
	if with == total {
		return nil, nil
	}
	return &demandFallbackWarning{Code: demandFallbackCode, Fallback: total - with, Total: total}, nil
}

// setModelWarning stores w in results, or clears them so an old warning does not outlive its run.
func setModelWarning(db *gorm.DB, modelID uint, w *demandFallbackWarning) {
	results := datatypes.JSON("null")
	if w != nil {
		data, err := json.Marshal(map[string]any{"warning": w})
		if err != nil {
			logger.ForComponent("job:meme_status").Errorf("model %d: encode warning %+v: %v", modelID, *w, err)
			return
		}
		results = datatypes.JSON(data)
	}
	err := db.Model(&commonModels.Model{}).Where("id = ?", modelID).Update("results", results).Error
	if err != nil {
		logger.ForComponent("job:meme_status").Errorf("model %d: failed to store run warning: %v", modelID, err)
	}
}
