package model

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"spatialhub_backend/internal/bearerauth"
	"spatialhub_backend/internal/middleware"
	"spatialhub_backend/internal/testutil"
)

// Links partner user "partner-x" to local expert account "x".
type linkedExperts struct{}

func (linkedExperts) Resolve(id *bearerauth.Identity) (*bearerauth.Account, error) {
	local := strings.TrimPrefix(id.Subject, "partner-")
	return &bearerauth.Account{ID: local, Email: local + "@example.com", AccessLevel: "expert"}, nil
}

func TestBearerModelAccessIsPerUser(t *testing.T) {
	f := testutil.NewOIDCFixture(t)
	v, err := bearerauth.New(bearerauth.Options{Issuer: f.Issuer, ClientID: "toolbox", IdentityProvider: "renvolveit", CacheTTL: time.Minute, AllowHTTP: true})
	require.NoError(t, err)
	for _, tc := range []struct {
		name, subject string
		status        int
	}{
		{"owner", "user-a", 200},
		{"other user even with expert account", "user-b", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock := testutil.NewMockDB(t)
			mock.ExpectQuery(`SELECT \* FROM "models" WHERE id = \$1`).WithArgs("12", 1).
				WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "user_email", "title"}).AddRow(12, "user-a", "user-a@example.com", "Model A"))
			mock.ExpectQuery(`SELECT \* FROM "model_shares" WHERE "model_shares"."model_id" = \$1`).WithArgs(12).
				WillReturnRows(sqlmock.NewRows([]string{"id", "model_id"}))
			if tc.status == 200 {
				mock.ExpectQuery(`SELECT "id" FROM "models" WHERE \(parent_model_id = \$1`).WithArgs(12).
					WillReturnRows(sqlmock.NewRows([]string{"id"}))
				mock.ExpectQuery(`SELECT \* FROM "model_meme_runs"`).WillReturnRows(sqlmock.NewRows([]string{"id", "model_id"}))
			} else {
				mock.ExpectQuery(`SELECT count\(\*\) FROM "model_shares"`).WithArgs(12, tc.subject, tc.subject+"@example.com").
					WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
			}
			router := gin.New()
			router.Use(middleware.BearerAuth(v, linkedExperts{}), middleware.AuthServiceMiddleware())
			router.GET("/api/models/:id", NewModelHandlerWithCache(db, nil, nil, "http://kc", "realm", nil, nil, nil).GetModel)
			req := httptest.NewRequest("GET", "/api/models/12", nil)
			req.Header.Set("Authorization", "Bearer "+f.Sign(t, f.Claims("partner-"+tc.subject)))
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			require.Equal(t, tc.status, w.Code, w.Body.String())
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
