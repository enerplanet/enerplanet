package feedback

import (
	"encoding/json"
	"fmt"
	"mime/multipart"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/httputil"
	"platform.local/common/pkg/models"
	feedbackstore "spatialhub_backend/internal/store/feedback"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	errInvalidFeedbackID = "Invalid feedback ID"
	feedbackImagesDir    = "feedback_images"
	maxImageSize         = 15 * 1024 * 1024 // 15MB
)

var allowedImageTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/gif":  ".gif",
	"image/webp": ".webp",
	"image/bmp":  ".bmp",
	"image/tiff": ".tiff",
}

type FeedbackHandler struct {
	feedbackStore *feedbackstore.Store
}

func NewFeedbackHandler(db *gorm.DB) *FeedbackHandler {
	return &FeedbackHandler{feedbackStore: feedbackstore.NewStore(db)}
}

func parsePagination(c *gin.Context) feedbackstore.PaginationParams {
	params := httputil.ParsePagination(c, nil)
	return feedbackstore.PaginationParams{Page: params.Page, PerPage: params.PerPage}
}

func parseFilters(c *gin.Context) feedbackstore.Filters {
	filters := feedbackstore.Filters{
		Status:   c.Query("status"),
		Category: c.Query("category"),
		Priority: c.Query("priority"),
	}
	if userID := c.Query("user_id"); userID != "" {
		filters.UserID = &userID
	}
	return filters
}

// CreatePublicFeedback creates a new feedback entry without requiring authentication.
// Used by the landing page contact form.
func (h *FeedbackHandler) CreatePublicFeedback(c *gin.Context) {
	// Parse form values
	name := c.PostForm("name")
	email := c.PostForm("email")
	category := c.PostForm("category")
	subject := c.PostForm("subject")
	message := c.PostForm("message")

	// Validate required fields
	if name == "" {
		httputil.BadRequest(c, "Name is required")
		return
	}
	if email == "" {
		httputil.BadRequest(c, "Email is required")
		return
	}
	if subject == "" {
		httputil.BadRequest(c, "Subject is required")
		return
	}
	if message == "" {
		httputil.BadRequest(c, "Message is required")
		return
	}

	if category == "" {
		category = "general"
	}
	validCategories := []string{"bug", "feature", "improvement", "general"}
	categoryValid := false
	for _, v := range validCategories {
		if category == v {
			categoryValid = true
			break
		}
	}
	if !categoryValid {
		httputil.BadRequest(c, "Invalid category. Must be one of: bug, feature, improvement, general")
		return
	}

	feedback := &models.Feedback{
		UserID:    "guest",
		UserEmail: email,
		UserName:  name,
		Category:  category,
		Subject:   subject,
		Message:   message,
		Rating:    0,
	}

	if err := h.feedbackStore.CreateFeedback(feedback); err != nil {
		httputil.InternalError(c, "Failed to submit feedback")
		return
	}

	httputil.Created(c, gin.H{
		"message":  "Feedback submitted successfully",
		"feedback": feedback,
	})
}

// CreateFeedback creates a new feedback entry with optional image attachments
func (h *FeedbackHandler) CreateFeedback(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	// Parse form values
	category := c.PostForm("category")
	subject := c.PostForm("subject")
	message := c.PostForm("message")
	ratingStr := c.PostForm("rating")

	// Validate required fields
	if category == "" {
		httputil.BadRequest(c, "Category is required")
		return
	}
	validCategories := []string{"bug", "feature", "improvement", "general"}
	categoryValid := false
	for _, v := range validCategories {
		if category == v {
			categoryValid = true
			break
		}
	}
	if !categoryValid {
		httputil.BadRequest(c, "Invalid category. Must be one of: bug, feature, improvement, general")
		return
	}

	if subject == "" {
		httputil.BadRequest(c, "Subject is required")
		return
	}
	if message == "" {
		httputil.BadRequest(c, "Message is required")
		return
	}

	rating := 0
	if ratingStr != "" {
		var err error
		rating, err = strconv.Atoi(ratingStr)
		if err != nil || rating < 0 || rating > 5 {
			httputil.BadRequest(c, "Rating must be a number between 0 and 5")
			return
		}
	}

	feedback := &models.Feedback{
		UserID:    userCtx.UserID,
		UserEmail: userCtx.Email,
		UserName:  userCtx.Name,
		Category:  category,
		Subject:   subject,
		Message:   message,
		Rating:    rating,
	}

	// Collect all uploaded images (supports both "image" and "images" field names)
	form, _ := c.MultipartForm()
	var fileHeaders []*multipart.FileHeader
	if form != nil {
		fileHeaders = append(fileHeaders, form.File["image"]...)
		fileHeaders = append(fileHeaders, form.File["images"]...)
	}

	if len(fileHeaders) > 0 {
		// Validate all files first
		for _, fh := range fileHeaders {
			if fh.Size > maxImageSize {
				httputil.BadRequest(c, fmt.Sprintf("Image %q exceeds 15MB limit", fh.Filename))
				return
			}
			ct := fh.Header.Get("Content-Type")
			if _, ok := allowedImageTypes[ct]; !ok {
				httputil.BadRequest(c, fmt.Sprintf("Image %q has invalid type. Allowed: jpeg, png, gif, webp", fh.Filename))
				return
			}
		}

		// Create feedback first to get ID
		if err := h.feedbackStore.CreateFeedback(feedback); err != nil {
			httputil.InternalError(c, "Failed to create feedback")
			return
		}

		// Save all images
		type imageInfo struct {
			Path     string `json:"path"`
			MimeType string `json:"mime_type"`
			Size     int64  `json:"size"`
		}
		var savedImages []imageInfo
		for _, fh := range fileHeaders {
			ct := fh.Header.Get("Content-Type")
			ext := allowedImageTypes[ct]
			imagePath, err := h.saveImage(c, fh, feedback.ID, ext)
			if err != nil {
				continue // skip failed saves
			}
			savedImages = append(savedImages, imageInfo{Path: imagePath, MimeType: ct, Size: fh.Size})
		}

		updates := map[string]interface{}{}
		// Store first image in legacy single-image columns for backward compat
		if len(savedImages) > 0 {
			first := savedImages[0]
			updates["image_path"] = first.Path
			updates["image_mime_type"] = first.MimeType
			updates["image_size"] = first.Size
		}
		// Store all images as JSON array
		if imagesJSON, err := json.Marshal(savedImages); err == nil {
			updates["images"] = string(imagesJSON)
		}

		if len(updates) > 0 {
			_ = h.feedbackStore.UpdateFeedback(feedback.ID, updates)
		}

		httputil.Created(c, gin.H{
			"message":  "Feedback submitted successfully",
			"feedback": feedback,
		})
		return
	}

	// No images - create feedback without images
	if err := h.feedbackStore.CreateFeedback(feedback); err != nil {
		httputil.InternalError(c, "Failed to create feedback")
		return
	}

	httputil.Created(c, gin.H{
		"message":  "Feedback submitted successfully",
		"feedback": feedback,
	})
}

