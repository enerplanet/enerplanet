//go:build integration

// Needs PostgreSQL at TEST_DATABASE_URL (e.g. 'host=localhost port=5433 user=postgres password=postgres dbname=spatialai').
// Run with: go test -tags integration ./internal/store/series/
// Each test works in a scratch schema inside one transaction that is rolled back.
package series

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// scratchDB opens TEST_DATABASE_URL, starts a transaction, creates the series
// tables in a scratch schema ahead of public (where models lives) and rolls it
// all back when the test ends.
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

	migration, err := os.ReadFile("../../../migrations/049_create_series_tables.sql")
	require.NoError(t, err)
	require.NoError(t, tx.Exec("CREATE SCHEMA series_it").Error)
	require.NoError(t, tx.Exec("SET LOCAL search_path TO series_it, public").Error)
	require.NoError(t, tx.Exec(string(migration)).Error)
	return tx
}

func buemProfile(key string, heating ...float32) NewProfile {
	return NewProfile{
		Key: key, Origin: "buem", ProducerVersion: "6.10.0+21f79d7",
		StartTime: time.Date(1900, 1, 1, 0, 0, 0, 0, time.UTC), ResolutionMinutes: 60,
		Series: map[string]SeriesData{
			"heating":     {Unit: "kWh", Values: heating},
			"electricity": {Unit: "kWh", Values: []float32{0.25, 0.5}},
		},
	}
}

func TestSave_StoresOnceAndKeepsTheFirstValues(t *testing.T) {
	s := NewStore(scratchDB(t))

	first, err := s.Save(buemProfile("key-a", 1.5, 2.25))
	require.NoError(t, err)
	again, err := s.Save(buemProfile("key-a", 9, 9))
	require.NoError(t, err)
	assert.Equal(t, first, again)

	v, err := s.Values(first, "heating")
	require.NoError(t, err)
	assert.Equal(t, "kWh", v.Unit)
	assert.Equal(t, []float32{1.5, 2.25}, []float32(v.Vals))
}

func TestStoredKeys_ReturnsOnlyStoredKeys(t *testing.T) {
	s := NewStore(scratchDB(t))
	id, err := s.Save(buemProfile("key-a", 1))
	require.NoError(t, err)

	found, err := s.StoredKeys([]string{"key-a", "key-missing"})
	require.NoError(t, err)
	assert.Equal(t, map[string]int64{"key-a": id}, found)
}

func TestLink_ReplacesTheSameSeriesAndKeepsOwnersApart(t *testing.T) {
	tx := scratchDB(t)
	s := NewStore(tx)
	a, err := s.Save(buemProfile("key-a", 1))
	require.NoError(t, err)
	b, err := s.Save(buemProfile("key-b", 2))
	require.NoError(t, err)
	var modelID uint
	require.NoError(t, tx.Raw(`INSERT INTO models (user_id, user_email, title, country, from_date, to_date)
		VALUES ('u', 'u@example.de', 'series test', 'netherlands', now(), now()) RETURNING id`).Scan(&modelID).Error)

	draft := Owner{DraftID: "draft-1"}
	model := Owner{ModelID: modelID}
	heat := Link{BuildingRef: "268426401", Series: "heating", ProfileID: a, Source: "default"}
	require.NoError(t, s.Link(draft, "rev-1", []Link{heat}))
	require.NoError(t, s.Link(model, "rev-1", []Link{heat}))

	heat.ProfileID, heat.Source = b, "user"
	require.NoError(t, s.Link(draft, "rev-2", []Link{heat}))

	draftLinks, err := s.Links(draft)
	require.NoError(t, err)
	require.Len(t, draftLinks, 1)
	assert.Equal(t, b, draftLinks[0].ProfileID)
	assert.Equal(t, "user", draftLinks[0].Source)
	assert.Equal(t, "rev-2", draftLinks[0].Revision)

	modelLinks, err := s.Links(model)
	require.NoError(t, err)
	require.Len(t, modelLinks, 1)
	assert.Equal(t, a, modelLinks[0].ProfileID)

	require.NoError(t, tx.Exec("DELETE FROM models WHERE id = ?", modelID).Error)
	modelLinks, err = s.Links(model)
	require.NoError(t, err)
	assert.Empty(t, modelLinks, "deleting a model removes its links")
}

func TestSave_OwnerMatchesOrigin(t *testing.T) {
	tx := scratchDB(t)
	s := NewStore(tx)

	upload := buemProfile("key-upload", 1)
	upload.Origin = "uploaded"
	_, err := s.Save(upload)
	assert.Error(t, err, "an upload needs its owner")

	generated := buemProfile("key-generated", 1)
	generated.OwnerUserID = "u"
	_, err = s.Save(generated)
	assert.Error(t, err, "a generated profile has no owner")
}

func TestLinkedSeries_JoinsLinksProfilesAndValues(t *testing.T) {
	s := NewStore(scratchDB(t))
	id, err := s.Save(buemProfile("key-a", 1.5, 2.25))
	require.NoError(t, err)
	draft := Owner{DraftID: "draft-1"}
	require.NoError(t, s.Link(draft, "rev-1", []Link{
		{BuildingRef: "268426401", Series: "heating", ProfileID: id, Source: "default"},
		{BuildingRef: "268426401", Series: "electricity", ProfileID: id, Source: "default"},
		{BuildingRef: "268426402", Series: "heating", ProfileID: id, Source: "user"},
	}))

	one, err := s.LinkedSeries(draft, "268426401")
	require.NoError(t, err)
	require.Len(t, one, 2)
	assert.Equal(t, "electricity", one[0].Series)
	assert.Equal(t, []float32{0.25, 0.5}, []float32(one[0].Vals))
	assert.Equal(t, "heating", one[1].Series)
	assert.Equal(t, []float32{1.5, 2.25}, []float32(one[1].Vals))
	assert.Equal(t, 60, one[1].ResolutionMinutes)
	assert.Equal(t, "kWh", one[1].Unit)

	all, err := s.LinkedSeries(draft, "")
	require.NoError(t, err)
	assert.Len(t, all, 3)

	none, err := s.LinkedSeries(draft, "missing")
	require.NoError(t, err)
	assert.Empty(t, none)
}
