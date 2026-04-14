package render

import (
	"net/http"
	"spatialhub_backend/internal/config"

	"github.com/gin-gonic/gin"
)

type RenderHandler struct {
	cfg *config.Config
}

func New(
	cfg *config.Config,
) *RenderHandler {
	return &RenderHandler{
		cfg: cfg,
	}
}

func (r *RenderHandler) SuccessLogin(c *gin.Context) {
	userID, _ := c.Get("user_id")
	userEmail, _ := c.Get("user_email")
	c.HTML(http.StatusOK, "login/success.tmpl", gin.H{
		"Title":        "Login Successful",
		"Message":      "You have successfully logged in!",
		"Username":     userID,
		"Email":        userEmail,
		"DashboardURL": "/dashboard",
		"LogoutURL":    "/logout",
	})
}
