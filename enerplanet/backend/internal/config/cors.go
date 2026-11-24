package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

// toolbox browser origins.
func loadToolboxOrigins(appEnv string) ([]string, error) {
	var origins []string
	for _, raw := range strings.Split(os.Getenv("TOOLBOX_CORS_ORIGINS"), ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		u, err := url.Parse(raw)
		devHTTP := u != nil && u.Scheme == "http" && (appEnv == "development" || appEnv == "test")
		if err != nil || u.Host == "" || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" ||
			(u.Scheme != "https" && !devHTTP) {
			return nil, fmt.Errorf("TOOLBOX_CORS_ORIGINS entry %q must be an https origin like https://host", raw)
		}
		origins = append(origins, u.Scheme+"://"+u.Host)
	}
	return origins, nil
}
