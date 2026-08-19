package jobs

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

var ErrSchedulerNotStarted = errors.New("job scheduler is not started")

type runningJob struct {
	cancel context.CancelFunc
	done   chan struct{}
}

type Scheduler struct {
	store  Store
	runner *Runner
	limit  int

	mu      sync.Mutex
	queue   chan string
	cancel  context.CancelFunc
	wg      sync.WaitGroup
	started bool
	running map[string]runningJob
}

func NewScheduler(store Store, runner *Runner, maxConcurrent int) *Scheduler {
	if maxConcurrent < 1 {
		maxConcurrent = 1
	}
	return &Scheduler{store: store, runner: runner, limit: maxConcurrent, running: make(map[string]runningJob)}
}

func (s *Scheduler) Start(parent context.Context) error {
	if s.store == nil {
		return errors.New("job store is required")
	}
	if s.runner == nil {
		return errors.New("job runner is required")
	}

	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()

	if err := s.store.RequeueProcessing(parent); err != nil {
		return fmt.Errorf("recover processing jobs: %w", err)
	}
	queued, err := s.store.ListByStatus(parent, domain.JobStatusQueued)
	if err != nil {
		return fmt.Errorf("list queued jobs: %w", err)
	}

	ctx, cancel := context.WithCancel(parent)
	s.mu.Lock()
	s.queue = make(chan string, s.limit*2)
	s.cancel = cancel
	s.running = make(map[string]runningJob)
	s.started = true
	s.mu.Unlock()

	for range s.limit {
		s.wg.Add(1)
		go s.worker(ctx)
	}
	for _, job := range queued {
		if err := s.Submit(ctx, job.ID); err != nil {
			cancel()
			return fmt.Errorf("queue recovered job %s: %w", job.ID, err)
		}
	}
	return nil
}

func (s *Scheduler) Submit(ctx context.Context, jobID string) error {
	if jobID == "" {
		return errors.New("job ID is required")
	}
	s.mu.Lock()
	if !s.started || s.queue == nil {
		s.mu.Unlock()
		return ErrSchedulerNotStarted
	}
	queue := s.queue
	s.mu.Unlock()
	select {
	case queue <- jobID:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Scheduler) Started() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.started
}

func (s *Scheduler) Cancel(ctx context.Context, jobID string) (domain.Job, error) {
	if jobID == "" {
		return domain.Job{}, errors.New("job ID is required")
	}
	job, ok := s.store.Get(ctx, jobID)
	if !ok {
		return domain.Job{}, ErrJobNotFound
	}
	if job.Status == domain.JobStatusQueued {
		return s.store.Transition(ctx, jobID, domain.JobStatusCancelled, "Cancelled by user.")
	}
	if job.Status != domain.JobStatusProcessing {
		return job, nil
	}
	s.mu.Lock()
	run, running := s.running[jobID]
	s.mu.Unlock()
	if running {
		run.cancel()
		_ = s.store.AppendLog(context.Background(), jobID, "Cancellation requested by user.")
		select {
		case <-run.done:
		case <-ctx.Done():
			return job, ctx.Err()
		}
		if updated, ok := s.store.Get(context.Background(), jobID); ok {
			return updated, nil
		}
	}
	return job, nil
}

func (s *Scheduler) worker(ctx context.Context) {
	defer s.wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case jobID := <-s.queue:
			jobCtx, cancel := context.WithCancel(ctx)
			done := make(chan struct{})
			s.mu.Lock()
			s.running[jobID] = runningJob{cancel: cancel, done: done}
			s.mu.Unlock()
			_ = s.runner.RunOnce(jobCtx, jobID)
			close(done)
			s.mu.Lock()
			delete(s.running, jobID)
			s.mu.Unlock()
			cancel()
		}
	}
}

func (s *Scheduler) Stop(ctx context.Context) error {
	s.mu.Lock()
	if !s.started {
		s.mu.Unlock()
		return nil
	}
	cancel := s.cancel
	s.started = false
	s.cancel = nil
	s.mu.Unlock()
	cancel()

	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
