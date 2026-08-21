package domain

import "time"

type JobStatus string

const (
	JobStatusQueued     JobStatus = "queued"
	JobStatusProcessing JobStatus = "processing"
	JobStatusClipsReady JobStatus = "clips_ready"
	JobStatusCompleted  JobStatus = "completed"
	JobStatusFailed     JobStatus = "failed"
	JobStatusCancelled  JobStatus = "cancelled"
)

type CreateJobInput struct {
	Kind        string
	ProjectID   string
	SourceURL   string
	ClipCount   int
	OutputDir   string
	ParentJobID string
	ClipIndex   int
	Metadata    map[string]any
}

type Job struct {
	ID          string
	Kind        string
	ProjectID   string
	Status      JobStatus
	SourceURL   string
	ClipCount   int
	OutputDir   string
	ParentJobID string
	ClipIndex   int
	Metadata    map[string]any
	Result      []byte
	Error       string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	Logs        []JobLog
}

type JobLog struct {
	Sequence  int
	Timestamp time.Time
	Message   string
}

type AuditEventStatus string

const (
	AuditEventStatusStarted   AuditEventStatus = "started"
	AuditEventStatusCompleted AuditEventStatus = "completed"
	AuditEventStatusFailed    AuditEventStatus = "failed"
	AuditEventStatusUnknown   AuditEventStatus = "unknown"
)

type JobAuditEvent struct {
	ID                  string
	JobID               string
	Sequence            int
	Category            string
	Name                string
	Status              AuditEventStatus
	Provider            string
	Host                string
	Path                string
	Method              string
	HTTPStatus          int
	RequestBytes        int64
	ResponseBytes       int64
	StartedAt           time.Time
	FinishedAt          time.Time
	DurationMS          int64
	Detail              string
	Error               string
	RequestBody         string
	ResponseBody        string
	RequestContentType  string
	ResponseContentType string
	CaptureMode         string
	Metadata            map[string]any
}

type StartAuditEventInput struct {
	Category           string
	Name               string
	Provider           string
	Host               string
	Path               string
	Method             string
	RequestBytes       int64
	ResponseBytes      int64
	RequestBody        string
	RequestContentType string
	CaptureMode        string
	Detail             string
	Metadata           map[string]any
}

type FinishAuditEventInput struct {
	Status              AuditEventStatus
	HTTPStatus          int
	ResponseBytes       int64
	FinishedAt          time.Time
	DurationMS          int64
	ResponseBody        string
	ResponseContentType string
	Detail              string
	Error               string
	Metadata            map[string]any
}