// saveImage saves the uploaded image to disk and returns the relative path
func (h *FeedbackHandler) saveImage(c *gin.Context, fileHeader *multipart.FileHeader, feedbackID uint, ext string) (string, error) {
	// Create feedback images directory
	imagesDir := filepath.Join(constants.StorageDataDir, feedbackImagesDir)
	if err := os.MkdirAll(imagesDir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create images directory: %w", err)
	}

	// Generate unique filename
	filename := fmt.Sprintf("%d_%d%s", feedbackID, time.Now().UnixNano(), ext)
	fullPath := filepath.Join(imagesDir, filename)

	// Save the file
	if err := c.SaveUploadedFile(fileHeader, fullPath); err != nil {
		return "", fmt.Errorf("failed to save image: %w", err)
	}

	// Return relative path for storage in database
	return filepath.Join(feedbackImagesDir, filename), nil
}

// GetFeedbackList returns a paginated list of feedback
func (h *FeedbackHandler) GetFeedbackList(c *gin.Context) {
	result, err := h.feedbackStore.GetFeedbackList(parseFilters(c), parsePagination(c))
	if err != nil {
		httputil.InternalError(c, "Failed to retrieve feedback list")
		return
	}
	httputil.SuccessResponse(c, result)
}

// GetFeedbackByID returns a single feedback by ID
func (h *FeedbackHandler) GetFeedbackByID(c *gin.Context) {
	id, ok := httputil.ParseUintParam(c, "id", errInvalidFeedbackID)
	if !ok {
		return
	}

	feedback, err := h.feedbackStore.GetFeedbackByID(id)
	if err != nil {
		httputil.HandleError(c, err)
		return
	}
	httputil.SuccessResponse(c, feedback)
}

