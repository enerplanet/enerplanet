package main

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"go.uber.org/automaxprocs/maxprocs"

	"spatialhub_backend/internal/cache"
	"spatialhub_backend/internal/config"
	feedback "spatialhub_backend/internal/handler/feedback"
	grouphandler "spatialhub_backend/internal/handler/group"
	locationhandler "spatialhub_backend/internal/handler/location"
	notificationshandler "spatialhub_backend/internal/handler/notifications"
	"spatialhub_backend/internal/handler/pylovo"
	"spatialhub_backend/internal/handler/render"
	settingshandler "spatialhub_backend/internal/handler/settings"
	technologyhandler "spatialhub_backend/internal/handler/technology"
	usershandler "spatialhub_backend/internal/handler/users"
	"spatialhub_backend/internal/handler/weather"
	"spatialhub_backend/internal/middleware"
	modelhandler "spatialhub_backend/internal/model/handler"
	resulthandler "spatialhub_backend/internal/result/handler"
	"spatialhub_backend/internal/services"
	feedbackstore "spatialhub_backend/internal/store/feedback"
	pylovoinstance "spatialhub_backend/internal/store/pylovo_instance"
	region "spatialhub_backend/internal/store/region"
	"spatialhub_backend/internal/webservice"
	"spatialhub_backend/internal/worker"
	workspacehandler "spatialhub_backend/internal/workspace/handler"

	"platform.local/common/pkg/httputil"
	authplatform "platform.local/platform/auth"
	platformconfig "platform.local/platform/config"
	platformdatabase "platform.local/platform/database"
	platformemail "platform.local/platform/email"
	platformlogger "platform.local/platform/logger"
	platformproxy "platform.local/platform/proxy"
	platformsecurity "platform.local/platform/security"
	platformserver "platform.local/platform/server"
	platformsession "platform.local/platform/session"
	redisstore "platform.local/platform/session/redis"
	platformworker "platform.local/platform/worker"

	_ "spatialhub_backend/docs"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
	goredis "github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
	"gorm.io/gorm"
)

// API route constants
const (
	routeSettings       = "/settings"
	routeFeedbackByID   = "/feedback/:id"
	routeUsersByID      = "/users/:id"
	routeWorkspaceByID  = "/workspaces/:id"
	routeGroupByID      = "/groups/:id"
	routeMembers        = "/members"
	routeGroups         = "/groups"
	routeModelByID      = "/models/:id"
	routeTechnologyByID = "/technologies/:id"
)

const (
	headerContentType                   = "Content-Type"
	headerAccept                        = "Accept"
	headerSetCookie                     = "Set-Cookie"
	headerAccessControlAllowOrigin      = "access-control-allow-origin"
	headerAccessControlAllowCredentials = "access-control-allow-credentials"
	headerAccessControlAllowMethods     = "access-control-allow-methods"
	headerAccessControlAllowHeaders     = "access-control-allow-headers"
	headerAccessControlExposeHeaders    = "access-control-expose-headers"
	errCreateProxyRequest               = "Failed to create proxy request"
	errReachAuthServiceMsg              = "Failed to reach auth service"
)

// @title           EnerPlanET API
// @version         1.0
// @description     Unified API for the EnerPlanET energy planning platform.
// @description     Includes native backend endpoints and proxied Pylovo (grid/boundary) services.

// @BasePath  /api

// @securityDefinitions.apikey SessionAuth
// @in   cookie
// @name session_id
// @description Session cookie obtained via POST /api/login

func main() {
	// Set GIN to release mode to disable debug messages
	gin.SetMode(gin.ReleaseMode)

	// Automatically set GOMAXPROCS to match container CPU quota (silenced)
	maxprocs.Set(maxprocs.Logger(func(string, ...interface{}) {}))

	if err := platformlogger.Init("logs", "app"); err != nil {
		panic(fmt.Sprintf("failed to init logger: %v", err))
	}
	log := platformlogger.Logger

	cfg, err := config.LoadFromEnv()
	if err != nil {
		log.Fatalf("failed to load and parse config : %v", err)
		return
	}

	platformconfig.SetupTimezone(cfg.AppTimezone, log)
	serverAddr := fmt.Sprintf("%s:%s", cfg.AppHost, cfg.AppPort)

	appDeps := initializeInfrastructure(cfg, log)
	defer appDeps.Close()

	r := setupGinEngine(cfg, log)
	renderHandler := render.New(cfg)

	configureRoutes(r, cfg, appDeps, renderHandler)

	// Start background cleanup for old closed/resolved feedback (every 24h, deletes after 7 days)
	go startFeedbackCleanup(appDeps.DB, log)

	srv := platformserver.NewHTTPServer(platformserver.HTTPServerConfig{
		Addr:         serverAddr,
		Handler:      r,
		ReadTimeout:  300 * time.Second, // Allow large file uploads (callback zip)
		WriteTimeout: 60 * time.Second,  // SSE routes opt out per-connection via ResponseController
	})

	platformserver.RunWithGracefulShutdown(srv, log, 10*time.Second)
}

