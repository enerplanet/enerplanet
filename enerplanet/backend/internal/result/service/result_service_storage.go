package resultservice

import (
	"context"
	"fmt"

	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	"platform.local/platform/logger"
	"spatialhub_backend/internal/models"
)

// batchStore is a generic helper to store records in batches
func batchStore[T any](tx *gorm.DB, log *logrus.Entry, records []T, batchSize int, modelID uint, name string) error {
	if len(records) == 0 {
		return nil
	}
	if err := tx.CreateInBatches(records, batchSize).Error; err != nil {
		return fmt.Errorf("failed to store %s: %w", name, err)
	}
	return nil
}

// storeSmallResults stores only the small/summary data in a single transaction.
// Large time-series data is streamed separately via StreamingInserter.
func (s *ResultService) storeSmallResults(ctx context.Context, modelID uint, parsed *ParsedResults) error {
	log := logger.ForComponent("result")

	return s.db.Transaction(func(tx *gorm.DB) error {
		storeFuncs := []func(*gorm.DB, *logrus.Entry, uint, *ParsedResults) error{
			s.storeCoordinates,
			s.storeLocTechs,
			s.storeModelCapacityFactor,
			s.storeModelLevelisedCost,
			s.storeTotalLevelisedCost,
			s.storeEnergyCap,
			s.storeCost,
			s.storeCostInvestment,
			s.storePyPSASettings,
		}

		for _, fn := range storeFuncs {
			if err := fn(tx, log, modelID, parsed); err != nil {
				return err
			}
		}

		return nil
	})
}

func (s *ResultService) storeCoordinates(tx *gorm.DB, log *logrus.Entry, modelID uint, parsed *ParsedResults) error {
	if len(parsed.Coordinates) == 0 {
		return nil
	}
	var coords []models.ResultsCoordinate
	for loc, coord := range parsed.Coordinates {
		coords = append(coords, models.ResultsCoordinate{
			ModelID:  modelID,
			Location: loc,
			X:        coord.X,
			Y:        coord.Y,
		})
	}
	return batchStore(tx, log, coords, 100, modelID, "coordinates")
}

func (s *ResultService) storeLocTechs(tx *gorm.DB, log *logrus.Entry, modelID uint, parsed *ParsedResults) error {
	if len(parsed.LocTechs) == 0 {
		return nil
	}
	var locTechs []models.ResultsLocTech
	for loc, techs := range parsed.LocTechs {
		for _, tech := range techs {
			locTechs = append(locTechs, models.ResultsLocTech{
				ModelID:  modelID,
				Location: loc,
				Tech:     tech,
			})
		}
	}
	return batchStore(tx, log, locTechs, 100, modelID, "loc_techs")
}

func (s *ResultService) storeModelCapacityFactor(tx *gorm.DB, log *logrus.Entry, modelID uint, parsed *ParsedResults) error {
	if len(parsed.SystemwideCapacityFactor) == 0 {
		return nil
	}
	var records []models.ResultsModelCapacityFactor
	for _, cf := range parsed.SystemwideCapacityFactor {
		records = append(records, models.ResultsModelCapacityFactor{
			ModelID: modelID,
			Carrier: cf.Carrier,
			Techs:   cf.Techs,
			Value:   cf.Value,
		})
	}
	return batchStore(tx, log, records, 100, modelID, "model capacity factors")
}

func (s *ResultService) storeModelLevelisedCost(tx *gorm.DB, log *logrus.Entry, modelID uint, parsed *ParsedResults) error {
	if len(parsed.SystemwideLevelisedCost) == 0 {
		return nil
	}
	var records []models.ResultsModelLevelisedCost
	for _, lc := range parsed.SystemwideLevelisedCost {
		records = append(records, models.ResultsModelLevelisedCost{
			ModelID: modelID,
			Carrier: lc.Carrier,
			Costs:   lc.Costs,
			Techs:   lc.Techs,
			Value:   lc.Value,
		})
	}
	return batchStore(tx, log, records, 100, modelID, "model levelised costs")
}

