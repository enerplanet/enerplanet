package opentechdb

import (
	"context"
	"net/http"
	"time"

	httpclient "platform.local/common/pkg/httpclient"
)

// Client proxies requests to the OpenTech-DB FastAPI service.
type Client struct {
	http *httpclient.Client
	base string
}

// NewClient creates a new OpenTech-DB client.
func NewClient(baseURL string) *Client {
	return &Client{
		http: httpclient.New(baseURL, httpclient.WithTimeout(30*time.Second)),
		base: baseURL,
	}
}

// BaseURL returns the upstream base URL.
func (c *Client) BaseURL() string {
	return c.base
}

// Forward sends an HTTP request to the OpenTech-DB service and returns the
// upstream response.
func (c *Client) Forward(ctx context.Context, method, pathStr string, body []byte, headers http.Header) (*http.Response, error) {
	return c.http.DoBytes(ctx, method, pathStr, body, headers)
}