// AppDependencies holds all infrastructure connections and their cleanup functions
type AppDependencies struct {
	DB                  *gorm.DB
	SQLdb               *sql.DB
	RedisClient         *goredis.Client
	AsynqClient         *asynq.Client
	AsynqServer         *asynq.Server
	AdminTokenProvider  *authplatform.AdminTokenProvider
	NotificationService *services.NotificationService
	WebserviceClient    *webservice.Client
	KeycloakCache       *cache.KeycloakCacheService
	SyncCache           *cache.SyncCacheService
	Cfg                 *config.Config
}

// Close properly closes all infrastructure connections
func (d *AppDependencies) Close() {
	if d.SQLdb != nil {
		_ = d.SQLdb.Close()
	}
	if d.RedisClient != nil {
		_ = d.RedisClient.Close()
	}
	if d.AsynqClient != nil {
		_ = d.AsynqClient.Close()
	}
	if d.AsynqServer != nil {
		d.AsynqServer.Shutdown()
	}
}

// initializeInfrastructure sets up database, Redis, auth, and async workers
func initializeInfrastructure(cfg *config.Config, log *logrus.Logger) *AppDependencies {
	db, sqlDB, err := platformdatabase.ConnectWithPing(cfg.Database)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	log.WithField("component", "startup").Info("Database connection successful")

	// Configure connection pool
	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetConnMaxLifetime(time.Hour)

	ctx := context.Background()
	redisClient, err := platformdatabase.ConnectRedis(ctx, cfg.RedisConfig)
	if err != nil {
		log.Fatalf("failed to connect to Redis: %v", err)
	}

	asynqRedisOpt := asynq.RedisClientOpt{
		Addr:     cfg.RedisConfig.Addr,
		Password: cfg.RedisConfig.Password,
		DB:       cfg.RedisConfig.DB,
	}

	asynqClient := platformworker.NewClient(asynqRedisOpt)

	asynqServer := platformworker.NewServer(platformworker.ServerConfig{
		RedisOpt:    asynqRedisOpt,
		Concurrency: 10,
		Queues: map[string]int{
			"notifications": 5,
			"results":       3,
		},
	})

	adminTokenProvider := authplatform.NewAdminTokenProvider(
		cfg.Auth.BaseURL,
		cfg.Auth.Realm,
		cfg.Auth.ClientID,
		cfg.Auth.ClientSecret,
	)

	emailService := platformemail.NewEmailService(platformemail.SMTPConfig{
		Host:      cfg.Email.SMTPHost,
		Port:      cfg.Email.SMTPPort,
		Username:  cfg.Email.SMTPUsername,
		Password:  cfg.Email.SMTPPassword,
		FromEmail: cfg.Email.SMTPFromEmail,
		FromName:  cfg.Email.SMTPFromName,
		UseTLS:    cfg.Email.SMTPUseTLS,
	})

	notificationService := services.NewNotificationService(db, emailService, redisClient, nil)
	webserviceClient := webservice.NewClient(cfg.WebserviceServiceURL)

	taskProcessor := worker.NewTaskProcessor(db, redisClient, notificationService, webserviceClient)
	mux := asynq.NewServeMux()
	mux.HandleFunc("broadcast_notification", taskProcessor.ProcessTask)
	mux.HandleFunc("process_result", taskProcessor.ProcessTask)

	go func() {
		if err := asynqServer.Run(mux); err != nil {
			log.Fatalf("Failed to run Asynq server: %v", err)
		}
	}()

	keycloakCache := cache.NewKeycloakCacheService(redisClient)
	syncCache := cache.NewSyncCacheService(redisClient)

	return &AppDependencies{
		DB:                  db,
		SQLdb:               sqlDB,
		RedisClient:         redisClient,
		AsynqClient:         asynqClient,
		AsynqServer:         asynqServer,
		AdminTokenProvider:  adminTokenProvider,
		NotificationService: notificationService,
		WebserviceClient:    webserviceClient,
		KeycloakCache:       keycloakCache,
		SyncCache:           syncCache,
		Cfg:                 cfg,
	}
}

