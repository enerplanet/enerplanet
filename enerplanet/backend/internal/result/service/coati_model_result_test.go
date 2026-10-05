package resultservice

import (
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// TestReplaceModelResultRow_DeletesThenInserts guards defect 3: the MEME/Coati
// ingest must record the ModelResult row the results list + download endpoints
// read. The row is replaced (delete-then-create) so a re-run never accumulates
// rows. Field values are exercised end-to-end by the live ingest; this pins the
// statement surface.
func TestReplaceModelResultRow_DeletesThenInserts(t *testing.T) {
	conn, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })

	db, err := gorm.Open(postgres.New(postgres.Config{Conn: conn}), &gorm.Config{SkipDefaultTransaction: true})
	require.NoError(t, err)

	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM "model_results"`)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(`INSERT INTO "model_results"`)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))

	err = replaceModelResultRow(db, 7, "u1", "/data/model_7_1/sim_7.zip", "/data/model_7_1", 1234, []byte(`{"objective":1}`))
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}
