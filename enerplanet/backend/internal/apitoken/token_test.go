package apitoken

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFromAuthorizationHeader(t *testing.T) {
	for header, want := range map[string]string{
		"Bearer whf_abc":  "whf_abc",
		"bearer whf_abc":  "whf_abc",
		"BEARER whf_abc":  "whf_abc",
		"Bearer  whf_abc": "whf_abc",
		"Bearer eyJhbGc":  "",
		"Basic whf_abc":   "",
		"Bearer":          "",
		"":                "",
	} {
		require.Equal(t, want, FromAuthorizationHeader(header), header)
	}
}