func (s *ResultService) storeTotalLevelisedCost(tx *gorm.DB, log *logrus.Entry, modelID uint, parsed *ParsedResults) error {
	if len(parsed.TotalLevelisedCost) == 0 {
		return nil
	}
	var records []models.ResultsModelTotalLevelisedCost
	for _, tlc := range parsed.TotalLevelisedCost {
		records = append(records, models.ResultsModelTotalLevelisedCost{
			ModelID: modelID,
			Carrier: tlc.Carrier,
			Costs:   tlc.Costs,
			Value:   tlc.Value,
		})
	}
	return batchStore(tx, log, records, 100, modelID, "total levelised costs")
}

func (s *ResultService) storeEnergyCap(tx *gorm.DB, log *logrus.Entry, modelID uint, parsed *ParsedResults) error {
	if len(parsed.EnergyCap) == 0 {
		return nil
	}
	var records []models.ResultsEnergyCap
	for _, ec := range parsed.EnergyCap {
		record := models.ResultsEnergyCap{
			ModelID:      modelID,
			FromLocation: ec.Location,
			Tech:         ec.Tech,
			Value:        ec.Value,
		}
		if ec.ToLoc != "" {
			record.ToLocation = &ec.ToLoc
		}
		records = append(records, record)
	}
	return batchStore(tx, log, records, 100, modelID, "energy caps")
}

func (s *ResultService) storeCost(tx *gorm.DB, log *logrus.Entry, modelID uint, parsed *ParsedResults) error {
	if len(parsed.Cost) == 0 {
		return nil
	}
	var records []models.ResultsCost
	for _, c := range parsed.Cost {
		record := models.ResultsCost{
			ModelID:      modelID,
			FromLocation: c.FromLocation,
			Costs:        c.Costs,
			Techs:        c.Techs,
			Value:        c.Value,
		}
		if c.ToLocation != "" {
			record.ToLocation = &c.ToLocation
		}
		records = append(records, record)
	}
	return batchStore(tx, log, records, 100, modelID, "costs")
}

func (s *ResultService) storePyPSASettings(tx *gorm.DB, log *logrus.Entry, modelID uint, parsed *ParsedResults) error {
	if parsed.PyPSA == nil {
		return nil
	}
	record := models.ResultsPyPSASettings{
		ModelID:       modelID,
		VoltLV:        parsed.PyPSA.VoltLV,
		VoltMV:        parsed.PyPSA.VoltMV,
		TrafoTypeMVLV: parsed.PyPSA.TrafoTypeMVLV,
		LineTypeLV:    parsed.PyPSA.LineTypeLV,
		LineTypeMV:    parsed.PyPSA.LineTypeMV,
		Converged:     parsed.PyPSA.Converged,
	}
	if err := tx.Create(&record).Error; err != nil {
		log.Warnf("Failed to store PyPSA settings: %v", err)
		return err
	}
	log.Debugf("Stored PyPSA settings for model_id=%d, converged=%v", modelID, record.Converged)
	return nil
}

func (s *ResultService) storeCostInvestment(tx *gorm.DB, log *logrus.Entry, modelID uint, parsed *ParsedResults) error {
	if len(parsed.CostInvestment) == 0 {
		return nil
	}
	var records []models.ResultsCostInvestment
	for _, ci := range parsed.CostInvestment {
		records = append(records, models.ResultsCostInvestment{
			ModelID:  modelID,
			Costs:    ci.Costs,
			Location: ci.Location,
			Techs:    ci.Tech,
			Value:    ci.Value,
		})
	}
	return batchStore(tx, log, records, 100, modelID, "cost investment records")
}

// deleteExistingResults removes all existing result records for a model
func (s *ResultService) deleteExistingResults(tx *gorm.DB, modelID uint) error {
	tables := []string{
		"results_coordinates",
		"results_loc_techs",
		"results_model_capacity_factor",
		"results_model_levelised_cost",
		"results_model_total_levelised_cost",
		"results_energy_cap",
		"results_capacity_factor",
		"results_carrier_prod",
		"results_carrier_con",
		"results_cost",
		"results_cost_var",
		"results_cost_investment",
		"results_pypsa_voltage",
		"results_pypsa_power",
		"results_pypsa_settings",
		"results_pypsa_line_loading",
		"results_system_balance",
		"results_unmet_demand",
		"results_resource_con",
		"results_line_flow",
		"results_transformer_flow",
	}

	for _, table := range tables {
		if err := tx.Table(table).Where("model_id = ?", modelID).Delete(&struct{}{}).Error; err != nil {
			return fmt.Errorf("failed to delete from %s: %w", table, err)
		}
	}

	return nil
}
