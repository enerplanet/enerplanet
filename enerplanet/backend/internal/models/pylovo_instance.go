package models

import (
	"fmt"
	"time"
)

type PylovoInstance struct {
	ID            uint       `json:"id" gorm:"primaryKey"`
	Name          string     `json:"name" gorm:"not null"`
	IP            string     `json:"ip" gorm:"column:ip;not null"`
	Port          int        `json:"port" gorm:"not null"`
	Protocol      string     `json:"protocol" gorm:"not null;default:http"`
	Endpoint      string     `json:"endpoint"`
	Status        string     `json:"status" gorm:"not null;default:active"`
	Available     bool       `json:"available" gorm:"not null;default:true"`
	IsPrimary     bool       `json:"is_primary" gorm:"not null;default:false"`
	LastCheck     *time.Time `json:"last_check"`
	LastHeartbeat *time.Time `json:"last_heartbeat"`
	CreatedAt     time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt     time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
	DeletedAt     *time.Time `json:"deleted_at,omitempty" gorm:"index"`
}

func (PylovoInstance) TableName() string {
	return "pylovo_instances"
}

func (p *PylovoInstance) BaseURL() string {
	return fmt.Sprintf("%s://%s:%d", p.Protocol, p.IP, p.Port)
}
