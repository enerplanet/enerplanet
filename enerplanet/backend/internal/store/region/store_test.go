package region

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"

	"spatialhub_backend/internal/models"
	"spatialhub_backend/internal/testutil"
)

func TestNewStore(t *testing.T) {
	db, _ := testutil.NewMockDB(t)
	store := NewStore(db)
	assert.NotNil(t, store)
}

func TestBuildAvailableRegionsResponse_IncludesPostcodes(t *testing.T) {
	body, err := BuildAvailableRegionsResponse([]models.CachedRegion{
		{CountryCode: "DE", StateCode: "bavaria", RegionName: "Bayern", GridCount: 5, Postcodes: datatypes.JSON(`["94447","94469"]`)},
		{CountryCode: "NL", StateCode: "gelderland", RegionName: "Gelderland", GridCount: 2},
	})
	require.NoError(t, err)

	var resp struct {
		Data struct {
			Regions []map[string]json.RawMessage `json:"regions"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(body, &resp))
	require.Len(t, resp.Data.Regions, 2)
	assert.JSONEq(t, `["94447","94469"]`, string(resp.Data.Regions[0]["postcodes"]))
	assert.NotContains(t, resp.Data.Regions[1], "postcodes", "a region cached before PyLovo sent postcodes has none")
}
