package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

var (
	ErrJobNotFound       = errors.New("job not found")
	ErrInvalidTransition = errors.New("invalid job status transition")
)

type Store interface {
	Create(context.Context, domain.CreateJobInput) (domain.Job, error)
	Get(context.Context, string) (domain.Job, bool)
	Transition(context.Context, string, domain.JobStatus, string) (domain.Job, error)
	AppendLog(context.Context, string, string) error
}

type MemoryStore struct {
	mu   sync.RWMutex
	jobs map[string]domain.Job
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{jobs: make(map[string]domain.Job)}
}

func (s *MemoryStore) Create(_ context.Context, input domain.CreateJobInput) (domain.Job, error) {
	if input.Kind == "" {
		return domain.Job{}, fmt.Errorf("job kind is required")
	}
	id, err := newID()
	if err != nil {
		return domain.Job{}, fmt.Errorf("generate job id: %w", err)
	}
	now := time.Now().UTC()
	job := domain.Job{
		ID:        id,
		Kind:      input.Kind,
		Status:    domain.JobStatusQueued,
		SourceURL: input.SourceURL,
		ClipCount: input.ClipCount,
		OutputDir: input.OutputDir,
		Metadata:  cloneMetadata(input.Metadata),
		CreatedAt: now,
		UpdatedAt: now,
	}

	s.mu.Lock()
	s.jobs[id] = job
	s.mu.Unlock()
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
	if next == domain.JobStatusFailed {
		job.Error = message
	}
	job.UpdatedAt = time.Now().UTC()
	s.jobs[id] = job
	return cloneJob(job), nil
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

func allowedTransition(current, next domain.JobStatus) bool {
	switch current {
	case domain.JobStatusQueued:
		return next == domain.JobStatusProcessing || next == domain.JobStatusFailed
	case domain.JobStatusProcessing:
		return next == domain.JobStatusCompleted || next == domain.JobStatusFailed
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