// UpdateFeedback updates feedback status and admin response
func (h *FeedbackHandler) UpdateFeedback(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	if !httputil.RequireExpertAccessFromContext(userCtx, c) {
		return
	}

	id, ok := httputil.ParseUintParam(c, "id", errInvalidFeedbackID)
	if !ok {
		return
	}

	var req struct {
		Status        string  `json:"status,omitempty" binding:"omitempty,oneof=pending in_progress resolved closed"`
		Priority      string  `json:"priority,omitempty" binding:"omitempty,oneof=low medium high critical"`
		AdminResponse *string `json:"admin_response,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequestWithDetails(c, "Invalid request", err.Error())
		return
	}

	adminUserID := userCtx.UserID

	updates := map[string]interface{}{}
	if req.Status != "" {
		updates["status"] = req.Status
	}
	if req.Priority != "" {
		updates["priority"] = req.Priority
	}
	if req.AdminResponse != nil {
		updates["admin_response"] = *req.AdminResponse
		updates["responded_at"] = time.Now().UTC()
		updates["responded_by"] = adminUserID
	}

	if len(updates) == 0 {
		httputil.BadRequest(c, "No valid fields to update")
		return
	}

	if err := h.feedbackStore.UpdateFeedback(id, updates); err != nil {
		httputil.HandleError(c, err)
		return
	}
	httputil.SuccessMessage(c, "Feedback updated successfully")
}

// DeleteFeedback removes a feedback entry
func (h *FeedbackHandler) DeleteFeedback(c *gin.Context) {
	id, ok := httputil.ParseUintParam(c, "id", errInvalidFeedbackID)
	if !ok {
		return
	}

	if err := h.feedbackStore.DeleteFeedback(id); err != nil {
		httputil.HandleError(c, err)
		return
	}
	httputil.SuccessMessage(c, "Feedback deleted successfully")
}

// GetFeedbackStats returns feedback statistics
func (h *FeedbackHandler) GetFeedbackStats(c *gin.Context) {
	stats, err := h.feedbackStore.GetFeedbackStats()
	if err != nil {
		httputil.InternalError(c, "Failed to retrieve feedback statistics")
		return
	}
	httputil.SuccessResponse(c, stats)
}

// GetUserFeedback returns feedback for a specific user
func (h *FeedbackHandler) GetUserFeedback(c *gin.Context) {
	userID := c.Param("user_id")
	if userID == "" {
		httputil.BadRequest(c, "User ID is required")
		return
	}

	result, err := h.feedbackStore.GetUserFeedback(userID, parseFilters(c), parsePagination(c))
	if err != nil {
		httputil.InternalError(c, "Failed to retrieve user feedback")
		return
	}
	httputil.SuccessResponse(c, result)
}

// GetMyFeedback returns feedback for the currently authenticated user
func (h *FeedbackHandler) GetMyFeedback(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	result, err := h.feedbackStore.GetUserFeedback(userCtx.UserID, parseFilters(c), parsePagination(c))
	if err != nil {
		httputil.InternalError(c, "Failed to retrieve your feedback")
		return
	}
	httputil.SuccessResponse(c, result)
}

// SearchFeedback searches feedback by query string
func (h *FeedbackHandler) SearchFeedback(c *gin.Context) {
	q := c.Query("q")
	if q == "" {
		httputil.BadRequest(c, "Search query is required")
		return
	}

	result, err := h.feedbackStore.SearchFeedback(q, parseFilters(c), parsePagination(c))
	if err != nil {
		httputil.InternalError(c, "Failed to search feedback")
		return
	}
	httputil.SuccessResponse(c, result)
}

// GetFeedbackImage serves the image attached to a feedback
func (h *FeedbackHandler) GetFeedbackImage(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id, ok := httputil.ParseUintParam(c, "id", errInvalidFeedbackID)
	if !ok {
		return
	}

	feedback, err := h.feedbackStore.GetFeedbackByID(id)
	if err != nil {
		httputil.HandleError(c, err)
		return
	}

	// Check access: user must be admin or the feedback owner
	isOwner := feedback.UserID == userCtx.UserID
	isAdmin := httputil.IsExpertAccess(userCtx.AccessLevel)
	if !isOwner && !isAdmin {
		httputil.Forbidden(c, "Access denied")
		return
	}

	// Check if feedback has an image
	if feedback.ImagePath == nil || *feedback.ImagePath == "" {
		httputil.NotFound(c, "No image found for this feedback")
		return
	}

	// Construct full path
	fullPath := filepath.Join(constants.StorageDataDir, *feedback.ImagePath)

	// Verify file exists
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		httputil.NotFound(c, "Image file not found")
		return
	}

	// Set content type if available
	if feedback.ImageMimeType != nil && *feedback.ImageMimeType != "" {
		c.Header("Content-Type", *feedback.ImageMimeType)
	}

	c.File(fullPath)
}

// GetFeedbackImageByIndex serves a specific image from the images JSON array
func (h *FeedbackHandler) GetFeedbackImageByIndex(c *gin.Context) {
	userCtx, ok := httputil.GetUserContext(c)
	if !ok {
		return
	}

	id, ok := httputil.ParseUintParam(c, "id", errInvalidFeedbackID)
	if !ok {
		return
	}

	indexStr := c.Param("index")
	index, err := strconv.Atoi(indexStr)
	if err != nil || index < 0 {
		httputil.BadRequest(c, "Invalid image index")
		return
	}

	fb, err := h.feedbackStore.GetFeedbackByID(id)
	if err != nil {
		httputil.HandleError(c, err)
		return
	}

	isOwner := fb.UserID == userCtx.UserID
	isAdmin := httputil.IsExpertAccess(userCtx.AccessLevel)
	if !isOwner && !isAdmin {
		httputil.Forbidden(c, "Access denied")
		return
	}

	if fb.Images == nil || *fb.Images == "" {
		httputil.NotFound(c, "No images found for this feedback")
		return
	}

	var images []struct {
		Path     string `json:"path"`
		MimeType string `json:"mime_type"`
		Size     int64  `json:"size"`
	}
	if err := json.Unmarshal([]byte(*fb.Images), &images); err != nil || index >= len(images) {
		httputil.NotFound(c, "Image not found")
		return
	}

	img := images[index]
	fullPath := filepath.Join(constants.StorageDataDir, img.Path)
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		httputil.NotFound(c, "Image file not found")
		return
	}

	if img.MimeType != "" {
		c.Header("Content-Type", img.MimeType)
	}
	c.File(fullPath)
}
