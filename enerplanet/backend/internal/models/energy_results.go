package models

import (
	"time"
)


type ResultsCapacityFactor struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	ModelID      uint       `gorm:"not null;index" json:"model_id"`
	FromLocation string     `gorm:"size:255;not null" json:"from_location"`
	ToLocation   *string    `gorm:"size:255" json:"to_location,omitempty"`
	Carrier      string     `gorm:"size:255;not null" json:"carrier"`
	Techs        string     `gorm:"size:255;not null" json:"techs"`
	Timestep     *time.Time `json:"timestep,omitempty"`
	Value        float64    `gorm:"not null" json:"value"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

func (ResultsCapacityFactor) TableName() string {
	return "results_capacity_factor"
}


type ResultsCarrierProd struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	ModelID      uint      `gorm:"not null;index" json:"model_id"`
	FromLocation string    `gorm:"size:255;not null" json:"from_location"`
	ToLocation   *string   `gorm:"size:255" json:"to_location,omitempty"`
	Carrier      string    `gorm:"size:255;not null" json:"carrier"`
	Techs        string    `gorm:"size:255;not null" json:"techs"`
	Timestep     time.Time `gorm:"not null" json:"timestep"`
	Value        float64   `gorm:"not null" json:"value"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (ResultsCarrierProd) TableName() string {
	return "results_carrier_prod"
}


type ResultsCarrierCon struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	ModelID      uint      `gorm:"not null;index" json:"model_id"`
	FromLocation string    `gorm:"size:255;not null" json:"from_location"`
	ToLocation   *string   `gorm:"size:255" json:"to_location,omitempty"`
	Carrier      string    `gorm:"size:255;not null" json:"carrier"`
	Techs        string    `gorm:"size:255;not null" json:"techs"`
	Timestep     time.Time `gorm:"not null" json:"timestep"`
	Value        float64   `gorm:"not null" json:"value"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (ResultsCarrierCon) TableName() string {
	return "results_carrier_con"
}


type ResultsCostInvestment struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ModelID   uint      `gorm:"not null;index" json:"model_id"`
	Location  string    `gorm:"size:255;not null" json:"location"`
	Costs     string    `gorm:"size:255;not null" json:"costs"`
	Techs     string    `gorm:"size:255;not null" json:"techs"`
	Value     float64   `gorm:"not null" json:"value"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ResultsCostInvestment) TableName() string {
	return "results_cost_investment"
}


type ResultsCostVar struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ModelID   uint      `gorm:"not null;index" json:"model_id"`
	Location  string    `gorm:"size:255;not null" json:"location"`
	Costs     string    `gorm:"size:255;not null" json:"costs"`
	Techs     string    `gorm:"size:255;not null" json:"techs"`
	Timestep  time.Time `gorm:"not null" json:"timestep"`
	Value     float64   `gorm:"not null" json:"value"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ResultsCostVar) TableName() string {
	return "results_cost_var"
}


type ResultsCost struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	ModelID      uint      `gorm:"not null;index" json:"model_id"`
	FromLocation string    `gorm:"size:255;not null" json:"from_location"`
	ToLocation   *string   `gorm:"size:255" json:"to_location,omitempty"`
	Costs        string    `gorm:"size:255;not null" json:"costs"`
	Techs        string    `gorm:"size:255;not null" json:"techs"`
	Value        float64   `gorm:"not null" json:"value"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (ResultsCost) TableName() string {
	return "results_cost"
}


type ResultsEnergyCap struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	ModelID      uint      `gorm:"not null;index" json:"model_id"`
	FromLocation string    `gorm:"size:255;not null" json:"from_location"`
	ToLocation   *string   `gorm:"size:255" json:"to_location,omitempty"`
	Tech         string    `gorm:"size:255;not null" json:"tech"`
	Value        float64   `gorm:"not null" json:"value"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (ResultsEnergyCap) TableName() string {
	return "results_energy_cap"
}


type ResultsModelCapacityFactor struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ModelID   uint      `gorm:"not null;index" json:"model_id"`
	Carrier   string    `gorm:"size:255;not null" json:"carrier"`
	Techs     string    `gorm:"size:255;not null" json:"techs"`
	Value     float64   `gorm:"not null" json:"value"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ResultsModelCapacityFactor) TableName() string {
	return "results_model_capacity_factor"
}


type ResultsModelLevelisedCost struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ModelID   uint      `gorm:"not null;index" json:"model_id"`
	Carrier   string    `gorm:"size:255;not null" json:"carrier"`
	Costs     string    `gorm:"size:255;not null" json:"costs"`
	Techs     string    `gorm:"size:255;not null" json:"techs"`
	Value     float64   `gorm:"not null" json:"value"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ResultsModelLevelisedCost) TableName() string {
	return "results_model_levelised_cost"
}


type ResultsModelTotalLevelisedCost struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ModelID   uint      `gorm:"not null;index" json:"model_id"`
	Carrier   string    `gorm:"size:255;not null" json:"carrier"`
	Costs     string    `gorm:"size:255;not null" json:"costs"`
	Value     float64   `gorm:"not null" json:"value"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ResultsModelTotalLevelisedCost) TableName() string {
	return "results_model_total_levelised_cost"
}


