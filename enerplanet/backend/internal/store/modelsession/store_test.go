package modelsession

import (
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"gorm.io/datatypes"

	"spatialhub_backend/internal/models"
	"spatialhub_backend/internal/testutil"
)

// The upsert's DO UPDATE set IS the preserve/overwrite decision for every column, so it is asserted
// literally: every artefact field is overwritten (the artefact is a whole document, not a patch),
// and created_at is deliberately absent, so the row keeps the moment the session began.
//
// Captured from the generated SQL rather than guessed: GORM puts the primary key LAST in the INSERT
// column list and, because ModelID is not auto-increment, uses RETURNING — so this is a Query, not
// an Exec.
const saveSQL = `INSERT INTO "model_sessions" \("workflow_id","workflow_version","initial","projection","log","discarded","cursor","fingerprint","created_at","updated_at","model_id"\) VALUES \(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11\) ON CONFLICT \("model_id"\) DO UPDATE SET "workflow_id"="excluded"\."workflow_id","workflow_version"="excluded"\."workflow_version","initial"="excluded"\."initial","projection"="excluded"\."projection","log"="excluded"\."log","discarded"="excluded"\."discarded","cursor"="excluded"\."cursor","fingerprint"="excluded"\."fingerprint","updated_at"="excluded"\."updated_at" RETURNING "model_id"`

func sampleSession() *models.ModelSession {
	now := time.Now()
	return &models.ModelSession{
		ModelID:         7,
		WorkflowID:      "wf-core",
		WorkflowVersion: 3,
		Initial:         datatypes.JSON([]byte(`{}`)),
		Projection:      datatypes.JSON([]byte(`{"modelName":"demo"}`)),
		Log:             datatypes.JSON([]byte(`[{"revision":1,"primary":[],"cascade":[]}]`)),
		Discarded:       datatypes.JSON([]byte(`[]`)),
		Cursor:          1,
		Fingerprint:     "fp-abc",
		CreatedAt:       now,
		UpdatedAt:       now,
	}
}

func TestSaveUpsertsTheWholeArtefact(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	row := sampleSession()

	mock.ExpectBegin()
	mock.ExpectQuery(saveSQL).
		WithArgs(
			row.WorkflowID, row.WorkflowVersion,
			// The JSONB columns and the timestamps are pinned by the SQL above (their presence in
			// the column list is the decision worth asserting); their values are covered verbatim by
			// the handler test, which is where the request shape is checked.
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			row.Cursor, row.Fingerprint,
			sqlmock.AnyArg(), sqlmock.AnyArg(), row.ModelID,
		).
		WillReturnRows(sqlmock.NewRows([]string{"model_id"}).AddRow(row.ModelID))
	mock.ExpectCommit()

	if err := NewStore(db).Save(row); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestGetReturnsNilWhenTheModelHasNoSession(t *testing.T) {
	db, mock := testutil.NewMockDB(t)

	// A legacy model has no row, and that is an answer rather than an error.
	mock.ExpectQuery(`SELECT \* FROM "model_sessions" WHERE model_id = \$1`).
		WithArgs(uint(7), 1).
		WillReturnRows(sqlmock.NewRows([]string{"model_id"}))

	row, err := NewStore(db).Get(7)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if row != nil {
		t.Fatalf("want nil for a model with no session, got %+v", row)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestGetReadsTheStoredArtefact(t *testing.T) {
	db, mock := testutil.NewMockDB(t)
	stored := sampleSession()

	mock.ExpectQuery(`SELECT \* FROM "model_sessions" WHERE model_id = \$1`).
		WithArgs(uint(7), 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"model_id", "workflow_id", "workflow_version", "initial", "projection", "log",
			"discarded", "cursor", "fingerprint", "created_at", "updated_at",
		}).AddRow(
			stored.ModelID, stored.WorkflowID, stored.WorkflowVersion, stored.Initial,
			stored.Projection, stored.Log, stored.Discarded, stored.Cursor, stored.Fingerprint,
			stored.CreatedAt, stored.UpdatedAt,
		))

	row, err := NewStore(db).Get(7)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if row == nil {
		t.Fatal("want the stored session, got nil")
	}
	if row.Cursor != 1 || row.WorkflowID != "wf-core" || string(row.Projection) != `{"modelName":"demo"}` {
		t.Errorf("unexpected round-trip: %+v", row)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestHasSessionMarksOnlyTheModelsThatHaveOne(t *testing.T) {
	db, mock := testutil.NewMockDB(t)

	mock.ExpectQuery(`SELECT "model_id" FROM "model_sessions" WHERE model_id IN \(\$1,\$2\)`).
		WithArgs(uint(7), uint(9)).
		WillReturnRows(sqlmock.NewRows([]string{"model_id"}).AddRow(uint(7)))

	found, err := NewStore(db).HasSession([]uint{7, 9})
	if err != nil {
		t.Fatalf("HasSession: %v", err)
	}
	if !found[7] || found[9] {
		t.Errorf("want only model 7 marked, got %+v", found)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
