package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

var (
	ErrJobNotFound        = errors.New("job not found")
	ErrInvalidTransition  = errors.New("invalid job status transition")
	ErrJobNotClaimable    = errors.New("job is not queued")
	ErrActiveJob          = errors.New("an active job of this kind already exists")
	ErrProjectNotFound    = errors.New("highlight project not found")
	ErrProjectActive      = errors.New("highlight project has an active job")
	ErrProjectNotEditable = errors.New("highlight project is not editable")
	ErrAuditEventNotFound = errors.New("audit event not found")
)

type Store interface {
	Create(context.Context, domain.CreateJobInput) (domain.Job, error)
	CreateClipRenderIfAbsent(context.Context, domain.CreateJobInput) (domain.Job, error)
	CreateIfNoActive(context.Context, string, domain.CreateJobInput) (domain.Job, error)
	CreateHighlightProject(context.Context, domain.CreateHighlightProjectInput) (domain.HighlightProject, domain.Job, error)
	ListHighlightProjects(context.Context) ([]domain.HighlightProject, error)
	GetHighlightProject(context.Context, string) (domain.HighlightProject, domain.Job, error)
	UpdateHighlightProject(context.Context, string, domain.UpdateHighlightProjectInput) (domain.HighlightProject, error)
	RetryHighlightProject(context.Context, string) (domain.Job, error)
	DeleteHighlightProject(context.Context, string) error
	Get(context.Context, string) (domain.Job, bool)
	DeleteJob(context.Context, string) error
	Transition(context.Context, string, domain.JobStatus, string) (domain.Job, error)
	AppendLog(context.Context, string, string) error
	SetResult(context.Context, string, []byte) error
	SetOutputDir(context.Context, string, string) error
	GetClipStatuses(context.Context, string) (map[int]ClipStatus, error)
	SetClipStatus(context.Context, string, int, string) (ClipStatus, error)
	Claim(context.Context, string) (domain.Job, error)
	ListByStatus(context.Context, domain.JobStatus) ([]domain.Job, error)
	ListByKind(context.Context, string) ([]domain.Job, error)
	RequeueProcessing(context.Context) error
	StartAuditEvent(context.Context, string, domain.StartAuditEventInput) (domain.JobAuditEvent, error)
	FinishAuditEvent(context.Context, string, string, domain.FinishAuditEventInput) (domain.JobAuditEvent, error)
	ListAuditEvents(context.Context, string) ([]domain.JobAuditEvent, error)
}

type ClipStatus struct {
	Status    string
	UpdatedAt time.Time
}

type MemoryStore struct {
	mu            sync.RWMutex
	jobs          map[string]domain.Job
	projects      map[string]domain.HighlightProject
	clipStatuses  map[string]map[int]ClipStatus
	auditEventIDs map[string][]string
	auditEvents   map[string]domain.JobAuditEvent
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		jobs:          make(map[string]domain.Job),
		projects:      make(map[string]domain.HighlightProject),
		clipStatuses:  make(map[string]map[int]ClipStatus),
		auditEventIDs: make(map[string][]string),
		auditEvents:   make(map[string]domain.JobAuditEvent),
	}
}

func (s *MemoryStore) Create(_ context.Context, input domain.CreateJobInput) (domain.Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.createLocked(input)
}

