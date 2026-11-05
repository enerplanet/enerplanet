package result

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	backendModels "spatialhub_backend/internal/models"

	commonModels "platform.local/common/pkg/models"
	"platform.local/platform/logger"
)

// Store encapsulates all database operations for the result handler.
type Store struct {
	db *gorm.DB
}

// defaultCarrier is the carrier value used when no carrier is specified.
const defaultCarrier = "power"

// NewStore creates a new result Store.
func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// DB returns the underlying *gorm.DB for use by the result service layer.
func (s *Store) DB() *gorm.DB {
	return s.db
}

// ---------------------------------------------------------------------------
// Model access
// ---------------------------------------------------------------------------

// GetModelByIDStr fetches a model using a string ID (convenience for handler params).
func (s *Store) GetModelByIDStr(id string) (*commonModels.Model, error) {
	var model commonModels.Model
	if err := s.db.Where("id = ?", id).First(&model).Error; err != nil {
		return nil, err
	}
	return &model, nil
}

// GetModelByIDWithWorkspace loads the model with Workspace.Members and Workspace.Groups preloaded.
func (s *Store) GetModelByIDWithWorkspace(id uint) (*commonModels.Model, error) {
	var model commonModels.Model
	if err := s.db.Preload("Workspace.Members").Preload("Workspace.Groups").
		Where("id = ?", id).First(&model).Error; err != nil {
		return nil, err
	}
	return &model, nil
}

// CountModelSharesByModelAndUserOrEmail checks whether a direct model share exists
// for the given model+user pair. Matches by user_id and, when provided, by email
// so that shares created before the user_id was back-filled are also found.
func (s *Store) CountModelSharesByModelAndUserOrEmail(modelID uint, userID, email string) int64 {
	var count int64
	q := s.db.Model(&commonModels.ModelShare{}).Where("model_id = ?", modelID)
	if email != "" {
		q = q.Where("user_id = ? OR LOWER(email) = LOWER(?)", userID, email)
	} else {
		q = q.Where("user_id = ?", userID)
	}
	q.Count(&count)
	return count
}

// GetModelBySessionID looks up a model by session_id.
func (s *Store) GetModelBySessionID(sessionID string) (*commonModels.Model, error) {
	var model commonModels.Model
	if err := s.db.Where("session_id = ?", sessionID).First(&model).Error; err != nil {
		return nil, err
	}
	return &model, nil
}

// UpdateModel applies a map of updates to the given model.
func (s *Store) UpdateModel(model *commonModels.Model, updates map[string]interface{}) error {
	return s.db.Model(model).Updates(updates).Error
}

// GetReprocessModel returns the minimal fields needed by ReprocessModelResults.
type ReprocessModelRow struct {
	ID      uint
	UserID  string
	Config  []byte `gorm:"type:jsonb"`
	Results struct {
		FilePath string `json:"file_path"`
	} `gorm:"type:jsonb"`
}

