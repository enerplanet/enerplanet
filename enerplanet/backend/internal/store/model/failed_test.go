package model

import (
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestFailedService(t *testing.T) {
	cause := errors.New(`target_job_failed: target job reported status "failed"`)
	marked := ServiceFailed(ServiceMeme, fmt.Errorf("meme job via TentaCron for model 12: %w", cause))

	assert.Equal(t, ServiceMeme, FailedService(fmt.Errorf("dispatch: %w", marked)), "found through further wrapping")
	assert.Equal(t, "meme job via TentaCron for model 12: "+cause.Error(), marked.Error(), "message unchanged")
	assert.ErrorIs(t, marked, cause)
	assert.Equal(t, "", FailedService(cause), "unmarked error names no service")
	assert.Nil(t, ServiceFailed(ServiceBuem, nil))
}
