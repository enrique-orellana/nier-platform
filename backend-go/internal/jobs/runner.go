package jobs

import (
	"context"
	"fmt"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

type JobWorker interface {
	Run(context.Context, domain.Job, string, func(string)) error
}

type Runner struct {
	Store  Store
	Worker JobWorker
}

func (r Runner) RunOnce(ctx context.Context, jobID string) error {
	if r.Store == nil {
		return fmt.Errorf("job store is required")
	}
	if r.Worker == nil {
		return fmt.Errorf("job worker is required")
	}
	job, ok := r.Store.Get(ctx, jobID)
	if !ok {
		return ErrJobNotFound
	}
	if _, err := r.Store.Transition(ctx, jobID, domain.JobStatusProcessing, ""); err != nil {
		return err
	}
	if err := r.Store.AppendLog(ctx, jobID, "Job started by worker."); err != nil {
		return err
	}

	var logErr error
	outputDir := job.OutputDir
	if outputDir == "" {
		outputDir = "output/" + job.ID
	}
	workerErr := r.Worker.Run(ctx, job, outputDir, func(message string) {
		if logErr != nil {
			return
		}
		if err := r.Store.AppendLog(ctx, jobID, message); err != nil {
			logErr = err
		}
	})
	if logErr != nil && workerErr == nil {
		workerErr = logErr
	}
	if workerErr != nil {
		_ = r.Store.AppendLog(ctx, jobID, fmt.Sprintf("Execution error: %s", workerErr))
		_, transitionErr := r.Store.Transition(ctx, jobID, domain.JobStatusFailed, workerErr.Error())
		if transitionErr != nil {
			return fmt.Errorf("mark job failed: %w", transitionErr)
		}
		return workerErr
	}
	_, err := r.Store.Transition(ctx, jobID, domain.JobStatusCompleted, "")
	return err
}
