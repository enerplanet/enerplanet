package pylovo

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestForwardPylovoError(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		name       string
		status     int
		body       string
		wantStatus int
		wantBody   string
	}{
		{"not found passes through with detail", http.StatusNotFound, `{"detail":"Grid not found"}`,
			http.StatusNotFound, `{"error":"Grid not found"}`},
		{"bad request passes through with detail", http.StatusBadRequest, `{"detail":"Invalid coordinates"}`,
			http.StatusBadRequest, `{"error":"Invalid coordinates"}`},
		{"422 with list detail falls back to generic", http.StatusUnprocessableEntity, `{"detail":[{"loc":["body"]}]}`,
			http.StatusUnprocessableEntity, `{"error":"Pylovo service responded with 422"}`},
		{"401 is clamped to 500", http.StatusUnauthorized, `{"detail":"Not authenticated"}`,
			http.StatusInternalServerError, `{"error":"Pylovo service responded with 401"}`},
		{"502 is clamped to 500", http.StatusBadGateway, `{"detail":"upstream down"}`,
			http.StatusInternalServerError, `{"error":"Pylovo service responded with 502"}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(rec)

			forwardPylovoError(c, tc.status, []byte(tc.body))

			if rec.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if rec.Body.String() != tc.wantBody {
				t.Errorf("body = %s, want %s", rec.Body.String(), tc.wantBody)
			}
		})
	}
}
