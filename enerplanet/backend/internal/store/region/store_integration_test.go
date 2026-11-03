//go:build integration

// Needs PostgreSQL at TEST_DATABASE_URL (e.g. 'host=localhost port=5433 user=postgres password=postgres dbname=spatialai').
// Run with: go test -tags integration ./internal/store/region/
// Each test works in a scratch schema inside one transaction that is rolled back.
package region

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// scratchDB opens TEST_DATABASE_URL, starts a transaction, creates
// cached_regions from its migrations in a scratch schema ahead of public and
// rolls it all back when the test ends.
func scratchDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	tx := db.Begin()
	require.NoError(t, tx.Error)
	t.Cleanup(func() { tx.Rollback() })

	require.NoError(t, tx.Exec("CREATE SCHEMA regions_it").Error)
	require.NoError(t, tx.Exec("SET LOCAL search_path TO regions_it, public").Error)
	for _, name := range []string{
		"026_create_cached_regions_table.sql",
		"029_add_enabled_to_cached_regions.sql",
		"031_add_has3d_to_cached_regions.sql",
		"034_add_state_code_to_cached_regions.sql",
		"053_add_postcodes_to_cached_regions.sql",
	} {
		migration, err := os.ReadFile("../../../migrations/" + name)
		require.NoError(t, err)
		require.NoError(t, tx.Exec(string(migration)).Error, name)
	}
	return tx
}

// answer builds a PyLovo /boundary/available response holding one region per
// "country/state" pair.
func answer(t *testing.T, pairs ...[2]string) []byte {
	t.Helper()
	regions := make([]map[string]any, 0, len(pairs))
	for _, p := range pairs {
		regions = append(regions, map[string]any{
			"country_code": p[0],
			"state_code":   p[1],
			"grid_count":   5,
			"region":       map[string]any{"name": p[1], "country": p[0]},
		})
	}
	body, err := json.Marshal(map[string]any{"status": "success", "regions": regions})
	require.NoError(t, err)
	return body
}

// postcodeAnswer is one region's answer listing its postcodes.
func postcodeAnswer(t *testing.T, postcodes ...string) []byte {
	t.Helper()
	body, err := json.Marshal(map[string]any{"status": "success", "regions": []map[string]any{{
		"country_code": "DE",
		"state_code":   "bavaria",
		"grid_count":   5,
		"postcodes":    postcodes,
		"region":       map[string]any{"name": "Bayern", "country": "Germany"},
	}}})
	require.NoError(t, err)
	return body
}

// servedPostcodes returns the postcodes of the first region in the response
// the backend builds from the cache.
func servedPostcodes(t *testing.T, s *Store) []string {
	t.Helper()
	regions, err := s.GetEnabledCachedRegions()
	require.NoError(t, err)
	body, err := BuildAvailableRegionsResponse(regions)
	require.NoError(t, err)
	var resp struct {
		Data struct {
			Regions []struct {
				Postcodes []string `json:"postcodes"`
			} `json:"regions"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(body, &resp))
	require.Len(t, resp.Data.Regions, 1)
	return resp.Data.Regions[0].Postcodes
}

func listed(t *testing.T, s *Store) []string {
	t.Helper()
	regions, err := s.GetEnabledCachedRegions()
	require.NoError(t, err)
	names := make([]string, 0, len(regions))
	for _, r := range regions {
		names = append(names, r.CountryCode+"/"+r.StateCode)
	}
	return names
}

func TestUpsertRegionsFromAPI_DropsCountriesMissingFromTheAnswer(t *testing.T) {
	s := NewStore(scratchDB(t))

	require.NoError(t, s.UpsertRegionsFromAPI(answer(t, [2]string{"DE", "bavaria"}, [2]string{"NL", "gelderland"})))
	require.NoError(t, s.UpsertRegionsFromAPI(answer(t, [2]string{"DE", "bavaria"})))

	assert.Equal(t, []string{"DE/bavaria"}, listed(t, s))
}

func TestUpsertRegionsFromAPI_EmptyAnswerListsNothing(t *testing.T) {
	s := NewStore(scratchDB(t))

	require.NoError(t, s.UpsertRegionsFromAPI(answer(t, [2]string{"DE", "bavaria"})))
	require.NoError(t, s.UpsertRegionsFromAPI(answer(t)))

	assert.Empty(t, listed(t, s))
}

func TestClearGridCounts_ListsNothingUntilTheNextAnswer(t *testing.T) {
	s := NewStore(scratchDB(t))
	require.NoError(t, s.UpsertRegionsFromAPI(answer(t, [2]string{"DE", "bavaria"})))

	require.NoError(t, s.ClearGridCounts())
	assert.Empty(t, listed(t, s))

	require.NoError(t, s.UpsertRegionsFromAPI(answer(t, [2]string{"DE", "nrw"})))
	assert.Equal(t, []string{"DE/nrw"}, listed(t, s))
}

func TestUpsertRegionsFromAPI_ServesTheLatestPostcodes(t *testing.T) {
	s := NewStore(scratchDB(t))

	require.NoError(t, s.UpsertRegionsFromAPI(postcodeAnswer(t, "94469")))
	assert.Equal(t, []string{"94469"}, servedPostcodes(t, s))

	require.NoError(t, s.UpsertRegionsFromAPI(postcodeAnswer(t, "94447", "94469")))
	assert.Equal(t, []string{"94447", "94469"}, servedPostcodes(t, s))
}
