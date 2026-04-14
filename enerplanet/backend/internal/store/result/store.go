package result

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	backendModels "spatialhub_backend/internal/models"

	commonModels "platform.local/common/pkg/models"
)

// Store encapsulates all database operations for the result handler.
type Store struct {
	db *gorm.DB
}

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

// ---------------------------------------------------------------------------
// Carrier summary aggregates (used by fetchCarrierSummary)
// ---------------------------------------------------------------------------

// TechAggregate holds a tech-level aggregation row.
type TechAggregate struct {
	Techs string  `gorm:"column:techs"`
	Total float64 `gorm:"column:total"`
}

func (s *Store) GetCarrierProdAggregates(modelID uint) []TechAggregate {
	zeroTime := time.Time{}
	var rows []TechAggregate
	s.db.Model(&backendModels.ResultsCarrierProd{}).
		Select("techs, SUM(ABS(value)) as total").
		Where("model_id = ? AND carrier = ? AND timestep > ?", modelID, "power", zeroTime).
		Group("techs").
		Find(&rows)
	return rows
}

func (s *Store) GetCarrierConAggregates(modelID uint) []TechAggregate {
	zeroTime := time.Time{}
	var rows []TechAggregate
	s.db.Model(&backendModels.ResultsCarrierCon{}).
		Select("techs, SUM(ABS(value)) as total").
		Where("model_id = ? AND carrier = ? AND timestep > ?", modelID, "power", zeroTime).
		Group("techs").
		Find(&rows)
	return rows
}

func (s *Store) GetCarrierConPeakDemand(modelID uint) float64 {
	zeroTime := time.Time{}
	var peak float64
	s.db.Model(&backendModels.ResultsCarrierCon{}).
		Select("COALESCE(MAX(ts_total), 0)").
		Table("(?) as sub",
			s.db.Model(&backendModels.ResultsCarrierCon{}).
				Select("timestep, SUM(ABS(value)) as ts_total").
				Where("model_id = ? AND carrier = ? AND timestep > ? AND LOWER(SPLIT_PART(techs, ':', 1)) LIKE ?",
					modelID, "power", zeroTime, "%\\_demand").
				Group("timestep"),
		).
		Row().Scan(&peak)
	return peak
}

func (s *Store) GetCarrierConTimestepCount(modelID uint) int64 {
	zeroTime := time.Time{}
	var count int64
	s.db.Model(&backendModels.ResultsCarrierCon{}).
		Where("model_id = ? AND carrier = ? AND timestep > ?", modelID, "power", zeroTime).
		Distinct("timestep").
		Count(&count)
	return count
}

// ---------------------------------------------------------------------------
// Carrier time-series (aggregated)
// ---------------------------------------------------------------------------

// CarrierAggRow is the shape returned by the carrier time-series endpoint.
type CarrierAggRow struct {
	ModelID  uint      `json:"model_id"`
	Carrier  string    `json:"carrier"`
	Techs    string    `json:"techs"`
	Timestep time.Time `gorm:"column:timestep" json:"timestep"`
	Value    float64   `json:"value"`
}

func (s *Store) GetCarrierProdTimeSeries(modelID uint) []CarrierAggRow {
	zeroTime := time.Time{}
	var rows []CarrierAggRow
	s.db.Model(&backendModels.ResultsCarrierProd{}).
		Select("model_id, carrier, techs, timestep, SUM(ABS(value)) as value").
		Where("model_id = ? AND carrier = ? AND timestep > ?", modelID, "power", zeroTime).
		Group("model_id, carrier, techs, timestep").
		Order("timestep ASC").
		Find(&rows)
	return rows
}

func (s *Store) GetCarrierConTimeSeries(modelID uint) []CarrierAggRow {
	zeroTime := time.Time{}
	var rows []CarrierAggRow
	s.db.Model(&backendModels.ResultsCarrierCon{}).
		Select("model_id, carrier, techs, timestep, SUM(ABS(value)) as value").
		Where("model_id = ? AND carrier = ? AND timestep > ?", modelID, "power", zeroTime).
		Group("model_id, carrier, techs, timestep").
		Order("timestep ASC").
		Find(&rows)
	return rows
}

func (s *Store) GetDailyCarrierProdTimeSeries(modelID uint) []CarrierAggRow {
	zeroTime := time.Time{}
	var rows []CarrierAggRow
	s.db.Model(&backendModels.ResultsCarrierProd{}).
		Select("model_id, carrier, techs, DATE(timestep) as timestep, SUM(ABS(value)) as value").
		Where("model_id = ? AND carrier = ? AND timestep > ?", modelID, "power", zeroTime).
		Group("model_id, carrier, techs, DATE(timestep)").
		Order("timestep ASC").
		Find(&rows)
	return rows
}

func (s *Store) GetDailyCarrierConTimeSeries(modelID uint) []CarrierAggRow {
	zeroTime := time.Time{}
	var rows []CarrierAggRow
	s.db.Model(&backendModels.ResultsCarrierCon{}).
		Select("model_id, carrier, techs, DATE(timestep) as timestep, SUM(ABS(value)) as value").
		Where("model_id = ? AND carrier = ? AND timestep > ?", modelID, "power", zeroTime).
		Group("model_id, carrier, techs, DATE(timestep)").
		Order("timestep ASC").
		Find(&rows)
	return rows
}