// setupGinEngine creates and configures the Gin engine with middleware
func setupGinEngine(cfg *config.Config, log *logrus.Logger) *gin.Engine {
	trusted := []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"}

	r, err := platformserver.InitGin(trusted, platformsecurity.SecurityHeaders())
	if err != nil {
		log.Warnf("Failed to set trusted proxies: %v", err)
	}

	allowedOrigins := platformserver.BuildCORSOrigins(cfg.AppURL)
	originSet := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		originSet[origin] = struct{}{}
	}

	corsConfig := cors.Config{
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", headerContentType, headerAccept, "Authorization", "X-Requested-With", "X-CSRF-Token"},
		ExposeHeaders:    []string{"Content-Length", "Content-Type"},
		AllowCredentials: true,
	}

	corsConfig.AllowOriginFunc = func(origin string) bool {
		if origin == "" {
			return false
		}
		if len(originSet) == 0 {
			return false
		}
		_, ok := originSet[origin]
		return ok
	}

	r.Use(cors.New(corsConfig))
	r.Use(middleware.RequestMetrics())
	r.Use(middleware.RateLimit())

	return r
}

// configureRoutes sets up all application routes
func configureRoutes(r *gin.Engine, cfg *config.Config, deps *AppDependencies, renderHandler *render.RenderHandler) {
	configurePublicAPI(r, cfg, deps)

	sessionStore := redisstore.NewSessionRedisManager(deps.RedisClient, cfg.SessionTTLMinutes)

	routeDeps := RouteDeps{
		Cfg:                 cfg,
		DB:                  deps.DB,
		SessionStore:        sessionStore,
		AsynqClient:         deps.AsynqClient,
		RedisClient:         deps.RedisClient,
		AdminTokenProvider:  deps.AdminTokenProvider,
		NotificationService: deps.NotificationService,
		WebserviceClient:    deps.WebserviceClient,
		KeycloakCache:       deps.KeycloakCache,
		SyncCache:           deps.SyncCache,
	}
	configureProtectedAPI(r, routeDeps)

	protected := r.Group("/")
	{
		protected.GET("/success-login", renderHandler.SuccessLogin)
	}

	r.Static("/assets", "./www/assets")
	r.Static("/images", "./www/images")
	r.StaticFile("/vite.svg", "./www/vite.svg")

	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if len(path) >= 4 && path[:4] == "/api" {
			c.JSON(404, gin.H{"error": "API endpoint not found"})
			return
		}
		c.File("./www/index.html")
	})
}

func makeWebserviceProxyHandler(client *webservice.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		userCtx, ok := httputil.GetUserContext(c)
		if !ok {
			httputil.Unauthorized(c, "Missing or invalid session")
			return
		}

		body, err := readRequestBody(c.Request.Body)
		if err != nil {
			httputil.InternalError(c, "Failed to read request body")
			return
		}

		headers := buildWebserviceProxyHeaders(c.Request.Header, userCtx)
		path := buildProxyPath(c.Request.URL)

		resp, err := client.Forward(c.Request.Context(), c.Request.Method, path, body, headers)
		if err != nil {
			platformlogger.Logger.WithFields(logrus.Fields{
				"component": "webservice_proxy",
				"error":     err,
				"target":    client.BaseURL(),
				"path":      path,
			}).Warn("Webservice request failed")
			httputil.ErrorResponse(c, http.StatusBadGateway, "Webservice request failed")
			return
		}

		if err := writeProxyResponse(c, resp); err != nil {
			platformlogger.Logger.WithFields(logrus.Fields{
				"component": "webservice_proxy",
				"error":     err,
			}).Warn("Failed to write response")
		}
	}
}

func readRequestBody(body io.ReadCloser) ([]byte, error) {
	if body == nil {
		return nil, nil
	}
	return io.ReadAll(body)
}

func buildWebserviceProxyHeaders(src http.Header, userCtx *httputil.UserContext) http.Header {
	headers := make(http.Header)
	copyHeaderIfPresent(headers, src, headerContentType)
	copyHeaderIfPresent(headers, src, headerAccept)
	addForwardableHeaders(headers, src)
	setUserContextHeaders(headers, userCtx)
	return headers
}

func addForwardableHeaders(dst, src http.Header) {
	for key, values := range src {
		if shouldSkipForwardHeader(key) {
			continue
		}
		for _, v := range values {
			dst.Add(key, v)
		}
	}
}

func shouldSkipForwardHeader(key string) bool {
	lower := strings.ToLower(key)
	switch lower {
	case strings.ToLower(headerContentType), strings.ToLower(headerAccept), "content-length", "host", "cookie", "authorization":
		return true
	default:
		return false
	}
}

func setUserContextHeaders(headers http.Header, userCtx *httputil.UserContext) {
	headers.Set("X-User-ID", userCtx.UserID)
	headers.Set("X-User-Email", userCtx.Email)
	headers.Set("X-User-Name", userCtx.Name)
	headers.Set("X-Access-Level", userCtx.AccessLevel)
	headers.Set("X-Group-ID", userCtx.GroupID)
}

