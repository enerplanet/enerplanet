package result

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"spatialhub_backend/internal/bearerauth"
	"spatialhub_backend/internal/middleware"
	"spatialhub_backend/internal/testutil"
)

func TestBearerResultAccessIsPerUser(t *testing.T) {
	f := testutil.NewOIDCFixture(t)
	v, err := bearerauth.New(bearerauth.Options{Issuer: f.Issuer, Audience: "enerplanet-api", ClientID: "renvolveit-toolbox", CacheTTL: time.Minute, AllowHTTP: true})
	require.NoError(t, err)
	for _, tc := range []struct {
		name, subject string
		status        int
	}{
		{"owner", "user-a", 200},
		{"other user even with expert claim", "user-b", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock := testutil.NewMockDB(t)
			modelRows := func() *sqlmock.Rows {
				return sqlmock.NewRows([]string{"id", "user_id", "user_email"}).AddRow(12, "user-a", "user-a@example.com")
			}
			mock.ExpectQuery(`SELECT \* FROM "models" WHERE id = \$1`).WithArgs("12", 1).WillReturnRows(modelRows())
			mock.ExpectQuery(`SELECT \* FROM "models" WHERE id = \$1`).WithArgs(12, 1).WillReturnRows(modelRows())
			mock.ExpectQuery(`SELECT count\(\*\) FROM "model_shares"`).WithArgs(12, tc.subject, tc.subject+"@example.com").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
			if tc.status == 200 {
				mock.ExpectQuery(`SELECT \* FROM "model_results" WHERE model_id = \$1`).WithArgs(12).WillReturnRows(sqlmock.NewRows([]string{"id", "model_id", "user_id"}).AddRow(7, 12, "user-a"))
			}
			router := gin.New()
			router.Use(middleware.BearerAuth(v), middleware.AuthServiceMiddleware())
			router.GET("/api/models/:id/results", NewResultHandler(db, nil, nil, "", nil).GetModelResults)
			claims := f.Claims(tc.subject)
			claims["access_level"] = "expert"
			req := httptest.NewRequest("GET", "/api/models/12/results", nil)
			req.Header.Set("Authorization", "Bearer "+f.Sign(t, claims))
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			require.Equal(t, tc.status, w.Code, w.Body.String())
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
