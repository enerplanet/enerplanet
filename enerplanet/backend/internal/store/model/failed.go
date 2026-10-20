package model

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// FailedResults is the results value written together with status failed:
// the error, and failed_stage, the status the run had when it failed (queue,
// running or processing). On the right of an UPDATE, status still holds the
// row's old value, so the stage needs no extra read.
func FailedResults(reason string) clause.Expr {
	return gorm.Expr("jsonb_build_object('error', ?::text, 'failed_stage', status)", reason)
}
