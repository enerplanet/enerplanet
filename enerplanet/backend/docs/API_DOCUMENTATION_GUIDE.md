# API Documentation Guide

This guide explains how to document API endpoints in the EnerPlanET backend using Swagger annotations.

## How It Works (The Big Picture)

```md
1. You write special comments above a handler function
2. You run a command (swag init) that reads those comments
3. It auto-generates docs/docs.go, swagger.json, swagger.yaml
4. The Swagger UI at /api/swagger/index.html shows your docs
```

> [!CAUTION]
> **You NEVER edit `docs.go`, `swagger.json`, or `swagger.yaml` manually.**
> They are regenerated every time you run the `swag init` command.

## Files You Work With

| File | Purpose | Edit manually? |
| ---- | ------- | -------------- |
| `cmd/main.go` | General API info (title, version, host) | Rarely — only if the API title/version changes |
| `internal/**/handler/*.go` | Endpoint annotations above each handler function | **Yes — this is where you document endpoints** |
| `internal/api/contracts/swagger.go` | Response/request type definitions for Swagger | **Yes — add new types here when needed** |
| `docs/docs.go` | Auto-generated docs package | **Never edit** |
| `docs/swagger.json` | Auto-generated OpenAPI spec | **Never edit** |
| `docs/swagger.yaml` | Auto-generated OpenAPI spec | **Never edit** |

> [!IMPORTANT]
> Only the first three files in this table are where you make changes.
> The `docs/` files are auto-generated output — your edits there will be overwritten.

## Step-by-Step: Documenting a New Endpoint

Let's walk through documenting a real endpoint: `GET /api/feedback` (get feedback list).

### Step 1: Find the handler function

Open the handler file (e.g., `internal/handler/feedback/feedback.go`) and find the function:

```go
func (h *FeedbackHandler) GetFeedbackList(c *gin.Context) {
    // ... existing code
}
```

### Step 2: Add comment annotations ABOVE the function

Add special `//` comments directly above the `func` line. Each line starts with `// @`:

```go
// GetFeedbackList godoc
// @Summary      List all feedback entries
// @Description  Returns a paginated list of user feedback. Requires authentication.
// @Tags         Feedback
// @Produce      json
// @Param        page   query  int     false  "Page number"    default(1)
// @Param        limit  query  int     false  "Items per page" default(20)
// @Success      200  {object}  contracts.GetFeedbackListResponse
// @Failure      401  {object}  contracts.ErrorResponse
// @Failure      500  {object}  contracts.ErrorResponse
// @Security     SessionAuth
// @Router       /feedback [get]
func (h *FeedbackHandler) GetFeedbackList(c *gin.Context) {
    // ... existing code (don't change anything here)
}
```