func buildProxyPath(u *url.URL) string {
	if u == nil {
		return ""
	}
	path := u.Path
	if rawQuery := u.RawQuery; rawQuery != "" {
		path += "?" + rawQuery
	}
	return path
}

func writeProxyResponse(c *gin.Context, resp *http.Response) error {
	defer resp.Body.Close()
	copyResponseHeaders(c.Writer.Header(), resp.Header)
	c.Writer.WriteHeader(resp.StatusCode)
	_, err := io.Copy(c.Writer, resp.Body)
	return err
}

func copyResponseHeaders(dst http.Header, src http.Header) {
	for key, values := range src {
		lower := strings.ToLower(key)
		// Skip headers that should not be copied from proxied responses
		if lower == "content-length" || lower == "connection" ||
			lower == headerAccessControlAllowOrigin ||
			lower == headerAccessControlAllowCredentials ||
			lower == headerAccessControlAllowMethods ||
			lower == headerAccessControlAllowHeaders ||
			lower == headerAccessControlExposeHeaders {
			continue
		}
		for _, v := range values {
			dst.Add(key, v)
		}
	}
}

func copyHeaderIfPresent(dst http.Header, src http.Header, key string) {
	if val := src.Get(key); val != "" {
		dst.Set(key, val)
	}
}

// configurePublicAPI registers public API routes and related middleware.
func configurePublicAPI(r *gin.Engine, cfg *config.Config, deps *AppDependencies) {
	db := deps.DB
	api := r.Group("/api")

	api.GET("/health", platformserver.HealthHandler("backend"))

	// Swagger UI
	api.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	authProxy := platformproxy.MustNewHandler(cfg.AuthServiceURL, platformproxy.HandlerOptions{
		Component:            "auth_proxy",
		ForwardCookies:       true,
		RequestHeaderMutator: platformproxy.CopyHeadersExcept("Cookie"),
		ResponseHeaderMutator: platformproxy.CopyHeadersSkipping(map[string]struct{}{
			headerAccessControlAllowOrigin:      {},
			headerAccessControlAllowCredentials: {},
			headerAccessControlAllowMethods:     {},
			headerAccessControlAllowHeaders:     {},
			headerAccessControlExposeHeaders:    {},
		}),
	})
	registerAuthRoutes(api, authProxy)

	resultHandler := resulthandler.NewResultHandler(db, deps.NotificationService, deps.WebserviceClient, cfg.CallbackSecret, deps.AsynqClient)
	api.POST("/v1/calculation/callback/:id", middleware.CallbackAuthMiddleware(), resultHandler.CallbackUpload)

	// Public Pylovo routes (no authentication required)
	regionStore := region.NewStore(db)
	pylovoInstanceStore := pylovoinstance.NewStore(db)
	pylovoHandler := pylovo.NewPylovoHandler(cfg.PylovoServiceURL, regionStore, pylovoInstanceStore)
	api.GET("/v2/pylovo/boundary", pylovoHandler.GetBoundary)
	api.GET("/v2/pylovo/boundary/regions", pylovoHandler.GetSupportedRegions)
	api.GET("/v2/pylovo/boundary/available", pylovoHandler.GetAvailableRegions)

	// Public feedback endpoint (landing page contact form, no auth required)
	publicFeedbackHandler := feedback.NewFeedbackHandler(db)
	api.POST("/feedback/public", publicFeedbackHandler.CreatePublicFeedback)
}

// RouteDeps aggregates dependencies required for configuring protected API routes.
type RouteDeps struct {
	Cfg                 *config.Config
	DB                  *gorm.DB
	SessionStore        platformsession.SessionStore
	AsynqClient         *asynq.Client
	RedisClient         *goredis.Client
	AdminTokenProvider  *authplatform.AdminTokenProvider
	NotificationService *services.NotificationService
	WebserviceClient    *webservice.Client
	KeycloakCache       *cache.KeycloakCacheService
	SyncCache           *cache.SyncCacheService
}