func (s *Store) GetReprocessModel(id string) (*ReprocessModelRow, error) {
	var row ReprocessModelRow
	if err := s.db.Table("models").Select("id, user_id, config, results").
		Where("id = ?", id).First(&row).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

// ---------------------------------------------------------------------------
// Model results (ModelResult CRUD)
// ---------------------------------------------------------------------------

// GetModelResults returns all results for a model ordered by created_at DESC.
func (s *Store) GetModelResults(modelID uint) ([]commonModels.ModelResult, error) {
	var results []commonModels.ModelResult
	if err := s.db.Where("model_id = ?", modelID).Order("created_at DESC").Find(&results).Error; err != nil {
		return nil, err
	}
	return results, nil
}

// GetResultByID fetches a result by primary key with its Model preloaded.
func (s *Store) GetResultByID(id uint) (*commonModels.ModelResult, error) {
	var result commonModels.ModelResult
	if err := s.db.Preload("Model").First(&result, id).Error; err != nil {
		return nil, err
	}
	return &result, nil
}

// ---------------------------------------------------------------------------
// Group membership (workspace access checks)
// ---------------------------------------------------------------------------

// GetUserGroupIDs returns the group IDs a user belongs to.
func (s *Store) GetUserGroupIDs(userID string) ([]string, error) {
	var ids []string
	if err := s.db.Model(&commonModels.GroupMember{}).
		Where("user_id = ?", userID).
		Pluck("group_id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

// ---------------------------------------------------------------------------
// Structured results (summary tables)
// ---------------------------------------------------------------------------

func (s *Store) GetResultsCoordinates(modelID uint) ([]backendModels.ResultsCoordinate, error) {
	var items []backendModels.ResultsCoordinate
	err := s.db.Where("model_id = ?", modelID).Find(&items).Error
	return items, err
}

func (s *Store) GetResultsLocTechs(modelID uint) ([]backendModels.ResultsLocTech, error) {
	var items []backendModels.ResultsLocTech
	err := s.db.Where("model_id = ?", modelID).Find(&items).Error
	return items, err
}

func (s *Store) GetResultsModelCapacityFactor(modelID uint) ([]backendModels.ResultsModelCapacityFactor, error) {
	var items []backendModels.ResultsModelCapacityFactor
	err := s.db.Where("model_id = ?", modelID).Find(&items).Error
	return items, err
}

func (s *Store) GetResultsModelLevelisedCost(modelID uint) ([]backendModels.ResultsModelLevelisedCost, error) {
	var items []backendModels.ResultsModelLevelisedCost
	err := s.db.Where("model_id = ?", modelID).Find(&items).Error
	return items, err
}

func (s *Store) GetResultsModelTotalLevelisedCost(modelID uint) ([]backendModels.ResultsModelTotalLevelisedCost, error) {
	var items []backendModels.ResultsModelTotalLevelisedCost
	err := s.db.Where("model_id = ?", modelID).Find(&items).Error
	return items, err
}

func (s *Store) GetResultsEnergyCap(modelID uint) ([]backendModels.ResultsEnergyCap, error) {
	var items []backendModels.ResultsEnergyCap
	err := s.db.Where("model_id = ?", modelID).Find(&items).Error
	return items, err
}

func (s *Store) GetResultsCost(modelID uint) ([]backendModels.ResultsCost, error) {
	var items []backendModels.ResultsCost
	err := s.db.Where("model_id = ?", modelID).Find(&items).Error
	return items, err
}

func (s *Store) GetResultsCostInvestment(modelID uint) ([]backendModels.ResultsCostInvestment, error) {
	var items []backendModels.ResultsCostInvestment
	err := s.db.Where("model_id = ?", modelID).Find(&items).Error
	return items, err
}

// GetResultSource returns models.result_source, the pipeline that produced the
// model's parsed results. NULL (nothing parsed yet) is returned as "".
func (s *Store) GetResultSource(modelID uint) (string, error) {
	var source sql.NullString
	err := s.db.Table("models").Select("result_source").Where("id = ?", modelID).Row().Scan(&source)
	if err != nil {
		return "", fmt.Errorf("read result_source for model %d: %w", modelID, err)
	}
	return source.String, nil
}

func (s *Store) GetResultsPyPSASettings(modelID uint) (*backendModels.ResultsPyPSASettings, error) {
	var item backendModels.ResultsPyPSASettings
	if err := s.db.Where("model_id = ?", modelID).First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

// GetStructuredResults returns all small summary result tables as a map.
// Optimized using Goroutines to fetch independent tables in parallel.
func (s *Store) GetStructuredResults(modelID uint) map[string]interface{} {
	response := make(map[string]interface{})
	var mu sync.Mutex
	var wg sync.WaitGroup

	fetchers := []struct {
		key string
		f   func(uint) (interface{}, error)
	}{
		{"coordinates", func(id uint) (interface{}, error) { return s.GetResultsCoordinates(id) }},
		{"loc_techs", func(id uint) (interface{}, error) { return s.GetResultsLocTechs(id) }},
		{"model_capacity_factor", func(id uint) (interface{}, error) { return s.GetResultsModelCapacityFactor(id) }},
		{"model_levelised_cost", func(id uint) (interface{}, error) { return s.GetResultsModelLevelisedCost(id) }},
		{"model_total_levelised_cost", func(id uint) (interface{}, error) { return s.GetResultsModelTotalLevelisedCost(id) }},
		{"energy_cap", func(id uint) (interface{}, error) { return s.GetResultsEnergyCap(id) }},
		{"cost", func(id uint) (interface{}, error) { return s.GetResultsCost(id) }},
		{"cost_investment", func(id uint) (interface{}, error) { return s.GetResultsCostInvestment(id) }},
		{"grid_prices", func(id uint) (interface{}, error) { return s.GetUsedGridPrices(id) }},
		{"pypsa", func(id uint) (interface{}, error) {
			settings, err := s.GetResultsPyPSASettings(id)
			if err != nil {
				return nil, err
			}
			return map[string]interface{}{
				"volt_lv":          settings.VoltLV,
				"volt_mv":          settings.VoltMV,
				"trafo_type_mv_lv": settings.TrafoTypeMVLV,
				"line_type_lv":     settings.LineTypeLV,
				"line_type_mv":     settings.LineTypeMV,
				"converged":        settings.Converged,
			}, nil
		}},
	}

	wg.Add(len(fetchers))
	for _, fetcher := range fetchers {
		go func(f struct {
			key string
			f   func(uint) (interface{}, error)
		}) {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					// Log but don't crash — skip this key
					fmt.Printf("[WARN] panic in GetStructuredResults fetcher key=%s: %v\n", f.key, r)
				}
			}()
			if val, err := f.f(modelID); err == nil && val != nil {
				mu.Lock()
				response[f.key] = val
				mu.Unlock()
			}
		}(fetcher)
	}

	wg.Wait()
	return response
}

// GetUsedGridPrices returns the grid electricity prices, ct/kWh, the model's
// latest run used, or nil for a run that recorded none.
func (s *Store) GetUsedGridPrices(modelID uint) (interface{}, error) {
	var run backendModels.ModelMemeRun
	err := s.db.Where("model_id = ? AND leg = ?", modelID, backendModels.MemeLegCalliope).First(&run).Error
	if err != nil || run.GridImportCtPerKWh == nil || run.GridExportCtPerKWh == nil {
		return nil, err
	}
	return map[string]float64{"import_ct_per_kwh": *run.GridImportCtPerKWh, "export_ct_per_kwh": *run.GridExportCtPerKWh}, nil
}

// ---------------------------------------------------------------------------
// Carrier summary aggregates (used by fetchCarrierSummary)
// ---------------------------------------------------------------------------

// TechAggregate holds a tech-level aggregation row.
type TechAggregate struct {
	Techs string  `gorm:"column:techs" json:"techs"`
	Total float64 `gorm:"column:total" json:"total"`
}

// resolveCarrier returns the carrier to query, defaulting to "power" if not specified.
func resolveCarrier(carrier string) string {
	if carrier == "" {
		return defaultCarrier
	}
	return carrier
}

// firstOrEmpty returns the first element of a variadic string slice, or "" if empty.
func firstOrEmpty(s []string) string {
	if len(s) > 0 {
		return s[0]
	}
	return ""
}

func (s *Store) GetCarrierProdAggregates(modelID uint, carrier ...string) []TechAggregate {
	carrierVal := resolveCarrier(firstOrEmpty(carrier))
	zeroTime := time.Time{}
	var rows []TechAggregate
	s.db.Model(&backendModels.ResultsCarrierProd{}).
		Select("techs, SUM(ABS(value)) as total").
		Where("model_id = ? AND carrier = ? AND timestep > ?", modelID, carrierVal, zeroTime).
		Group("techs").
		Find(&rows)
	return rows
}

func (s *Store) GetCarrierConAggregates(modelID uint, carrier ...string) []TechAggregate {
	carrierVal := resolveCarrier(firstOrEmpty(carrier))
	zeroTime := time.Time{}
	var rows []TechAggregate
	s.db.Model(&backendModels.ResultsCarrierCon{}).
		Select("techs, SUM(ABS(value)) as total").
		Where("model_id = ? AND carrier = ? AND timestep > ?", modelID, carrierVal, zeroTime).
		Group("techs").
		Find(&rows)
	return rows
}

func (s *Store) GetCarrierConPeakDemand(modelID uint, carrier ...string) float64 {
	carrierVal := resolveCarrier(firstOrEmpty(carrier))
	zeroTime := time.Time{}
	var peak float64
	s.db.Model(&backendModels.ResultsCarrierCon{}).
		Select("COALESCE(MAX(ts_total), 0)").
		Table("(?) as sub",
			s.db.Model(&backendModels.ResultsCarrierCon{}).
				Select("timestep, SUM(ABS(value)) as ts_total").
				Where("model_id = ? AND carrier = ? AND timestep > ?", modelID, carrierVal, zeroTime).
				Where(endUseSQL).
				Group("timestep"),
		).
		Row().Scan(&peak)
	return peak
}

func (s *Store) GetCarrierConTimestepCount(modelID uint, carrier ...string) int64 {
	carrierVal := resolveCarrier(firstOrEmpty(carrier))
	zeroTime := time.Time{}
	var count int64
	s.db.Model(&backendModels.ResultsCarrierCon{}).
		Where("model_id = ? AND carrier = ? AND timestep > ?", modelID, carrierVal, zeroTime).
		Distinct("timestep").
		Count(&count)
	return count
}

// ---------------------------------------------------------------------------
// Carrier time-series (aggregated)
// ---------------------------------------------------------------------------

// techGroupSQL maps a per-building tech id to its technology, so a series is
// summed over buildings, lines and transformers: pv_supply_3_1 -> pv_supply,
// power_transmission:lv_8 -> power_transmission, n12_demand -> power_demand.
const techGroupSQL = `regexp_replace(regexp_replace(regexp_replace(techs, ':.*$', ''), '^n[0-9]+_demand$', carrier || '_demand'), '_[0-9]+(?=_|$)', '', 'g')`

// CarrierAggRow is the shape returned by the carrier time-series endpoint.
type CarrierAggRow struct {
	ModelID  uint      `json:"model_id"`
	Carrier  string    `json:"carrier"`
	Techs    string    `json:"techs"`
	Timestep time.Time `gorm:"column:timestep" json:"timestep"`
	Value    float64   `json:"value"`
}

func (s *Store) GetCarrierProdTimeSeries(modelID uint, carrier ...string) []CarrierAggRow {
	carrierVal := resolveCarrier(firstOrEmpty(carrier))
	zeroTime := time.Time{}
	var rows []CarrierAggRow
	s.db.Model(&backendModels.ResultsCarrierProd{}).
		Select("model_id, carrier, "+techGroupSQL+" as techs, timestep, SUM(ABS(value)) as value").
		Where("model_id = ? AND carrier = ? AND timestep > ?", modelID, carrierVal, zeroTime).
		Group("model_id, carrier, " + techGroupSQL + ", timestep").
		Order("timestep ASC").
		Find(&rows)
	return rows
}

func (s *Store) GetCarrierConTimeSeries(modelID uint, carrier ...string) []CarrierAggRow {
	carrierVal := resolveCarrier(firstOrEmpty(carrier))
	zeroTime := time.Time{}
	var rows []CarrierAggRow
	s.db.Model(&backendModels.ResultsCarrierCon{}).
		Select("model_id, carrier, "+techGroupSQL+" as techs, timestep, SUM(ABS(value)) as value").
		Where("model_id = ? AND carrier = ? AND timestep > ?", modelID, carrierVal, zeroTime).
		Group("model_id, carrier, " + techGroupSQL + ", timestep").
		Order("timestep ASC").
		Find(&rows)
	return rows
}

func (s *Store) GetDailyCarrierProdTimeSeries(modelID uint, carrier ...string) []CarrierAggRow {
	carrierVal := resolveCarrier(firstOrEmpty(carrier))
	zeroTime := time.Time{}
	var rows []CarrierAggRow
	s.db.Model(&backendModels.ResultsCarrierProd{}).
		Select("model_id, carrier, "+techGroupSQL+" as techs, DATE(timestep) as timestep, SUM(ABS(value)) as value").
		Where("model_id = ? AND carrier = ? AND timestep > ?", modelID, carrierVal, zeroTime).
		Group("model_id, carrier, " + techGroupSQL + ", DATE(timestep)").
		Order("timestep ASC").
		Find(&rows)
	return rows
}

func (s *Store) GetDailyCarrierConTimeSeries(modelID uint, carrier ...string) []CarrierAggRow {
	carrierVal := resolveCarrier(firstOrEmpty(carrier))
	zeroTime := time.Time{}
	var rows []CarrierAggRow
	s.db.Model(&backendModels.ResultsCarrierCon{}).
		Select("model_id, carrier, "+techGroupSQL+" as techs, DATE(timestep) as timestep, SUM(ABS(value)) as value").
		Where("model_id = ? AND carrier = ? AND timestep > ?", modelID, carrierVal, zeroTime).
		Group("model_id, carrier, " + techGroupSQL + ", DATE(timestep)").
		Order("timestep ASC").
		Find(&rows)
	return rows
}

// ---------------------------------------------------------------------------
// System time-series
// ---------------------------------------------------------------------------

func (s *Store) GetTransformerFlows(modelID uint) ([]backendModels.ResultsTransformerFlow, error) {
	var items []backendModels.ResultsTransformerFlow
	err := s.db.Where("model_id = ?", modelID).Find(&items).Error
	return items, err
}

// ---------------------------------------------------------------------------
// PyPSA results
// ---------------------------------------------------------------------------

func (s *Store) GetPyPSAVoltage(modelID uint) ([]backendModels.ResultsPyPSAVoltage, error) {
	var items []backendModels.ResultsPyPSAVoltage
	err := s.db.Where("model_id = ?", modelID).Order("location ASC, timestep ASC").Find(&items).Error
	return items, err
}

func (s *Store) GetPyPSAPower(modelID uint) ([]backendModels.ResultsPyPSAPower, error) {
	var items []backendModels.ResultsPyPSAPower
	err := s.db.Where("model_id = ? AND ABS(p) < ?", modelID, 1_000_000.0).
		Order("location ASC, timestep ASC").Find(&items).Error
	return items, err
}

func (s *Store) GetPyPSALineLoading(modelID uint) ([]backendModels.ResultsPyPSALineLoading, error) {
	var items []backendModels.ResultsPyPSALineLoading
	err := s.db.Where("model_id = ?", modelID).
		Order("line ASC, timestep ASC").Find(&items).Error
	return items, err
}

// GetPyPSALocations returns the buses/nodes a model's PyPSA result refers to.
//
// An electrical (power-flow) source carries these on results_pypsa_voltage; a
// Coati-sourced MEME result has no voltage table at all, so the wire endpoints
// stand in. The Grid panel renders nothing without this list, which makes it the
// render gate for either source.
func (s *Store) GetPyPSALocations(modelID uint) []string {
	seen := map[string]struct{}{}
	collect := func(table, column string) {
		var values []string
		err := s.db.Table(table).Where("model_id = ?", modelID).
			Distinct(column).Pluck(column, &values).Error
		if err != nil {
			logger.ForComponent("result-store").Errorf("model_id=%d: pluck %s.%s: %v", modelID, table, column, err)
		}
		for _, value := range values {
			if strings.TrimSpace(value) != "" {
				seen[value] = struct{}{}
			}
		}
	}
	collect("results_pypsa_voltage", "location")
	collect("results_pypsa_line_loading", "bus0")
	collect("results_pypsa_line_loading", "bus1")

	locations := make([]string, 0, len(seen))
	for value := range seen {
		locations = append(locations, value)
	}
	sort.Strings(locations)
	return locations
}

// ---------------------------------------------------------------------------
// Location time-series (with optional date-range filter)
// ---------------------------------------------------------------------------

// DateRange holds optional begin/end filter strings.
type DateRange struct {
	Begin string
	End   string
}

func (s *Store) GetLocationCarrierProd(modelID uint, location string, dr DateRange, carrier ...string) ([]backendModels.ResultsCarrierProd, error) {
	carrierVal := resolveCarrier(firstOrEmpty(carrier))
	q := s.db.Where("model_id = ? AND from_location = ? AND carrier = ? AND timestep > ?", modelID, location, carrierVal, time.Time{})
	q = applyDateRange(q, dr)
	var items []backendModels.ResultsCarrierProd
	err := q.Order("timestep ASC").Find(&items).Error
	return items, err
}

func (s *Store) GetLocationCarrierCon(modelID uint, location string, dr DateRange, carrier ...string) ([]backendModels.ResultsCarrierCon, error) {
	carrierVal := resolveCarrier(firstOrEmpty(carrier))
	q := s.db.Where("model_id = ? AND from_location = ? AND carrier = ? AND timestep > ?", modelID, location, carrierVal, time.Time{})
	q = applyDateRange(q, dr)
	var items []backendModels.ResultsCarrierCon
	err := q.Order("timestep ASC").Find(&items).Error
	return items, err
}

func (s *Store) GetLocationCapacityFactor(modelID uint, location string, dr DateRange) ([]backendModels.ResultsCapacityFactor, error) {
	q := s.db.Where("model_id = ? AND from_location = ?", modelID, location)
	q = applyDateRange(q, dr)
	var items []backendModels.ResultsCapacityFactor
	err := q.Order("timestep ASC").Find(&items).Error
	return items, err
}

func (s *Store) GetLocationEnergyCap(modelID uint, location string) ([]backendModels.ResultsEnergyCap, error) {
	var items []backendModels.ResultsEnergyCap
	err := s.db.Where("model_id = ? AND from_location = ?", modelID, location).Find(&items).Error
	return items, err
}

func (s *Store) GetLocationCosts(modelID uint, location string) ([]backendModels.ResultsCost, error) {
	var items []backendModels.ResultsCost
	err := s.db.Where("model_id = ? AND from_location = ?", modelID, location).Find(&items).Error
	return items, err
}

func (s *Store) GetLocationPyPSAVoltage(modelID uint, location string) ([]backendModels.ResultsPyPSAVoltage, error) {
	var items []backendModels.ResultsPyPSAVoltage
	err := s.db.Where("model_id = ? AND location = ?", modelID, location).
		Order("timestep ASC").Find(&items).Error
	return items, err
}

func (s *Store) GetLocationPyPSAPower(modelID uint, location string) ([]backendModels.ResultsPyPSAPower, error) {
	var items []backendModels.ResultsPyPSAPower
	err := s.db.Where("model_id = ? AND location = ? AND ABS(p) < ?", modelID, location, 1_000_000.0).
		Order("timestep ASC").Find(&items).Error
	return items, err
}

// ---------------------------------------------------------------------------
// Carrier summary convenience (replicates the logic from fetchCarrierSummary)
// ---------------------------------------------------------------------------

// CarrierSummary holds the computed carrier summary fields.
type CarrierSummary struct {
	SumProduction       float64         `json:"sum_production"`
	SumConsumption      float64         `json:"sum_consumption"`
	RenewableProduction float64         `json:"renewable_production"`
	GridImport          float64         `json:"grid_import"`
	PeakDemand          float64         `json:"peak_demand"`
	TimestepCount       int64           `json:"timestep_count"`
	ProdAggregates      []TechAggregate `json:"prod_aggregates"`
	ConAggregates       []TechAggregate `json:"con_aggregates"`
}

// GetCarrierSummary returns carrier summary for a specific carrier (defaults to "power").
func (s *Store) GetCarrierSummary(modelID uint, carrier ...string) CarrierSummary {
	carrierVal := resolveCarrier(firstOrEmpty(carrier))

	prodAgg := s.GetCarrierProdAggregates(modelID, carrierVal)

	var sumProduction, renewableProduction, gridImport float64
	for _, pa := range prodAgg {
		tech := strings.SplitN(pa.Techs, ":", 2)[0]
		if tech == "power_transmission" {
			continue
		}
		sumProduction += pa.Total

		techLower := strings.ToLower(tech)
		if techLower == "transformer_supply" || strings.Contains(pa.Techs, "transformer_supply") {
			gridImport += pa.Total
		} else if isRenewableTech(techLower) {
			renewableProduction += pa.Total
		}
	}

	conAgg := s.GetCarrierConAggregates(modelID, carrierVal)
	var sumConsumption float64
	for _, ca := range conAgg {
		if isEndUse(ca.Techs) {
			sumConsumption += ca.Total
		}
	}

	return CarrierSummary{
		SumProduction:       sumProduction,
		SumConsumption:      sumConsumption,
		RenewableProduction: renewableProduction,
		GridImport:          gridImport,
		PeakDemand:          s.GetCarrierConPeakDemand(modelID, carrierVal),
		TimestepCount:       s.GetCarrierConTimestepCount(modelID, carrierVal),
		ProdAggregates:      prodAgg,
		ConAggregates:       conAgg,
	}
}

// GetAllCarrierSummaries returns summaries for all carriers present in the results.
func (s *Store) GetAllCarrierSummaries(modelID uint) map[string]CarrierSummary {
	carriers := s.GetDistinctCarriers(modelID)
	summaries := make(map[string]CarrierSummary, len(carriers))
	for _, c := range carriers {
		summaries[c] = s.GetCarrierSummary(modelID, c)
	}
	return summaries
}

// GetDistinctCarriers returns every carrier that has result rows, from BOTH
// carrier_prod and carrier_con.
//
// Taking only the production side hides a carrier whose demand is served
// without an in-model producer (a heat demand with no heat pump, an import-only
// fuel): its consumption rows exist but no production row does, so the API
// would never advertise the carrier and the UI could not switch to it.
func (s *Store) GetDistinctCarriers(modelID uint) []string {
	seen := make(map[string]struct{})

	var prodCarriers []string
	s.db.Model(&backendModels.ResultsCarrierProd{}).
		Where("model_id = ?", modelID).
		Distinct("carrier").
		Pluck("carrier", &prodCarriers)

	var conCarriers []string
	s.db.Model(&backendModels.ResultsCarrierCon{}).
		Where("model_id = ?", modelID).
		Distinct("carrier").
		Pluck("carrier", &conCarriers)

	carriers := make([]string, 0, len(prodCarriers)+len(conCarriers))
	for _, c := range append(prodCarriers, conCarriers...) {
		if c == "" {
			continue
		}
		if _, ok := seen[c]; ok {
			continue
		}
		seen[c] = struct{}{}
		carriers = append(carriers, c)
	}
	return carriers
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func applyDateRange(q *gorm.DB, dr DateRange) *gorm.DB {
	if dr.Begin != "" {
		q = q.Where("timestep >= ?", dr.Begin)
	}
	if dr.End != "" {
		q = q.Where("timestep <= ?", dr.End)
	}
	return q
}

// isEndUse reports whether a consuming technology uses the carrier on site:
// demand and conversion technologies (a heat pump drawing power, a boiler
// burning gas). Storage charging, export links and transmission only move the
// carrier, so they are not demand. endUseSQL is the same rule in SQL.
func isEndUse(techs string) bool {
	tech := strings.ToLower(strings.SplitN(techs, ":", 2)[0])
	return !strings.Contains(tech, "transmission") &&
		!strings.Contains(tech, "storage") &&
		!strings.HasSuffix(tech, "_export")
}

const endUseSQL = `LOWER(SPLIT_PART(techs, ':', 1)) NOT LIKE '%transmission%'
	AND LOWER(SPLIT_PART(techs, ':', 1)) NOT LIKE '%storage%'
	AND LOWER(SPLIT_PART(techs, ':', 1)) NOT LIKE '%\_export'`

func isRenewableTech(tech string) bool {
	renewables := []string{"pv_supply", "wind_onshore", "wind_offshore", "biomass_supply", "geothermal_supply", "hydro_supply"}
	for _, r := range renewables {
		if strings.Contains(tech, r) {
			return true
		}
	}
	return false
}
