package domain

import "time"

type HighlightProject struct {
	ID                   string
	Name                 string
	SourceBucket         string
	SourceKey            string
	MinDurationSeconds   int
	IdealDurationSeconds int
	LatestJobID          string
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

type CreateHighlightProjectInput struct {
	Name                 string
	SourceBucket         string
	SourceKey            string
	MinDurationSeconds   int
	IdealDurationSeconds int
}

type UpdateHighlightProjectInput struct {
	Name                 string
	MinDurationSeconds   int
	IdealDurationSeconds int
}
