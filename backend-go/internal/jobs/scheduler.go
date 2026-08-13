package jobs

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

var ErrSchedulerNotStarted = errors.New("job scheduler is not started")

type Scheduler struct {
	store  Store
	runner *Runner
	limit  int

	mu      sync.Mutex
	queue   chan string
	cancel  context.CancelFunc
	wg      sync.WaitGroup
	started bool
}

func NewScheduler(store Store, runner *Runner, maxConcurrent int) *Scheduler {
	if maxConcurrent < 1 {
		maxConcurrent = 1
	}
	return &Scheduler{store: store, runner: runner, limit: maxConcurrent}
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

func (s *Scheduler) worker(ctx context.Context) {
	defer s.wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case jobID := <-s.queue:
			_ = s.runner.RunOnce(ctx, jobID)
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
