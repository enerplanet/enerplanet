package model

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	"platform.local/common/pkg/models"
	"platform.local/platform/logger"

	"spatialhub_backend/internal/api/contracts"
	"spatialhub_backend/internal/seriessummary"
	seriesstore "spatialhub_backend/internal/store/series"
)

const errNoSeriesForBuilding = "no stored series for this building in this model"

// GetBuildingDemandProfile godoc
//
//	@Summary		Get one building's demand profile summary
//	@Description	Returns, for each series linked to the building, its total, peak and daily, weekly
//	@Description	and monthly energy. Full series are not returned; use the week endpoint or the CSV
//	@Description	download. 404 when the building has no stored series in this model yet.
//	@Tags			EnerPlanET
//	@Produce		json
//	@Param			id				path		int		true	"Model ID"
//	@Param			building_ref	path		string	true	"Building OSM id, or c2t:<object_id>"
//	@Success		200	{object}	contracts.BuildingDemandProfileResponse
//	@Failure		403	{object}	contracts.ErrorResponse
//	@Failure		404	{object}	contracts.ErrorResponse
//	@Failure		500	{object}	contracts.ErrorResponse
//	@Security		SessionAuth
//	@Router			/models/{id}/buildings/{building_ref}/demand-profile [get]
func (h *ModelHandler) GetBuildingDemandProfile(c *gin.Context) {
	model, ok := h.readableModel(c)
	if !ok {
		return
	}
	linked, ok := h.buildingSeries(c, model, c.Param("building_ref"))
	if !ok {
		return
	}
	summaries, err := summariseLinked(linked)
	if err != nil {
		httputil.InternalError(c, fmt.Sprintf("failed to summarise series: %v", err))
		return
	}
	c.JSON(http.StatusOK, contracts.BuildingDemandProfileResponse{BuildingRef: c.Param("building_ref"), Series: summaries})
}

// GetBuildingSeriesWeek godoc
//
//	@Summary		Get one week of a building's series
//	@Description	Returns the power values of one week of a series, for the hourly chart. week 0 is
//	@Description	the first seven days from the series' start. 400 for a week outside the series,
//	@Description	404 when the building or series is not stored in this model.
//	@Tags			EnerPlanET
//	@Produce		json
//	@Param			id				path		int		true	"Model ID"
//	@Param			building_ref	path		string	true	"Building OSM id, or c2t:<object_id>"
//	@Param			series			path		string	true	"Series name, for example heating"
//	@Param			week			query		int		false	"Week from the start, default 0"
//	@Param			part			query		string	false	"Roof face, for a PV series"
//	@Success		200	{object}	contracts.SeriesWindowResponse
//	@Failure		400	{object}	contracts.ErrorResponse
//	@Failure		403	{object}	contracts.ErrorResponse
//	@Failure		404	{object}	contracts.ErrorResponse
//	@Security		SessionAuth
//	@Router			/models/{id}/buildings/{building_ref}/series/{series} [get]
func (h *ModelHandler) GetBuildingSeriesWeek(c *gin.Context) {
	week, err := strconv.Atoi(c.DefaultQuery("week", "0"))
	if err != nil {
		httputil.BadRequest(c, fmt.Sprintf("week %q is not a whole number", c.Query("week")))
		return
	}
	model, ok := h.readableModel(c)
	if !ok {
		return
	}
	linked, ok := h.buildingSeries(c, model, c.Param("building_ref"))
	if !ok {
		return
	}
	ls, found := findSeries(linked, c.Param("series"), c.Query("part"))
	if !found {
		httputil.NotFound(c, fmt.Sprintf("series %q is not stored for this building", c.Param("series")))
		return
	}
	s := toSummarySeries(ls)
	values, err := seriessummary.Window(s, week)
	if err != nil {
		httputil.BadRequest(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, contracts.SeriesWindowResponse{
		BuildingRef: ls.BuildingRef, Series: ls.Series, Part: ls.Part, Week: week, Unit: ls.Unit,
		Start:             s.Start.UTC().Add(time.Duration(week*7*24) * time.Hour),
		ResolutionMinutes: ls.ResolutionMinutes, Values: values,
	})
}

// GetBuildingSeriesCSV godoc
//
//	@Summary		Download one building's series as CSV
//	@Description	One row per time step: a UTC timestamp, then one column per series named
//	@Description	"<series> [<unit>]". Cooling is written positive. 404 when the building has no
//	@Description	stored series in this model.
//	@Tags			EnerPlanET
//	@Produce		text/csv
//	@Param			id				path	int		true	"Model ID"
//	@Param			building_ref	path	string	true	"Building OSM id, or c2t:<object_id>"
//	@Success		200	{file}	file
//	@Failure		403	{object}	contracts.ErrorResponse
//	@Failure		404	{object}	contracts.ErrorResponse
//	@Security		SessionAuth
//	@Router			/models/{id}/buildings/{building_ref}/series.csv [get]
func (h *ModelHandler) GetBuildingSeriesCSV(c *gin.Context) {
	model, ok := h.readableModel(c)
	if !ok {
		return
	}
	ref := c.Param("building_ref")
	linked, ok := h.buildingSeries(c, model, ref)
	if !ok {
		return
	}
	// Buffered so a failure can still answer with an error instead of a cut-off file.
	var buf bytes.Buffer
	if err := writeBuildingCSV(&buf, linked); err != nil {
		httputil.InternalError(c, fmt.Sprintf("failed to write CSV: %v", err))
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="model-%d-%s.csv"`, model.ID, ref))
	c.Data(http.StatusOK, "text/csv", buf.Bytes())
}

// GetModelSeriesZip godoc
//
//	@Summary		Download every building's series of a model as a ZIP of CSV files
//	@Description	One CSV per building, in the format of the per-building CSV download. 404 when
//	@Description	no building of the model has stored series yet.
//	@Tags			EnerPlanET
//	@Produce		application/zip
//	@Param			id	path	int	true	"Model ID"
//	@Success		200	{file}	file
//	@Failure		403	{object}	contracts.ErrorResponse
//	@Failure		404	{object}	contracts.ErrorResponse
//	@Security		SessionAuth
//	@Router			/models/{id}/series.zip [get]
func (h *ModelHandler) GetModelSeriesZip(c *gin.Context) {
	model, ok := h.readableModel(c)
	if !ok {
		return
	}
	linked, err := h.seriesStore.LinkedSeries(seriesstore.Owner{ModelID: model.ID}, "")
	if err != nil {
		httputil.InternalError(c, fmt.Sprintf("failed to read series: %v", err))
		return
	}
	if len(linked) == 0 {
		httputil.NotFound(c, "no stored series in this model")
		return
	}
	// Streamed, since a whole model's series is large; a failure after the
	// first bytes can only be logged and leaves the download incomplete.
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="model-%d-series.zip"`, model.ID))
	c.Header("Content-Type", "application/zip")
	c.Status(http.StatusOK)
	if err := writeModelZip(c.Writer, model.ID, linked); err != nil {
		logger.ForComponent("model").Errorf("model %d: series ZIP incomplete: %v", model.ID, err)
	}
}