// configureProtectedAPI registers protected API routes that require a valid session.
func configureProtectedAPI(r *gin.Engine, deps RouteDeps) {
	protectedAPI := r.Group("/api")
	protectedAPI.Use(middleware.AuthServiceMiddleware())

	protectedAPI.GET("/auth/keep-alive", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	feedbackHandler := feedback.NewFeedbackHandler(deps.DB)
	usersHandler := usershandler.New(deps.Cfg, deps.DB, deps.SessionStore, deps.AdminTokenProvider)
	settingsHandler := settingshandler.NewSettingsHandler(deps.DB)
	notificationsHandler := notificationshandler.NewHandlerWithAsynqAndRedis(deps.DB, deps.AsynqClient, deps.RedisClient)

	registerProfileRoutes(protectedAPI, usersHandler)
	registerSettingsRoutes(protectedAPI, settingsHandler)
	registerFeedbackRoutes(protectedAPI, feedbackHandler)
	registerUserManagementRoutes(protectedAPI, usersHandler)
	registerWebserviceProxyRoutes(protectedAPI, deps.WebserviceClient)
	registerNotificationRoutes(protectedAPI, notificationsHandler)

	workspaceHandler := workspacehandler.NewWorkspaceHandler(deps.DB, deps.AdminTokenProvider, deps.Cfg.Auth.BaseURL, deps.Cfg.Auth.Realm, deps.KeycloakCache)
	registerWorkspaceRoutes(protectedAPI, workspaceHandler)

	groupHandler := grouphandler.NewGroupHandler(deps.AdminTokenProvider, deps.Cfg.Auth.BaseURL, deps.Cfg.Auth.Realm, deps.SessionStore)
	ensureDefaultGroupExists(groupHandler)
	registerGroupRoutes(protectedAPI, groupHandler)

	modelHandler := modelhandler.NewModelHandlerWithCache(deps.DB, deps.AsynqClient, deps.AdminTokenProvider, deps.Cfg.Auth.BaseURL, deps.Cfg.Auth.Realm, deps.WebserviceClient, deps.KeycloakCache, deps.SyncCache)
	resultHandler := resulthandler.NewResultHandler(deps.DB, deps.NotificationService, deps.WebserviceClient, deps.Cfg.CallbackSecret, deps.AsynqClient)
	registerModelRoutes(protectedAPI, modelHandler, resultHandler)

	techHandler := technologyhandler.NewHandler(deps.DB)
	registerTechnologyRoutes(protectedAPI, techHandler)

	weatherHandler := weather.NewWeatherHandler()
	registerWeatherRoutes(protectedAPI, weatherHandler)

	pylovoInstanceStore := pylovoinstance.NewStore(deps.DB)
	pylovoHandler := pylovo.NewPylovoHandler(deps.Cfg.PylovoServiceURL, region.NewStore(deps.DB), pylovoInstanceStore)
	registerPylovoRoutes(protectedAPI, pylovoHandler)

	pylovoMgmtHandler := pylovo.NewManagementHandler(pylovoInstanceStore)
	registerPylovoManagementRoutes(protectedAPI, pylovoMgmtHandler)

	locationHandler := locationhandler.NewLocationHandler(deps.DB)
	registerLocationRoutes(protectedAPI, locationHandler)

	locationShareHandler := locationhandler.NewLocationShareHandler(deps.DB)
	registerLocationShareRoutes(protectedAPI, locationShareHandler)

	// Energy demand is calculated dynamically based on building area and type
}

func registerTechnologyRoutes(api *gin.RouterGroup, handler *technologyhandler.Handler) {
	api.GET("/technologies", handler.GetAll)
	api.POST("/technologies", handler.Create)
	api.POST("/technologies/import", handler.Import)
	api.POST("/technologies/reseed", handler.Reseed)
	api.GET(routeTechnologyByID, handler.GetByID)
	api.PUT(routeTechnologyByID, handler.Update)
	api.PATCH(routeTechnologyByID+"/type", handler.UpdateType)
	api.DELETE(routeTechnologyByID, handler.Delete)
	api.PUT(routeTechnologyByID+"/constraints", handler.UpdateConstraints)
	api.POST(routeTechnologyByID+"/constraints", handler.AddConstraint)
	api.DELETE(routeTechnologyByID+"/constraints/:constraintId", handler.DeleteConstraint)
}

func registerProfileRoutes(api *gin.RouterGroup, handler *usershandler.Handler) {
	api.GET("/users/profile", handler.GetProfile)
	api.PUT("/users/profile", handler.UpdateProfile)
}

func registerSettingsRoutes(api *gin.RouterGroup, handler *settingshandler.SettingsHandler) {
	api.GET(routeSettings, handler.GetUserSettings)
	api.PATCH(routeSettings, handler.UpdateSettings)
	api.PUT(routeSettings+"/privacy-accepted", handler.UpdatePrivacyAccepted)
	api.PUT(routeSettings+"/product-tour-completed", handler.UpdateProductTourCompleted)
	api.PUT(routeSettings+"/map-location", handler.UpdateMapLocation)
	api.PUT(routeSettings+"/weather-location", handler.UpdateWeatherLocation)
	api.PUT(routeSettings+"/theme", handler.UpdateTheme)
	api.PUT(routeSettings+"/language", handler.UpdateLanguage)
	api.DELETE(routeSettings, handler.DeleteAllSettings)
	// Polygon limits
	api.GET(routeSettings+"/polygon-limits", handler.GetPolygonLimits)
	api.GET(routeSettings+"/polygon-limits/me", handler.GetMyPolygonLimit)
	api.PUT(routeSettings+"/polygon-limits", handler.UpdatePolygonLimits)
	api.PUT(routeSettings+"/polygon-limit", handler.UpdatePolygonLimit)
	// Model limits
	api.GET(routeSettings+"/model-limits", handler.GetModelLimits)
	api.GET(routeSettings+"/model-limits/me", handler.GetMyModelLimit)
	api.PUT(routeSettings+"/model-limits", handler.UpdateModelLimits)
	api.PUT(routeSettings+"/model-limit", handler.UpdateModelLimit)
}

func registerFeedbackRoutes(api *gin.RouterGroup, handler *feedback.FeedbackHandler) {
	api.POST("/feedback", handler.CreateFeedback)
	api.GET("/feedback", handler.GetFeedbackList)
	api.GET("/feedback/my", handler.GetMyFeedback)
	api.GET("/feedback/search", handler.SearchFeedback)
	api.GET("/feedback/stats", handler.GetFeedbackStats)
	api.GET("/feedback/user/:user_id", handler.GetUserFeedback)
	api.GET(routeFeedbackByID+"/image", handler.GetFeedbackImage)
	api.GET(routeFeedbackByID+"/images/:index", handler.GetFeedbackImageByIndex)
	api.GET(routeFeedbackByID, handler.GetFeedbackByID)
	api.PUT(routeFeedbackByID, handler.UpdateFeedback)
	api.DELETE(routeFeedbackByID, handler.DeleteFeedback)
}

func registerUserManagementRoutes(api *gin.RouterGroup, handler *usershandler.Handler) {
	api.GET("/users", handler.ListUsers)
	api.GET("/users/count", handler.CountUsers)
	api.POST("/users", handler.CreateUser)
	api.GET(routeUsersByID, handler.GetUser)
	api.PUT(routeUsersByID, handler.UpdateUser)
	api.PUT(routeUsersByID+"/verify-email", handler.VerifyEmail)
	api.DELETE(routeUsersByID, handler.DeleteUser)
	api.PUT(routeUsersByID+"/disable", handler.DisableUser)
	api.PUT(routeUsersByID+"/enable", handler.EnableUser)
	api.POST("/users/bulk-delete", handler.BulkDeleteUsers)
}

func registerWebserviceProxyRoutes(api *gin.RouterGroup, client *webservice.Client) {
	proxy := makeWebserviceProxyHandler(client)
	api.Any("/webservices", proxy)
	api.Any("/webservices/*proxyPath", proxy)
}

func registerNotificationRoutes(api *gin.RouterGroup, handler *notificationshandler.Handler) {
	api.POST("/notifications/send", handler.SendNotification)
	api.GET("/notifications", handler.GetUserNotifications)
	api.GET("/notifications/stream", handler.StreamNotifications)
	api.PATCH("/notifications/:id/read", handler.MarkAsRead)
	api.POST("/notifications/read-all", handler.MarkAllAsRead)
	api.DELETE("/notifications/clear-all", handler.ClearAllNotifications)
}

func registerWorkspaceRoutes(api *gin.RouterGroup, handler *workspacehandler.WorkspaceHandler) {
	api.GET("/workspaces", handler.GetUserWorkspaces)
	api.GET("/workspaces/default", handler.CreateOrGetDefaultWorkspace)
	api.GET("/workspaces/preferred", handler.GetPreferredWorkspace)
	api.PUT("/workspaces/preferred", handler.SetPreferredWorkspace)
	api.GET(routeWorkspaceByID, handler.GetWorkspace)
	api.POST("/workspaces", handler.CreateWorkspace)
	api.POST(routeWorkspaceByID+"/copy", handler.CopyWorkspace)
	api.PUT(routeWorkspaceByID, handler.UpdateWorkspace)
	api.DELETE(routeWorkspaceByID, handler.DeleteWorkspace)
	api.POST(routeWorkspaceByID+routeMembers, handler.AddMember)
	api.DELETE(routeWorkspaceByID+routeMembers+"/:memberID", handler.RemoveMember)
	api.POST(routeWorkspaceByID+routeGroups, handler.AddGroup)
	api.DELETE(routeWorkspaceByID+routeGroups+"/:groupID", handler.RemoveGroup)
}

func registerGroupRoutes(api *gin.RouterGroup, handler *grouphandler.GroupHandler) {
	api.GET(routeGroups+"/my", handler.GetMyGroup)
	api.GET(routeGroups, handler.GetGroups)
	api.GET(routeGroupByID, handler.GetGroup)
	api.POST(routeGroups, handler.CreateGroup)
	api.PUT(routeGroupByID, handler.UpdateGroup)
	api.DELETE(routeGroupByID, handler.DeleteGroup)
	api.PUT(routeGroupByID+"/disable", handler.DisableGroup)
	api.PUT(routeGroupByID+"/enable", handler.EnableGroup)
	api.GET(routeGroupByID+routeMembers, handler.GetGroupMembers)
	api.POST(routeGroupByID+routeMembers, handler.AddMember)
	api.DELETE(routeGroupByID+routeMembers+"/:memberID", handler.RemoveMember)
}

func ensureDefaultGroupExists(handler *grouphandler.GroupHandler) {
	if err := handler.EnsureDefaultGroup(context.Background()); err != nil {
		platformlogger.Logger.Warnf("Failed to ensure Default group exists: %v", err)
	}
}

func registerModelRoutes(api *gin.RouterGroup, modelHandler *modelhandler.ModelHandler, resultHandler *resulthandler.ResultHandler) {
	api.GET("/models/stats", modelHandler.GetModelStats)
	api.GET("/models", modelHandler.GetModels)
	api.POST("/models", modelHandler.CreateModel)
	api.PATCH("/models/bulk-move", modelHandler.BulkMoveModels)
	api.GET(routeModelByID, modelHandler.GetModel)
	api.PUT(routeModelByID, modelHandler.UpdateModel)
	api.DELETE(routeModelByID, modelHandler.DeleteModel)
	api.PUT(routeModelByID+"/activation", modelHandler.UpdateModelActivation)
	api.PATCH(routeModelByID+"/move", modelHandler.MoveModel)
	api.POST(routeModelByID+"/share", modelHandler.ShareModel)
	api.GET(routeModelByID+"/results", resultHandler.GetModelResults)
	api.GET(routeModelByID+"/results/structured", resultHandler.GetStructuredResults)
	api.GET(routeModelByID+"/results/carrier-timeseries", resultHandler.GetCarrierTimeSeries)
	api.GET(routeModelByID+"/results/system-timeseries", resultHandler.GetSystemTimeSeries)
	api.GET(routeModelByID+"/results/location/:location", resultHandler.GetLocationTimeSeries)
	api.GET(routeModelByID+"/results/pypsa", resultHandler.GetPyPSAResults)
	api.GET(routeModelByID+"/download", resultHandler.DownloadModelResult)
	api.POST(routeModelByID+"/reprocess-results", resultHandler.ReprocessModelResults)
	api.POST("/calculation/start/:id", modelHandler.StartCalculation)
	api.GET("/results/:id", resultHandler.GetResult)
	api.GET("/results/:id/layer", resultHandler.GetResultLayer)
}

func registerAuthRoutes(api *gin.RouterGroup, handler gin.HandlerFunc) {
	api.POST("/login", handler)
	api.POST("/register", handler)
	api.POST("/logout", handler)
	api.GET("/callback-auth", handler)
	api.GET("/csrf-token", handler)
	api.POST("/auth/refresh", handler)
	api.POST("/auth/resend-verification", handler)
	api.POST("/auth/forgot-password", handler)
	api.POST("/auth/reset-password", handler)
	api.POST("/auth/change-password", handler)
	api.GET("/auth/tour-status", handler)
	api.POST("/auth/complete-tour", handler)
	api.POST("/auth/refresh-token", handler)
}

func registerWeatherRoutes(api *gin.RouterGroup, handler *weather.WeatherHandler) {
	weatherRoutes := api.Group("/weather")
	weatherRoutes.GET("", handler.GetWeather)
	weatherRoutes.GET("/current", handler.GetCurrentWeather)
}

func registerPylovoRoutes(api *gin.RouterGroup, handler *pylovo.PylovoHandler) {
	api.POST("/v2/pylovo/generate-grid", handler.GenerateGrid)
	api.GET("/v2/pylovo/transformer-sizes", handler.GetTransformerSizes)
	api.GET("/v2/pylovo/consumer-categories", handler.GetConsumerCategories)
	api.POST("/v2/pylovo/grid-statistics", handler.GetGridStatistics)
	api.POST("/v2/pylovo/cable-costs", handler.GetCableCosts)
	api.POST("/v2/pylovo/power-flow", handler.RunPowerFlow)
	api.GET("/v2/pylovo/cable-types", handler.GetCableTypes)
	api.GET("/v2/pylovo/equipment-costs", handler.GetEquipmentCosts)
	api.GET("/v2/pylovo/voltage-settings", handler.GetVoltageSettings)
	api.POST("/v2/pylovo/custom-buildings", handler.AddCustomBuilding)
	api.GET("/v2/pylovo/custom-buildings", handler.GetCustomBuildings)
	api.DELETE("/v2/pylovo/custom-buildings/:id", handler.DeleteCustomBuilding)
	api.POST("/v2/pylovo/estimate-energy", handler.EstimateEnergy)
	api.POST("/v2/pylovo/estimate-energy-batch", handler.EstimateEnergyBatch)
	// Transformer management routes
	api.POST("/v2/pylovo/add-transformer", handler.AddTransformer)
	api.POST("/v2/pylovo/delete-transformer", handler.DeleteTransformer)
	api.POST("/v2/pylovo/move-transformer", handler.MoveTransformer)
	api.POST("/v2/pylovo/assign-building", handler.AssignBuilding)
	api.POST("/v2/pylovo/finalize-transformers", handler.FinalizeTransformers)
	// Pipeline management routes
	api.POST("/v2/pylovo/pipeline/run", handler.RunPipeline)
	api.GET("/v2/pylovo/pipeline/status/:job_id", handler.GetPipelineStatus)
	api.GET("/v2/pylovo/pipeline/regions", handler.GetPipelineRegions)
	api.GET("/v2/pylovo/pipeline/history", handler.GetPipelineHistory)
	api.GET("/v2/pylovo/pipeline/states/:country", handler.GetCountryStates)
	api.DELETE("/v2/pylovo/pipeline/states/:country/:state", handler.DeleteStateData)
	// Cached region management
	api.GET("/v2/pylovo/regions/cached", handler.GetCachedRegions)
	api.PATCH("/v2/pylovo/regions/cached/:id", handler.ToggleCachedRegion)
	api.DELETE("/v2/pylovo/regions/cached/:id", handler.DeleteCachedRegion)
	// Boundary routes are registered in configurePublicAPI (no auth required)
}

func registerPylovoManagementRoutes(api *gin.RouterGroup, handler *pylovo.ManagementHandler) {
	api.GET("/pylovo-services", handler.List)
	api.POST("/pylovo-services", handler.Create)
	api.GET("/pylovo-services/summary", handler.GetSummary)
	api.GET("/pylovo-services/:id", handler.GetByID)
	api.PUT("/pylovo-services/:id", handler.Update)
	api.DELETE("/pylovo-services/:id", handler.Delete)
	api.GET("/pylovo-services/:id/ping", handler.Ping)
	api.POST("/pylovo-services/:id/primary", handler.SetPrimary)
	api.POST("/pylovo-services/:id/available", handler.MarkAvailable)
	api.POST("/pylovo-services/:id/unavailable", handler.MarkUnavailable)
}

func registerLocationRoutes(api *gin.RouterGroup, handler *locationhandler.LocationHandler) {
	locations := api.Group("/locations")
	locations.GET("", handler.GetUserLocations)
	locations.GET("/public", handler.GetPublicLocations)
	locations.GET("/all", handler.GetAllAccessibleLocations)
	locations.GET("/geojson", handler.GetUserLocationsGeoJSON)
	locations.POST("", handler.CreateLocation)
	locations.GET("/:id", handler.GetLocation)
	locations.PUT("/:id", handler.UpdateLocation)
	locations.DELETE("/:id", handler.DeleteLocation)
	locations.POST("/:id/copy", handler.CopyLocation)
}

func registerLocationShareRoutes(api *gin.RouterGroup, handler *locationhandler.LocationShareHandler) {
	locations := api.Group("/locations")
	// Share routes
	locations.GET("/:id/shares", handler.GetShares)
	locations.POST("/:id/share/user", handler.ShareWithUser)
	locations.POST("/:id/share/workspace", handler.ShareWithWorkspace)
	locations.POST("/:id/share/group", handler.ShareWithGroup)
	locations.DELETE("/:id/share/user/:shareId", handler.RemoveUserShare)
	locations.DELETE("/:id/share/workspace/:shareId", handler.RemoveWorkspaceShare)
	locations.DELETE("/:id/share/group/:shareId", handler.RemoveGroupShare)
}

func startFeedbackCleanup(db *gorm.DB, log *logrus.Logger) {
	store := feedbackstore.NewStore(db)
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	// Run once at startup, then every 24h
	for {
		deleted, err := store.DeleteClosedOlderThan(7)
		if err != nil {
			log.Errorf("feedback cleanup failed: %v", err)
		} else if deleted > 0 {
			log.Infof("feedback cleanup: deleted %d closed/resolved items older than 7 days", deleted)
		}
		<-ticker.C
	}
}
