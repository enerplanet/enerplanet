package opentechdb

import (
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// ProxyHandler returns a Gin handler that proxies requests to the OpenTech-DB
// service.
func ProxyHandler(client *Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read request body"})
			return
		}

		headers := buildProxyHeaders(c.Request.Header)
		path := buildProxyPath(c.Request.URL.Path, c.Request.URL.RawQuery)

		resp, err := client.Forward(c.Request.Context(), c.Request.Method, path, body, headers)
		if err != nil {
			logrus.WithFields(logrus.Fields{
				"component": "opentechdb_proxy",
				"error":     err,
				"target":    client.BaseURL(),
				"path":      path,
			}).Warn("OpenTech-DB request failed")
			c.JSON(http.StatusBadGateway, gin.H{"error": "OpenTech-DB request failed"})
			return
		}
		defer resp.Body.Close()

		// Copy response headers
		for key, values := range resp.Header {
			lower := strings.ToLower(key)
			switch lower {
			case "content-length", "connection",
				headerAccessControlAllowOrigin,
				headerAccessControlAllowCredentials,
				headerAccessControlAllowMethods,
				headerAccessControlAllowHeaders,
				headerAccessControlExposeHeaders:
				continue
			}
			for _, v := range values {
				c.Header(key, v)
			}
		}

		respBody, err := io.ReadAll(resp.Body)
		if err != nil {
			logrus.WithFields(logrus.Fields{
				"component": "opentechdb_proxy",
				"error":     err,
			}).Warn("Failed to read response body")
			c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to read upstream response"})
			return
		}

		c.Data(resp.StatusCode, resp.Header.Get("Content-Type"), respBody)
	}
}

const (
	headerContentType                   = "Content-Type"
	headerAccept                        = "Accept"
	headerAccessControlAllowOrigin      = "access-control-allow-origin"
	headerAccessControlAllowCredentials = "access-control-allow-credentials"
	headerAccessControlAllowMethods     = "access-control-allow-methods"
	headerAccessControlAllowHeaders     = "access-control-allow-headers"
	headerAccessControlExposeHeaders    = "access-control-expose-headers"
)

func buildProxyHeaders(src http.Header) http.Header {
	headers := make(http.Header)
	for key, values := range src {
		lower := strings.ToLower(key)
		switch lower {
		case "content-type", "accept", "content-length", "host", "cookie", "authorization":
			headers.Set(key, values[0])
		default:
			for _, v := range values {
				headers.Add(key, v)
			}
		}
	}
	return headers
}

func buildProxyPath(urlPath, rawQuery string) string {
	// Gin mounts at /api/opentech-db, but the OpenTech-DB service expects /api/v1/...
	stripped := strings.TrimPrefix(urlPath, "/api/opentech-db")
	stripped = strings.TrimPrefix(stripped, "/")
	upstreamPath := "/api/v1/" + stripped
	if rawQuery != "" {
		return upstreamPath + "?" + rawQuery
	}
	return upstreamPath
}