> [!TIP]
> **That's it for the handler.** The annotations are just comments — they don't change how the code runs.
> Now [Step 3](#step-3-understand-the-annotation-lines) explains what each annotation line means.

### Step 3: Understand the annotation lines

| Annotation | What it does | Example |
| ---------- | ------------ | ------- |
| `// @Summary` | One-line title shown in Swagger UI | `List all feedback entries` |
| `// @Description` | Longer explanation (can span multiple lines) | `Returns a paginated list...` |
| `// @Tags` | Group name in the sidebar | `Feedback` |
| `// @Accept` | What the endpoint accepts (use for POST/PUT) | `json` |
| `// @Produce` | What the endpoint returns | `json` |
| `// @Param` | Describes a parameter (see below) | `page query int false "Page number"` |
| `// @Success` | Describes a successful response | `200 {object} contracts.SomeType` |
| `// @Failure` | Describes an error response | `401 {object} contracts.ErrorResponse` |
| `// @Security` | Marks this endpoint as requiring auth | `SessionAuth` |
| `// @Router` | The URL path and HTTP method | `/feedback [get]` |

### Step 4: Understanding `@Param` format

The `@Param` line has this format:

```go
// @Param  name  location  type  required  "description"  extras
```

- **name**: the parameter name (e.g., `limit`, `id`, `workspace_id`)
- **location**: where—`query`, `path`, `body`, `header`, or `formData`
- **type**: `string`, `int`, `number`, `bool`, or `object`
- **required**: `true` or `false`
- **"description"**: human-readable text in quotes
- **extras** (optional): `default(100)`, `example(42)`, `minimum(1)`, etc.

Common examples:

```go
// Query parameter:    ?limit=50
// @Param  limit  query  int  false  "Max items to return"  default(100)

// Path parameter:     /feedback/:id
// @Param  id     path   int  true   "Feedback ID"

// JSON body (for POST/PUT):
// @Param  body   body   contracts.CreateFeedbackRequest  true  "Feedback data"
```

### Step 5: Define response types (if needed)

Open `internal/api/contracts/swagger.go` and add a struct that matches your endpoint's JSON response:

```go
// FeedbackItem represents a single feedback entry.
type FeedbackItem struct {
    ID        uint   `json:"id" example:"1"`
    UserID    string `json:"user_id" example:"abc-123"`
    Message   string `json:"message" example:"Great feature!"`
    Status    string `json:"status" example:"open"`
    CreatedAt string `json:"created_at" example:"2025-06-15T10:30:00Z"`
}

// GetFeedbackListResponse is the response for GET /api/feedback.
type GetFeedbackListResponse struct {
    Success bool           `json:"success" example:"true"`
    Data    []FeedbackItem `json:"data"`
    Total   int64          `json:"total" example:"42"`
}
```

> [!NOTE]
> **Tips for writing types:**
>
> - The `json:"..."` tag must match the actual JSON field name your handler returns
> - The `example:"..."` tag provides sample values shown in Swagger UI
> - Use `*string` (pointer) for optional/nullable fields, and add `omitempty` to the json tag
> - You don't need to include every single field — just the important ones

### Step 6: Regenerate the docs

Run this command from the `enerplanet/backend/` directory:

```bash
swag init -g cmd/main.go --parseDependency --parseInternal -o docs
```

> [!WARNING]
> Always run this command from the `enerplanet/backend/` directory, not the project root.
> Running it from the wrong directory will produce errors or an empty spec.

If successful, you'll see output like:

```bash
Generate swagger docs....
create docs.go at docs/docs.go
create swagger.json at docs/swagger.json
create swagger.yaml at docs/swagger.yaml
```

If there's an error, it will tell you exactly which file and line has the problem.

### Step 7: Verify

1. Restart the backend server
2. Open <http://localhost:8000/api/swagger/index.html>
3. Your new endpoint should appear under its tag group

## Quick Reference: Common Patterns

### GET endpoint (with query params, requires auth)

```go
// @Summary      Get something
// @Tags         GroupName
// @Produce      json
// @Param        limit  query  int  false  "Limit"  default(100)
// @Success      200  {object}  contracts.SomeResponse
// @Failure      401  {object}  contracts.ErrorResponse
// @Security     SessionAuth
// @Router       /some-path [get]
```

### POST endpoint (with JSON body, requires auth)

```go
// @Summary      Create something
// @Tags         GroupName
// @Accept       json
// @Produce      json
// @Param        body  body  contracts.CreateSomethingRequest  true  "Request body"
// @Success      201  {object}  contracts.CreateSomethingResponse
// @Failure      400  {object}  contracts.ErrorResponse
// @Failure      401  {object}  contracts.ErrorResponse
// @Security     SessionAuth
// @Router       /some-path [post]
```

### DELETE endpoint (with path param, requires auth)

```go
// @Summary      Delete something
// @Tags         GroupName
// @Produce      json
// @Param        id  path  int  true  "Item ID"
// @Success      200  {object}  contracts.SuccessMessage
// @Failure      404  {object}  contracts.ErrorResponse
// @Security     SessionAuth
// @Router       /some-path/:id [delete]
```

### Public endpoint (no auth needed)

```go
// @Summary      Get public data
// @Tags         Public
// @Produce      json
// @Param        lat  query  number  true  "Latitude"
// @Success      200  {object}  contracts.SomePublicResponse
// @Failure      400  {object}  contracts.ErrorResponse
// @Router       /public-path [get]
```

> [!TIP]
> No `@Security` line = public endpoint. Only add `@Security SessionAuth` for routes that require login.

## Common Response Type in contracts/swagger.go

Since most endpoints use the same error format, `ErrorResponse` is already defined:

```go
type ErrorResponse struct {
    Error string `json:"error" example:"Unauthorized"`
}
```

> [!NOTE]
> You can reuse `contracts.ErrorResponse` in every endpoint's `@Failure` annotation —
> no need to create a separate error type per endpoint.

## Troubleshooting

| Problem | Solution |
| ------- | -------- |
| `cannot find type definition: contracts.SomeType` | Make sure the struct exists in `internal/api/contracts/swagger.go` **AND** the handler file has `_ "spatialhub_backend/internal/api/contracts"` in its imports |
| Swagger UI shows old data | Re-run `swag init ...` and restart the backend |
| `@Router` path doesn't match | The path should **NOT** include `/api` — the `basePath` in main.go already handles that |
| Annotations not detected | Make sure comments are directly above the `func` line with no blank lines in between |

> [!CAUTION]
> The `@Router` path must **not** start with `/api`. Write `/models`, not `/api/models`.
> The `basePath: /api` in `cmd/main.go` is automatically prepended.

> [!IMPORTANT]
> If you add annotations to a handler in a **new file** that doesn't already import the contracts package,
> you must add this blank import at the top of the file:
>
> ```go
> _ "spatialhub_backend/internal/api/contracts" // swagger response types
> ```
>
> Without this, `swag` cannot resolve the type references and will fail during generation.

You can also add a generic success message type:

```go
type SuccessMessage struct {
    Success bool   `json:"success" example:"true"`
    Message string `json:"message" example:"Item deleted"`
}
```

## Troubleshooting

| Problem | Solution |
| ------- | -------- |
| `cannot find type definition: contracts.SomeType` | Make sure the struct exists in `internal/api/contracts/swagger.go` AND the handler file has `_ "spatialhub_backend/internal/api/contracts"` in its imports |
| Swagger UI shows old data | Re-run `swag init ...` and restart the backend |
| `@Router` path doesn't match | The path should NOT include `/api` — the basePath already handles that |
| Annotations not detected | Make sure comments are directly above the `func` line with no blank lines in between |