func (s *MemoryStore) CreateClipRenderIfAbsent(_ context.Context, input domain.CreateJobInput) (domain.Job, error) {
	if input.Kind != "clip-render" {
		return domain.Job{}, fmt.Errorf("clip render job kind is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, job := range s.jobs {
		if job.Kind != "clip-render" || job.ParentJobID != input.ParentJobID || job.ClipIndex != input.ClipIndex {
			continue
		}
		if job.Status == domain.JobStatusQueued || job.Status == domain.JobStatusProcessing {
			return cloneJob(job), nil
		}
	}
	return s.createLocked(input)
}

func (s *MemoryStore) CreateIfNoActive(_ context.Context, kind string, input domain.CreateJobInput) (domain.Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, job := range s.jobs {
		if job.Kind == kind && (job.Status == domain.JobStatusQueued || job.Status == domain.JobStatusProcessing) {
			return domain.Job{}, ErrActiveJob
		}
	}
	return s.createLocked(input)
}

func (s *MemoryStore) CreateHighlightProject(_ context.Context, input domain.CreateHighlightProjectInput) (domain.HighlightProject, domain.Job, error) {
	if err := validateHighlightProjectInput(input.Name, input.SourceBucket, input.SourceKey, input.MinDurationSeconds, input.IdealDurationSeconds); err != nil {
		return domain.HighlightProject{}, domain.Job{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, job := range s.jobs {
		if job.Kind == "highlight-generation" && isActive(job.Status) {
			return domain.HighlightProject{}, domain.Job{}, ErrActiveJob
		}
	}
	projectID, err := newID()
	if err != nil {
		return domain.HighlightProject{}, domain.Job{}, fmt.Errorf("generate project id: %w", err)
	}
	now := time.Now().UTC()
	project := domain.HighlightProject{
		ID:                   projectID,
		Name:                 input.Name,
		SourceBucket:         input.SourceBucket,
		SourceKey:            input.SourceKey,
		MinDurationSeconds:   input.MinDurationSeconds,
		IdealDurationSeconds: input.IdealDurationSeconds,
		CreatedAt:            now,
		UpdatedAt:            now,
	}
	job, err := s.createLocked(domain.CreateJobInput{
		Kind:      "highlight-generation",
		ProjectID: project.ID,
		Metadata: map[string]any{
			"source_object": map[string]any{"bucket": project.SourceBucket, "key": project.SourceKey},
			"min_minutes":   float64(project.MinDurationSeconds) / 60,
			"ideal_minutes": float64(project.IdealDurationSeconds) / 60,
		},
	})
	if err != nil {
		return domain.HighlightProject{}, domain.Job{}, err
	}
	project.LatestJobID = job.ID
	s.projects[project.ID] = project
	return cloneProject(project), cloneJob(job), nil
}

func (s *MemoryStore) ListHighlightProjects(_ context.Context) ([]domain.HighlightProject, error) {
	s.mu.RLock()
	projects := make([]domain.HighlightProject, 0, len(s.projects))
	for _, project := range s.projects {
		projects = append(projects, cloneProject(project))
	}
	s.mu.RUnlock()
	sort.Slice(projects, func(i, j int) bool {
		if projects[i].UpdatedAt.Equal(projects[j].UpdatedAt) {
			return projects[i].ID < projects[j].ID
		}
		return projects[i].UpdatedAt.After(projects[j].UpdatedAt)
	})
	return projects, nil
}

func (s *MemoryStore) GetHighlightProject(_ context.Context, id string) (domain.HighlightProject, domain.Job, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	project, ok := s.projects[id]
	if !ok {
		return domain.HighlightProject{}, domain.Job{}, ErrProjectNotFound
	}
	job, ok := s.jobs[project.LatestJobID]
	if !ok {
		return domain.HighlightProject{}, domain.Job{}, ErrProjectNotFound
	}
	return cloneProject(project), cloneJob(job), nil
}

func (s *MemoryStore) UpdateHighlightProject(_ context.Context, id string, input domain.UpdateHighlightProjectInput) (domain.HighlightProject, error) {
	if err := validateHighlightProjectDurations(input.MinDurationSeconds, input.IdealDurationSeconds); err != nil {
		return domain.HighlightProject{}, err
	}
	if strings.TrimSpace(input.Name) == "" {
		return domain.HighlightProject{}, errors.New("project name is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	project, ok := s.projects[id]
	if !ok {
		return domain.HighlightProject{}, ErrProjectNotFound
	}
	job, ok := s.jobs[project.LatestJobID]
	if !ok {
		return domain.HighlightProject{}, ErrProjectNotFound
	}
	if isActive(job.Status) {
		return domain.HighlightProject{}, ErrProjectActive
	}
	project.Name = strings.TrimSpace(input.Name)
	project.MinDurationSeconds = input.MinDurationSeconds
	project.IdealDurationSeconds = input.IdealDurationSeconds
	project.UpdatedAt = time.Now().UTC()
	s.projects[id] = project
	return cloneProject(project), nil
}

func (s *MemoryStore) RetryHighlightProject(_ context.Context, id string) (domain.Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	project, ok := s.projects[id]
	if !ok {
		return domain.Job{}, ErrProjectNotFound
	}
	latest, ok := s.jobs[project.LatestJobID]
	if !ok {
		return domain.Job{}, ErrProjectNotFound
	}
	if isActive(latest.Status) {
		return domain.Job{}, ErrProjectActive
	}
	for _, job := range s.jobs {
		if job.Kind == "highlight-generation" && isActive(job.Status) {
			return domain.Job{}, ErrActiveJob
		}
	}
	job, err := s.createLocked(domain.CreateJobInput{
		Kind:      "highlight-generation",
		ProjectID: project.ID,
		Metadata: map[string]any{
			"source_object": map[string]any{"bucket": project.SourceBucket, "key": project.SourceKey},
			"min_minutes":   float64(project.MinDurationSeconds) / 60,
			"ideal_minutes": float64(project.IdealDurationSeconds) / 60,
		},
	})
	if err != nil {
		return domain.Job{}, err
	}
	project.LatestJobID = job.ID
	project.UpdatedAt = time.Now().UTC()
	s.projects[id] = project
	return cloneJob(job), nil
}

func (s *MemoryStore) DeleteHighlightProject(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.projects[id]; !ok {
		return ErrProjectNotFound
	}
	for jobID, job := range s.jobs {
		if job.ProjectID == id {
			delete(s.jobs, jobID)
		}
	}
	delete(s.projects, id)
	return nil
}

func (s *MemoryStore) createLocked(input domain.CreateJobInput) (domain.Job, error) {
	if input.Kind == "" {
		return domain.Job{}, fmt.Errorf("job kind is required")
	}
	id, err := newID()
	if err != nil {
		return domain.Job{}, fmt.Errorf("generate job id: %w", err)
	}
	now := time.Now().UTC()
	job := domain.Job{
		ID:          id,
		Kind:        input.Kind,
		ProjectID:   input.ProjectID,
		Status:      domain.JobStatusQueued,
		SourceURL:   input.SourceURL,
		ClipCount:   input.ClipCount,
		OutputDir:   input.OutputDir,
		ParentJobID: input.ParentJobID,
		ClipIndex:   input.ClipIndex,
		Metadata:    cloneMetadata(input.Metadata),
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	s.jobs[id] = job
	return cloneJob(job), nil
}

func (s *MemoryStore) Get(_ context.Context, id string) (domain.Job, bool) {
	s.mu.RLock()
	job, ok := s.jobs[id]
	s.mu.RUnlock()
	if !ok {
		return domain.Job{}, false
	}
	return cloneJob(job), true
}

func (s *MemoryStore) DeleteJob(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.jobs[id]; !ok {
		return ErrJobNotFound
	}
	removed := map[string]bool{id: true}
	for {
		changed := false
		for jobID, job := range s.jobs {
			if removed[jobID] || !removed[job.ParentJobID] {
				continue
			}
			removed[jobID] = true
			changed = true
		}
		if !changed {
			break
		}
	}
	for jobID := range removed {
		delete(s.jobs, jobID)
		delete(s.clipStatuses, jobID)
	}
	return nil
}

func (s *MemoryStore) Transition(_ context.Context, id string, next domain.JobStatus, message string) (domain.Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	job, ok := s.jobs[id]
	if !ok {
		return domain.Job{}, ErrJobNotFound
	}
	if !allowedTransition(job.Status, next) {
		return domain.Job{}, fmt.Errorf("%w: %s -> %s", ErrInvalidTransition, job.Status, next)
	}
	job.Status = next
	job.Error = ""
	if next == domain.JobStatusFailed || next == domain.JobStatusCancelled {
		job.Error = message
	}
	job.UpdatedAt = time.Now().UTC()
	s.jobs[id] = job
	return cloneJob(job), nil
}

func (s *MemoryStore) ListByKind(_ context.Context, kind string) ([]domain.Job, error) {
	s.mu.RLock()
	jobs := make([]domain.Job, 0)
	for _, job := range s.jobs {
		if job.Kind == kind {
			jobs = append(jobs, cloneJob(job))
		}
	}
	s.mu.RUnlock()
	sort.Slice(jobs, func(i, j int) bool {
		if jobs[i].CreatedAt.Equal(jobs[j].CreatedAt) {
			return jobs[i].ID < jobs[j].ID
		}
		return jobs[i].CreatedAt.Before(jobs[j].CreatedAt)
	})
	return jobs, nil
}

func (s *MemoryStore) Claim(_ context.Context, id string) (domain.Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	job, ok := s.jobs[id]
	if !ok {
		return domain.Job{}, ErrJobNotFound
	}
	if job.Status != domain.JobStatusQueued {
		return domain.Job{}, fmt.Errorf("%w: %s", ErrJobNotClaimable, job.Status)
	}
	job.Status = domain.JobStatusProcessing
	job.Error = ""
	job.UpdatedAt = time.Now().UTC()
	s.jobs[id] = job
	return cloneJob(job), nil
}

func (s *MemoryStore) ListByStatus(_ context.Context, status domain.JobStatus) ([]domain.Job, error) {
	s.mu.RLock()
	jobs := make([]domain.Job, 0)
	for _, job := range s.jobs {
		if job.Status == status {
			jobs = append(jobs, cloneJob(job))
		}
	}
	s.mu.RUnlock()
	sort.Slice(jobs, func(i, j int) bool {
		if jobs[i].CreatedAt.Equal(jobs[j].CreatedAt) {
			return jobs[i].ID < jobs[j].ID
		}
		return jobs[i].CreatedAt.Before(jobs[j].CreatedAt)
	})
	return jobs, nil
}

func (s *MemoryStore) RequeueProcessing(_ context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, job := range s.jobs {
		if job.Status != domain.JobStatusProcessing {
			continue
		}
		job.Status = domain.JobStatusQueued
		job.Error = ""
		job.UpdatedAt = time.Now().UTC()
		s.jobs[id] = job
	}
	return nil
}

func (s *MemoryStore) StartAuditEvent(_ context.Context, jobID string, input domain.StartAuditEventInput) (domain.JobAuditEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.jobs[jobID]; !ok {
		return domain.JobAuditEvent{}, ErrJobNotFound
	}
	id, err := newID()
	if err != nil {
		return domain.JobAuditEvent{}, fmt.Errorf("generate audit event id: %w", err)
	}
	event := domain.JobAuditEvent{
		ID:                 id,
		JobID:              jobID,
		Sequence:           len(s.auditEventIDs[jobID]) + 1,
		Category:           input.Category,
		Name:               input.Name,
		Status:             domain.AuditEventStatusStarted,
		Provider:           input.Provider,
		Host:               input.Host,
		Path:               input.Path,
		Method:             input.Method,
		RequestBytes:       input.RequestBytes,
		StartedAt:          time.Now().UTC(),
		Detail:             input.Detail,
		RequestBody:        input.RequestBody,
		RequestContentType: input.RequestContentType,
		CaptureMode:        input.CaptureMode,
		Metadata:           cloneMetadata(input.Metadata),
	}
	s.auditEventIDs[jobID] = append(s.auditEventIDs[jobID], id)
	s.auditEvents[id] = cloneAuditEvent(event)
	return cloneAuditEvent(event), nil
}

func (s *MemoryStore) FinishAuditEvent(_ context.Context, jobID, eventID string, input domain.FinishAuditEventInput) (domain.JobAuditEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.jobs[jobID]; !ok {
		return domain.JobAuditEvent{}, ErrJobNotFound
	}
	event, ok := s.auditEvents[eventID]
	if !ok || event.JobID != jobID {
		return domain.JobAuditEvent{}, ErrAuditEventNotFound
	}
	if input.Status == "" {
		input.Status = domain.AuditEventStatusUnknown
	}
	event.Status = input.Status
	event.HTTPStatus = input.HTTPStatus
	event.ResponseBytes = input.ResponseBytes
	event.ResponseBody = input.ResponseBody
	event.ResponseContentType = input.ResponseContentType
	event.Detail = input.Detail
	event.Error = input.Error
	event.FinishedAt = input.FinishedAt
	if event.FinishedAt.IsZero() {
		event.FinishedAt = time.Now().UTC()
	}
	event.DurationMS = input.DurationMS
	if event.DurationMS == 0 {
		event.DurationMS = event.FinishedAt.Sub(event.StartedAt).Milliseconds()
	}
	if input.Metadata != nil {
		event.Metadata = cloneMetadata(input.Metadata)
	}
	s.auditEvents[eventID] = cloneAuditEvent(event)
	return cloneAuditEvent(event), nil
}

func (s *MemoryStore) ListAuditEvents(_ context.Context, jobID string) ([]domain.JobAuditEvent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.jobs[jobID]; !ok {
		return nil, ErrJobNotFound
	}
	ids := s.auditEventIDs[jobID]
	events := make([]domain.JobAuditEvent, 0, len(ids))
	for _, id := range ids {
		if event, ok := s.auditEvents[id]; ok {
			events = append(events, cloneAuditEvent(event))
		}
	}
	return events, nil
}

func (s *MemoryStore) AppendLog(_ context.Context, id string, message string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	job, ok := s.jobs[id]
	if !ok {
		return ErrJobNotFound
	}
	job.Logs = append(job.Logs, domain.JobLog{
		Sequence:  len(job.Logs) + 1,
		Timestamp: time.Now().UTC(),
		Message:   message,
	})
	job.UpdatedAt = time.Now().UTC()
	s.jobs[id] = job
	return nil
}

func (s *MemoryStore) SetResult(_ context.Context, id string, result []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	job, ok := s.jobs[id]
	if !ok {
		return ErrJobNotFound
	}
	job.Result = append([]byte(nil), result...)
	job.UpdatedAt = time.Now().UTC()
	s.jobs[id] = job
	return nil
}

func (s *MemoryStore) SetOutputDir(_ context.Context, id, outputDir string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[id]
	if !ok {
		return ErrJobNotFound
	}
	job.OutputDir = outputDir
	job.UpdatedAt = time.Now().UTC()
	s.jobs[id] = job
	return nil
}

func (s *MemoryStore) GetClipStatuses(_ context.Context, projectID string) (map[int]ClipStatus, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	statuses := make(map[int]ClipStatus)
	for index, status := range s.clipStatuses[projectID] {
		statuses[index] = status
	}
	return statuses, nil
}

func (s *MemoryStore) SetClipStatus(_ context.Context, projectID string, clipIndex int, status string) (ClipStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.jobs[projectID]; !ok {
		return ClipStatus{}, ErrJobNotFound
	}
	if s.clipStatuses[projectID] == nil {
		s.clipStatuses[projectID] = make(map[int]ClipStatus)
	}
	value := ClipStatus{Status: status, UpdatedAt: time.Now().UTC()}
	s.clipStatuses[projectID][clipIndex] = value
	return value, nil
}

func allowedTransition(current, next domain.JobStatus) bool {
	switch current {
	case domain.JobStatusQueued:
		return next == domain.JobStatusProcessing || next == domain.JobStatusFailed || next == domain.JobStatusCancelled
	case domain.JobStatusProcessing:
		return next == domain.JobStatusClipsReady || next == domain.JobStatusCompleted || next == domain.JobStatusFailed || next == domain.JobStatusCancelled
	default:
		return false
	}
}

func newID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	encoded := hex.EncodeToString(bytes[:])
	return encoded[:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:], nil
}

func cloneJob(job domain.Job) domain.Job {
	job.Result = append([]byte(nil), job.Result...)
	job.Logs = append([]domain.JobLog(nil), job.Logs...)
	job.Metadata = cloneMetadata(job.Metadata)
	return job
}

func cloneProject(project domain.HighlightProject) domain.HighlightProject {
	return project
}

func isActive(status domain.JobStatus) bool {
	return status == domain.JobStatusQueued || status == domain.JobStatusProcessing
}

func validateHighlightProjectInput(name, bucket, key string, minSeconds, idealSeconds int) error {
	if strings.TrimSpace(name) == "" {
		return errors.New("project name is required")
	}
	if strings.TrimSpace(bucket) == "" || strings.TrimSpace(key) == "" {
		return errors.New("MinIO source object requires bucket and key")
	}
	return validateHighlightProjectDurations(minSeconds, idealSeconds)
}

func validateHighlightProjectDurations(minSeconds, idealSeconds int) error {
	if minSeconds <= 0 || minSeconds > 180*60 || idealSeconds < minSeconds || idealSeconds > 180*60 {
		return errors.New("durations must be positive, ideal must be at least minimum, and both must be at most 180 minutes")
	}
	return nil
}

func cloneMetadata(metadata map[string]any) map[string]any {
	if metadata == nil {
		return nil
	}
	clone := make(map[string]any, len(metadata))
	for key, value := range metadata {
		clone[key] = value
	}
	return clone
}

func cloneAuditEvent(event domain.JobAuditEvent) domain.JobAuditEvent {
	event.Metadata = cloneMetadata(event.Metadata)
	return event
}
