-- Migration: Add composite indexes for time-series result queries
-- These indexes optimize the server-side aggregation queries used by
-- the carrier-timeseries and system-timeseries endpoints.

CREATE INDEX IF NOT EXISTS idx_results_carrier_prod_model_carrier
  ON results_carrier_prod(model_id, carrier);

CREATE INDEX IF NOT EXISTS idx_results_carrier_con_model_carrier
  ON results_carrier_con(model_id, carrier);

CREATE INDEX IF NOT EXISTS idx_results_system_balance_model_carrier
  ON results_system_balance(model_id, carrier);

CREATE INDEX IF NOT EXISTS idx_results_unmet_demand_model_carrier
  ON results_unmet_demand(model_id, carrier);

CREATE INDEX IF NOT EXISTS idx_results_line_flow_model_line
  ON results_line_flow(model_id, line);

CREATE INDEX IF NOT EXISTS idx_results_transformer_flow_model_transformer
  ON results_transformer_flow(model_id, transformer);
