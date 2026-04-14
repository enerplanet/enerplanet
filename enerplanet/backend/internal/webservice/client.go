package webservice

import (
	"context"
	"fmt"
	"net/http"
	"time"

	httpclient "platform.local/common/pkg/httpclient"
)

// Client provides HTTP helpers to talk to the webservice microservice.
type Client struct {
	http *httpclient.Client
	base string
}

func NewClient(baseURL string) *Client {
	return &Client{
		http: httpclient.New(baseURL, httpclient.WithTimeout(30*time.Second)),
		base: baseURL,
	}
}

func (c *Client) ReleaseInstance(ctx context.Context, webserviceID uint) error {
	path := fmt.Sprintf("/api/internal/webservices/%d/release", webserviceID)
	resp, err := c.http.DoJSON(ctx, http.MethodPost, path, map[string]interface{}{}, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("webservice release failed: status %d", resp.StatusCode)
	}
	return nil
}

func (c *Client) CancelSession(ctx context.Context, webserviceID uint, sessionID string) error {
	payload := map[string]string{"session_id": sessionID}
	resp, err := c.http.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/api/internal/webservices/%d/cancel-session", webserviceID), payload, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("webservice cancel session failed: status %d", resp.StatusCode)
	}
	return nil
}

// Forward sends an HTTP request with a body to the webservice service.
func (c *Client) Forward(ctx context.Context, method, path string, body []byte, headers http.Header) (*http.Response, error) {
	return c.http.DoBytes(ctx, method, path, body, headers)
}

func (c *Client) BaseURL() string {
	return c.base
}
