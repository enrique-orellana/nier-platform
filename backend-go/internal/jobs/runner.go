package jobs

import (
	"context"
	"errors"
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
	Store                  Store
	Worker                 JobWorker
	RuntimeMetadata        func(string) map[string]any
	ReleaseRuntimeMetadata func(string)
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
	if r.RuntimeMetadata != nil {
		if job.Metadata == nil {
			job.Metadata = make(map[string]any)
		}
		for key, value := range r.RuntimeMetadata(jobID) {
			job.Metadata[key] = value
		}
		if r.ReleaseRuntimeMetadata != nil {
			defer r.ReleaseRuntimeMetadata(jobID)
		}
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
		status := domain.JobStatusFailed
		if errors.Is(workerErr, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			status = domain.JobStatusCancelled
		}
		persistCtx := context.Background()
		message := workerErr.Error()
		if status == domain.JobStatusCancelled {
			message = "Job cancelled."
		}
		_ = r.Store.AppendLog(persistCtx, jobID, fmt.Sprintf("Execution stopped: %s", message))
		_, transitionErr := r.Store.Transition(persistCtx, jobID, status, message)
		if transitionErr != nil {
			return fmt.Errorf("mark job %s: %w", status, transitionErr)
		}
		return workerErr
	}
	if len(result) > 0 {
		if err := r.Store.SetResult(ctx, jobID, result); err != nil {
			return err
		}
	}
	completionStatus := domain.JobStatusCompleted
	if job.Kind == "clip-generation" {
		if deferred, ok := job.Metadata["defer_render"].(bool); ok && deferred {
			completionStatus = domain.JobStatusClipsReady
		}
	}
	_, err = r.Store.Transition(ctx, jobID, completionStatus, "")
	return err
}
