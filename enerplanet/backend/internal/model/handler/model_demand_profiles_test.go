package model

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"spatialhub_backend/internal/store/demandprofile"
)

func TestOverallDemandProfileStatus(t *testing.T) {
	assert.Equal(t, "idle", overallDemandProfileStatus(demandprofile.StatusCounts{}))
	assert.Equal(t, "resolving", overallDemandProfileStatus(demandprofile.StatusCounts{Pending: 1, Resolved: 5}))
	assert.Equal(t, "completed", overallDemandProfileStatus(demandprofile.StatusCounts{Resolved: 5, Failed: 1}))
}

func TestMapDemandProfiles(t *testing.T) {
	heating := 4823.5
	code := "DE.N.SFH.05.Gen.ReEx.001.001"
	storeys, aRef, hRoom := 6, 6648.84, 2.5
	rows := []demandprofile.Summary{
		{OSMID: "111", Status: "resolved", TabulaVariantCode: &code, RefurbishmentLevel: "existing", HeatingKwhA: &heating,
			NStoreys: &storeys, ARefM2: &aRef, HRoomM: &hRoom},
		{OSMID: "222", Status: "pending", RefurbishmentLevel: "existing"},
	}

	got := mapDemandProfiles(rows)

	require := assert.New(t)
	require.Len(got, 2)
	require.Equal("111", got[0].OSMID)
	require.Equal("resolved", got[0].Status)
	require.Equal(&code, got[0].TabulaVariantCode)
	require.Equal(&heating, got[0].HeatingKwhA)
	require.Equal(&storeys, got[0].NStoreys)
	require.Equal(&aRef, got[0].ARefM2)
	require.Equal(&hRoom, got[0].HRoomM)
	require.Equal("222", got[1].OSMID)
	require.Equal("pending", got[1].Status)
	require.Nil(got[1].HeatingKwhA)
}
