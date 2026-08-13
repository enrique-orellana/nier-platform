package jobs

import (
	"context"
	"fmt"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

type JobWorker interface {
	Run(context.Context, domain.Job, string, func(string)) error
}

type ResultWorker interface {
	RunResult(context.Context, domain.Job, string, func(string)) ([]byte, error)
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
	job, err := r.Store.Claim(ctx, jobID)
	if err != nil {
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
	var result []byte
	var workerErr error
	logCallback := func(message string) {
		if logErr != nil {
			return
		}
		if err := r.Store.AppendLog(ctx, jobID, message); err != nil {
			logErr = err
		}
	}
	if resultWorker, ok := r.Worker.(ResultWorker); ok {
		result, workerErr = resultWorker.RunResult(ctx, job, outputDir, logCallback)
	} else {
		workerErr = r.Worker.Run(ctx, job, outputDir, logCallback)
	}
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
	if len(result) > 0 {
		if err := r.Store.SetResult(ctx, jobID, result); err != nil {
			return err
		}
	}
	_, err = r.Store.Transition(ctx, jobID, domain.JobStatusCompleted, "")
	return err
}