type ResultsCoordinate struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ModelID   uint      `gorm:"not null;index" json:"model_id"`
	Location  string    `gorm:"size:255;not null" json:"location"`
	X         float64   `gorm:"not null" json:"x"`
	Y         float64   `gorm:"not null" json:"y"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ResultsCoordinate) TableName() string {
	return "results_coordinates"
}


type ResultsLocTech struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ModelID   uint      `gorm:"not null;index" json:"model_id"`
	Location  string    `gorm:"size:255;not null" json:"location"`
	Tech      string    `gorm:"size:255;not null" json:"tech"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ResultsLocTech) TableName() string {
	return "results_loc_techs"
}


type ResultsPyPSAVoltage struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ModelID   uint      `gorm:"not null;index" json:"model_id"`
	Bus       string    `gorm:"size:255;not null" json:"bus"`
	Location  string    `gorm:"size:255;not null;index" json:"location"`
	Timestep  time.Time `gorm:"not null;index" json:"timestep"`
	VMagPu    float64   `gorm:"column:v_mag_pu;not null" json:"v_mag_pu"`
	VAng      *float64  `gorm:"column:v_ang" json:"v_ang,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ResultsPyPSAVoltage) TableName() string {
	return "results_pypsa_voltage"
}


type ResultsPyPSAPower struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ModelID   uint      `gorm:"not null;index" json:"model_id"`
	Bus       string    `gorm:"size:255;not null" json:"bus"`
	Location  string    `gorm:"size:255;not null;index" json:"location"`
	Timestep  time.Time `gorm:"not null;index" json:"timestep"`
	P         float64   `gorm:"not null" json:"p"`
	Q         *float64  `json:"q,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ResultsPyPSAPower) TableName() string {
	return "results_pypsa_power"
}


type ResultsPyPSALineLoading struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	ModelID        uint      `gorm:"not null;index" json:"model_id"`
	Line           string    `gorm:"size:255;not null" json:"line"`
	Bus0           string    `gorm:"size:255;not null" json:"bus0"`
	Bus1           string    `gorm:"size:255;not null" json:"bus1"`
	Timestep       time.Time `gorm:"not null;index" json:"timestep"`
	P0             float64   `gorm:"not null" json:"p0"`
	P1             *float64  `json:"p1,omitempty"`
	Q0             *float64  `json:"q0,omitempty"`
	Q1             *float64  `json:"q1,omitempty"`
	LoadingPercent *float64  `gorm:"column:loading_percent" json:"loading_percent,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

func (ResultsPyPSALineLoading) TableName() string {
	return "results_pypsa_line_loading"
}

// ResultsPyPSASettings stores PyPSA power flow settings and convergence status
type ResultsPyPSASettings struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	ModelID       uint      `gorm:"not null;uniqueIndex" json:"model_id"`
	VoltLV        string    `gorm:"column:volt_lv" json:"volt_lv"`
	VoltMV        string    `gorm:"column:volt_mv" json:"volt_mv"`
	TrafoTypeMVLV string    `gorm:"column:trafo_type_mv_lv" json:"trafo_type_mv_lv"`
	LineTypeLV    string    `gorm:"column:line_type_lv" json:"line_type_lv"`
	LineTypeMV    string    `gorm:"column:line_type_mv" json:"line_type_mv"`
	Converged     bool      `gorm:"column:converged" json:"converged"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (ResultsPyPSASettings) TableName() string {
	return "results_pypsa_settings"
}


type ResultsSystemBalance struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ModelID   uint      `gorm:"not null;index" json:"model_id"`
	Carrier   string    `gorm:"size:255;not null" json:"carrier"`
	Location  string    `gorm:"size:255;not null;index" json:"location"`
	Timestep  time.Time `gorm:"not null;index" json:"timestep"`
	Value     float64   `gorm:"not null" json:"value"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ResultsSystemBalance) TableName() string {
	return "results_system_balance"
}


type ResultsUnmetDemand struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ModelID   uint      `gorm:"not null;index" json:"model_id"`
	Carrier   string    `gorm:"size:255;not null" json:"carrier"`
	Location  string    `gorm:"size:255;not null;index" json:"location"`
	Timestep  time.Time `gorm:"not null;index" json:"timestep"`
	Value     float64   `gorm:"not null" json:"value"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ResultsUnmetDemand) TableName() string {
	return "results_unmet_demand"
}


type ResultsResourceCon struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ModelID   uint      `gorm:"not null;index" json:"model_id"`
	Location  string    `gorm:"size:255;not null;index" json:"location"`
	Tech      string    `gorm:"size:255;not null" json:"tech"`
	Timestep  time.Time `gorm:"not null;index" json:"timestep"`
	Value     float64   `gorm:"not null" json:"value"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ResultsResourceCon) TableName() string {
	return "results_resource_con"
}


type ResultsLineFlow struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ModelID   uint      `gorm:"not null;index" json:"model_id"`
	Line      string    `gorm:"size:255;not null" json:"line"`
	Timestep  time.Time `gorm:"not null;index" json:"timestep"`
	P0        float64   `gorm:"not null" json:"p0"`
	P1        float64   `gorm:"not null" json:"p1"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ResultsLineFlow) TableName() string {
	return "results_line_flow"
}


type ResultsTransformerFlow struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	ModelID     uint      `gorm:"not null;index" json:"model_id"`
	Transformer string    `gorm:"size:255;not null" json:"transformer"`
	Timestep    time.Time `gorm:"not null;index" json:"timestep"`
	P0          float64   `gorm:"not null" json:"p0"`
	P1          float64   `gorm:"not null" json:"p1"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (ResultsTransformerFlow) TableName() string {
	return "results_transformer_flow"
}
