package model

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Services a failed run can name in results.failed_service. The frontend
// keeps one message per name; a run that names none gets its generic message.
const (
	ServiceMeme        = "meme"
	ServiceBuem        = "buem"
	ServicePV          = "pv"
	ServiceCity2TABULA = "city2tabula"
)

// FailedResults is the results value written together with status failed:
// the error, failed_stage, the status the run had when it failed (queue,
// running or processing), and failed_service, the service that failed or null
// when service is empty. On the right of an UPDATE, status still holds the
// row's old value, so the stage needs no extra read.
func FailedResults(reason, service string) clause.Expr {
	return gorm.Expr("jsonb_build_object('error', ?::text, 'failed_stage', status, 'failed_service', NULLIF(?::text, ''))", reason, service)
}

// ServiceError marks Err as a failure of the external service Service.
// Error returns Err's message unchanged.
type ServiceError struct {
	Service string
	Err     error
}

func (e *ServiceError) Error() string { return e.Err.Error() }

func (e *ServiceError) Unwrap() error { return e.Err }

// ServiceFailed marks err as a failure of service; nil stays nil.
func ServiceFailed(service string, err error) error {
	if err == nil {
		return nil
	}
	return &ServiceError{Service: service, Err: err}
}

// FailedService returns the service err was marked with, or "".
func FailedService(err error) string {
	var se *ServiceError
	if errors.As(err, &se) {
		return se.Service
	}
	return ""
}
