package domain

import "time"

type JobStatus string

const (
	JobStatusQueued     JobStatus = "queued"
	JobStatusProcessing JobStatus = "processing"
	JobStatusCompleted  JobStatus = "completed"
	JobStatusFailed     JobStatus = "failed"
	JobStatusCancelled  JobStatus = "cancelled"
)

type CreateJobInput struct {
	Kind      string
	ProjectID string
	SourceURL string
	ClipCount int
	OutputDir string
	Metadata  map[string]any
}

type Job struct {
	ID        string
	Kind      string
	ProjectID string
	Status    JobStatus
	SourceURL string
	ClipCount int
	OutputDir string
	Metadata  map[string]any
	Result    []byte
	Error     string
	CreatedAt time.Time
	UpdatedAt time.Time
	Logs      []JobLog
}

type JobLog struct {
	Sequence  int
	Timestamp time.Time
	Message   string
}
