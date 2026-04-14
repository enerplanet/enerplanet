package main

import (
	"log"

	"gorm.io/gorm"
	"platform.local/common/pkg/models"
)

func seedWebservice(db *gorm.DB) {
	name := "Simulation Engine"
	ws := models.WebserviceInstance{
		Name:      &name,
		IP:        "sim-haproxy",
		Port:      8089,
		Protocol:  "http",
		Status:    "active",
		Available: true,
	}

	// Check if exists - update if IP/port changed
	var existing models.WebserviceInstance
	result := db.Where("name = ?", name).First(&existing)
	if result.Error == gorm.ErrRecordNotFound {
		if err := db.Create(&ws).Error; err != nil {
			log.Printf("Failed to seed webservice: %v", err)
		} else {
			log.Println("Seeded webservice: Simulation Engine (sim-haproxy:8089)")
		}
	} else if result.Error == nil {
		// Update existing record with new HAProxy settings
		existing.IP = ws.IP
		existing.Port = ws.Port
		if err := db.Save(&existing).Error; err != nil {
			log.Printf("Failed to update webservice: %v", err)
		} else {
			log.Println("Updated webservice: Simulation Engine (sim-haproxy:8089)")
		}
	} else {
		log.Println("Webservice already exists")
	}
}
