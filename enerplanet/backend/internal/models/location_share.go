package models

import (
	"time"
)

// LocationShare represents a direct share of a location with a specific user
type LocationShare struct {
	ID         uint      `json:"id" gorm:"primaryKey"`
	LocationID uint      `json:"location_id" gorm:"not null;index"`
	UserID     string    `json:"user_id" gorm:"index"`
	Email      string    `json:"email" gorm:"not null;index"`
	Permission string    `json:"permission" gorm:"default:'view'"`
	SharedBy   string    `json:"shared_by" gorm:"not null"`
	CreatedAt  time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt  time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

func (LocationShare) TableName() string {
	return "location_shares"
}

// LocationWorkspaceShare represents sharing a location with a workspace
type LocationWorkspaceShare struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	LocationID  uint      `json:"location_id" gorm:"not null;index"`
	WorkspaceID uint      `json:"workspace_id" gorm:"not null;index"`
	Permission  string    `json:"permission" gorm:"default:'view'"`
	SharedBy    string    `json:"shared_by" gorm:"not null"`
	CreatedAt   time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

func (LocationWorkspaceShare) TableName() string {
	return "location_workspace_shares"
}

// LocationGroupShare represents sharing a location with a user group
type LocationGroupShare struct {
	ID         uint      `json:"id" gorm:"primaryKey"`
	LocationID uint      `json:"location_id" gorm:"not null;index"`
	GroupID    string    `json:"group_id" gorm:"not null;index"`
	Permission string    `json:"permission" gorm:"default:'view'"`
	SharedBy   string    `json:"shared_by" gorm:"not null"`
	CreatedAt  time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt  time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

func (LocationGroupShare) TableName() string {
	return "location_group_shares"
}

// Request types

type ShareLocationWithUserRequest struct {
	Email      string `json:"email" binding:"required,email"`
	Permission string `json:"permission" binding:"omitempty,oneof=view edit"`
}

type ShareLocationWithWorkspaceRequest struct {
	WorkspaceID uint   `json:"workspace_id" binding:"required"`
	Permission  string `json:"permission" binding:"omitempty,oneof=view edit"`
}

type ShareLocationWithGroupRequest struct {
	GroupID    string `json:"group_id" binding:"required"`
	Permission string `json:"permission" binding:"omitempty,oneof=view edit"`
}

// Response types

type LocationShareResponse struct {
	ID         uint   `json:"id"`
	Type       string `json:"type"` // "user", "workspace", "group"
	Email      string `json:"email,omitempty"`
	UserID     string `json:"user_id,omitempty"`
	WorkspaceID uint   `json:"workspace_id,omitempty"`
	WorkspaceName string `json:"workspace_name,omitempty"`
	GroupID    string `json:"group_id,omitempty"`
	GroupName  string `json:"group_name,omitempty"`
	Permission string `json:"permission"`
	SharedBy   string `json:"shared_by"`
	CreatedAt  string `json:"created_at"`
}

type LocationSharesListResponse struct {
	UserShares      []LocationShareResponse `json:"user_shares"`
	WorkspaceShares []LocationShareResponse `json:"workspace_shares"`
	GroupShares     []LocationShareResponse `json:"group_shares"`
}
