package demand

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	seriesstore "spatialhub_backend/internal/store/series"
)

func linked(ref, name, part string, values ...float32) seriesstore.LinkedSeries {
	version := "6.10.0+21f79d7"
	return seriesstore.LinkedSeries{
		BuildingRef: ref, Part: part, Series: name, Source: "default", ProducerVersion: &version,
		StartTime: time.Date(1900, 1, 1, 0, 0, 0, 0, time.UTC), ResolutionMinutes: 60, Unit: "kW", Vals: values,
	}
}

func TestSummariseLinked_CarriesSourceVersionAndPositiveCooling(t *testing.T) {
	got, err := Summaries([]seriesstore.LinkedSeries{
		linked("268426401", "cooling", "", -1, -3),
		linked("268426401", "heating", "", 2, 4),
	})
	require.NoError(t, err)
	require.Len(t, got, 2)
	assert.Equal(t, "cooling", got[0].Name)
	assert.Equal(t, 4.0, got[0].Total)
	assert.Equal(t, 3.0, got[0].Peak)
	assert.Equal(t, "default", got[1].Source)
	assert.Equal(t, "6.10.0+21f79d7", got[1].ProducerVersion)
	assert.Equal(t, "kWh", got[1].EnergyUnit)
}

func TestFindSeries_MatchesNameAndPart(t *testing.T) {
	all := []seriesstore.LinkedSeries{linked("b", "pv", "roof-1", 1), linked("b", "pv", "roof-2", 2)}
	got, ok := FindSeries(all, "pv", "roof-2")
	require.True(t, ok)
	assert.Equal(t, []float32{2}, []float32(got.Vals))
	_, ok = FindSeries(all, "pv", "")
	assert.False(t, ok)
}

func TestWriteBuildingCSV_NamesRoofFaces(t *testing.T) {
	var buf bytes.Buffer
	require.NoError(t, WriteBuildingCSV(&buf, []seriesstore.LinkedSeries{
		linked("b", "heating", "", 1), linked("b", "pv", "roof-1", 0.5),
	}))
	assert.Equal(t, "timestamp,heating [kW],pv:roof-1 [kW]", strings.SplitN(buf.String(), "\n", 2)[0])
}

func TestWriteModelZip_OneCSVPerBuilding(t *testing.T) {
	var buf bytes.Buffer
	require.NoError(t, WriteModelZip(&buf, 7, []seriesstore.LinkedSeries{
		linked("a", "heating", "", 1), linked("a", "electricity", "", 2), linked("b", "heating", "", 3),
	}))
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	require.NoError(t, err)
	require.Len(t, zr.File, 2)
	assert.Equal(t, "model-7-a.csv", zr.File[0].Name)
	f, err := zr.File[0].Open()
	require.NoError(t, err)
	content, err := io.ReadAll(f)
	require.NoError(t, err)
	assert.Equal(t, "timestamp,electricity [kW],heating [kW]\n1900-01-01T00:00:00Z,2,1\n", string(content))
}
