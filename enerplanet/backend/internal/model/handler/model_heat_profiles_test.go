package model

import (
	"testing"

	"github.com/stretchr/testify/assert"

	backendModels "spatialhub_backend/internal/models"
	"spatialhub_backend/internal/store/heatprofile"
)

func TestOverallHeatProfileStatus(t *testing.T) {
	assert.Equal(t, "idle", overallHeatProfileStatus(heatprofile.StatusCounts{}))
	assert.Equal(t, "resolving", overallHeatProfileStatus(heatprofile.StatusCounts{Pending: 1, Resolved: 5}))
	assert.Equal(t, "completed", overallHeatProfileStatus(heatprofile.StatusCounts{Resolved: 5, Failed: 1}))
}

func TestMapHeatProfiles(t *testing.T) {
	heating := 4823.5
	code := "DE.N.SFH.05.Gen.ReEx.001.001"
	rows := []backendModels.BuildingHeatProfile{
		{OSMID: "111", Status: "resolved", TabulaVariantCode: &code, RefurbishmentLevel: "existing", HeatingKwhA: &heating},
		{OSMID: "222", Status: "pending", RefurbishmentLevel: "existing"},
	}

	got := mapHeatProfiles(rows)

	require := assert.New(t)
	require.Len(got, 2)
	require.Equal("111", got[0].OSMID)
	require.Equal("resolved", got[0].Status)
	require.Equal(&code, got[0].TabulaVariantCode)
	require.Equal(&heating, got[0].HeatingKwhA)
	require.Equal("222", got[1].OSMID)
	require.Equal("pending", got[1].Status)
	require.Nil(got[1].HeatingKwhA)
}