// readableModel loads the model named by the id path parameter and checks the
// caller may read it: experts read every model, others need access to it.
func (h *ModelHandler) readableModel(c *gin.Context) (*models.Model, bool) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return nil, false
	}
	model, ok := h.fetchModel(c, c.Param("id"))
	if !ok {
		return nil, false
	}
	if userCtx.AccessLevel != constants.AccessLevelExpert && !h.newModelService().UserHasModelAccessByEmail(userCtx.UserID, userCtx.Email, model) {
		httputil.Forbidden(c, errAccessDenied)
		return nil, false
	}
	return model, true
}

// buildingSeries reads a building's linked series, answering 404 when there
// are none.
func (h *ModelHandler) buildingSeries(c *gin.Context, model *models.Model, ref string) ([]seriesstore.LinkedSeries, bool) {
	linked, err := h.seriesStore.LinkedSeries(seriesstore.Owner{ModelID: model.ID}, ref)
	if err != nil {
		httputil.InternalError(c, fmt.Sprintf("failed to read series: %v", err))
		return nil, false
	}
	if len(linked) == 0 {
		httputil.NotFound(c, errNoSeriesForBuilding)
		return nil, false
	}
	return linked, true
}

// toSummarySeries converts a stored series; cooling is reported by magnitude,
// since BuEM gives it as negative power.
func toSummarySeries(ls seriesstore.LinkedSeries) seriessummary.Series {
	return seriessummary.Series{
		Start: ls.StartTime, ResolutionMinutes: ls.ResolutionMinutes, Unit: ls.Unit,
		Values: ls.Vals, Magnitude: ls.Series == "cooling",
	}
}

func summariseLinked(linked []seriesstore.LinkedSeries) ([]contracts.SeriesSummary, error) {
	out := make([]contracts.SeriesSummary, 0, len(linked))
	for _, ls := range linked {
		summary, err := seriessummary.Summarise(toSummarySeries(ls))
		if err != nil {
			return nil, fmt.Errorf("series %s of building %s: %w", ls.Series, ls.BuildingRef, err)
		}
		version := ""
		if ls.ProducerVersion != nil {
			version = *ls.ProducerVersion
		}
		out = append(out, contracts.SeriesSummary{
			Name: ls.Series, Part: ls.Part, Source: ls.Source, ProducerVersion: version,
			Start: ls.StartTime.UTC(), ResolutionMinutes: ls.ResolutionMinutes, Summary: summary,
		})
	}
	return out, nil
}

func findSeries(linked []seriesstore.LinkedSeries, name, part string) (seriesstore.LinkedSeries, bool) {
	for _, ls := range linked {
		if ls.Series == name && ls.Part == part {
			return ls, true
		}
	}
	return seriesstore.LinkedSeries{}, false
}

// writeBuildingCSV writes one building's series as CSV; a roof-face series is
// named "<series>:<part>".
func writeBuildingCSV(w io.Writer, linked []seriesstore.LinkedSeries) error {
	byName := make(map[string]seriessummary.Series, len(linked))
	for _, ls := range linked {
		name := ls.Series
		if ls.Part != "" {
			name += ":" + ls.Part
		}
		byName[name] = toSummarySeries(ls)
	}
	return seriessummary.WriteCSV(w, byName)
}

// writeModelZip writes one CSV per building into a ZIP; linked is ordered by
// building.
func writeModelZip(w io.Writer, modelID uint, linked []seriesstore.LinkedSeries) error {
	zw := zip.NewWriter(w)
	for start := 0; start < len(linked); {
		end := start
		for end < len(linked) && linked[end].BuildingRef == linked[start].BuildingRef {
			end++
		}
		f, err := zw.Create(fmt.Sprintf("model-%d-%s.csv", modelID, linked[start].BuildingRef))
		if err != nil {
			return err
		}
		if err := writeBuildingCSV(f, linked[start:end]); err != nil {
			return fmt.Errorf("building %s: %w", linked[start].BuildingRef, err)
		}
		start = end
	}
	return zw.Close()
}