// ---------------------------------------------------------------------------
// System time-series
// ---------------------------------------------------------------------------

// BalanceDailyRow is the shape for daily-aggregated system balance / unmet demand.
type BalanceDailyRow struct {
	ModelID  uint      `json:"model_id"`
	Carrier  string    `json:"carrier"`
	Location string    `json:"location"`
	Timestep time.Time `gorm:"column:timestep" json:"timestep"`
	Value    float64   `json:"value"`
}

func (s *Store) GetDailySystemBalance(modelID uint) []BalanceDailyRow {
	var rows []BalanceDailyRow
	s.db.Model(&backendModels.ResultsSystemBalance{}).
		Select("model_id, carrier, 'all' as location, DATE(timestep) as timestep, AVG(value) as value").
		Where("model_id = ?", modelID).
		Group("model_id, carrier, DATE(timestep)").
		Order("timestep ASC").
		Find(&rows)
	return rows
}

func (s *Store) GetDailyUnmetDemand(modelID uint) []BalanceDailyRow {
	var rows []BalanceDailyRow
	s.db.Model(&backendModels.ResultsUnmetDemand{}).
		Select("model_id, carrier, 'all' as location, DATE(timestep) as timestep, SUM(ABS(value)) as value").
		Where("model_id = ?", modelID).
		Group("model_id, carrier, DATE(timestep)").
		Order("timestep ASC").
		Find(&rows)
	return rows
}

// ResourceTotalRow is the shape for resource consumption totals.
type ResourceTotalRow struct {
	ModelID  uint    `json:"model_id"`
	Location string  `json:"location"`
	Tech     string  `json:"tech"`
	Timestep string  `json:"timestep"`
	Value    float64 `json:"value"`
}

func (s *Store) GetResourceConTotals(modelID uint) []ResourceTotalRow {
	var rows []ResourceTotalRow
	s.db.Model(&backendModels.ResultsResourceCon{}).
		Select("model_id, 'all' as location, tech, '' as timestep, SUM(ABS(value)) as value").
		Where("model_id = ?", modelID).
		Group("model_id, tech").
		Order("value DESC").
		Find(&rows)
	return rows
}

func (s *Store) GetLineFlows(modelID uint) ([]backendModels.ResultsLineFlow, error) {
	var items []backendModels.ResultsLineFlow
	err := s.db.Where("model_id = ?", modelID).Find(&items).Error
	return items, err
}

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

func (s *Store) GetPyPSAVoltageLocations(modelID uint) []string {
	var locations []string
	s.db.Model(&backendModels.ResultsPyPSAVoltage{}).Where("model_id = ?", modelID).
		Distinct("location").Pluck("location", &locations)
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

func (s *Store) GetLocationCarrierProd(modelID uint, location string, dr DateRange) ([]backendModels.ResultsCarrierProd, error) {
	q := s.db.Where("model_id = ? AND from_location = ? AND carrier = ? AND timestep > ?", modelID, location, "power", time.Time{})
	q = applyDateRange(q, dr)
	var items []backendModels.ResultsCarrierProd
	err := q.Order("timestep ASC").Find(&items).Error
	return items, err
}

func (s *Store) GetLocationCarrierCon(modelID uint, location string, dr DateRange) ([]backendModels.ResultsCarrierCon, error) {
	q := s.db.Where("model_id = ? AND from_location = ? AND carrier = ? AND timestep > ?", modelID, location, "power", time.Time{})
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
	SumProduction       float64
	SumConsumption      float64
	RenewableProduction float64
	GridImport          float64
	PeakDemand          float64
	TimestepCount       int64
	ProdAggregates      []TechAggregate
	ConAggregates       []TechAggregate
}

func (s *Store) GetCarrierSummary(modelID uint) CarrierSummary {
	prodAgg := s.GetCarrierProdAggregates(modelID)

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

	conAgg := s.GetCarrierConAggregates(modelID)
	var sumConsumption float64
	for _, ca := range conAgg {
		tech := strings.SplitN(ca.Techs, ":", 2)[0]
		if strings.HasSuffix(strings.ToLower(tech), "_demand") {
			sumConsumption += ca.Total
		}
	}

	return CarrierSummary{
		SumProduction:       sumProduction,
		SumConsumption:      sumConsumption,
		RenewableProduction: renewableProduction,
		GridImport:          gridImport,
		PeakDemand:          s.GetCarrierConPeakDemand(modelID),
		TimestepCount:       s.GetCarrierConTimestepCount(modelID),
		ProdAggregates:      prodAgg,
		ConAggregates:       conAgg,
	}
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

func isRenewableTech(tech string) bool {
	renewables := []string{"pv_supply", "wind_onshore", "wind_offshore", "biomass_supply", "geothermal_supply", "hydro_supply"}
	for _, r := range renewables {
		if strings.Contains(tech, r) {
			return true
		}
	}
	return false
}
