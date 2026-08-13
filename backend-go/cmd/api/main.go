package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/config"
	"github.com/mutonby/openshorts/backend-go/internal/httpapi"
	"github.com/mutonby/openshorts/backend-go/internal/integrations"
	"github.com/mutonby/openshorts/backend-go/internal/jobs"
	"github.com/mutonby/openshorts/backend-go/internal/workers"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	store := jobs.NewMemoryStore()
	var sourceDownloader workers.SourceDownloader
	if cfg.S3Bucket != "" || cfg.S3Endpoint != "" {
		sourceStore, storeErr := integrations.NewS3Store(context.Background(), integrations.S3Config{Endpoint: cfg.S3Endpoint, Region: cfg.S3Region, AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey, ForcePathStyle: cfg.S3ForcePathStyle, Bucket: cfg.S3Bucket, SourceBucket: cfg.S3SourceBucket})
		if storeErr != nil {
			log.Printf("S3 source store unavailable: %v", storeErr)
		} else {
			sourceDownloader = sourceStore
		}
	}
	runner := &jobs.Runner{
		Store: store,
		Worker: workers.PythonWorkerAdapter{
			PythonBinary:     os.Getenv("PYTHON_BINARY"),
			WorkerScript:     os.Getenv("PYTHON_WORKER_SCRIPT"),
			SourceDownloader: sourceDownloader,
		},
	}
	translationClient := workers.PythonOperationClient{
		PythonBinary: os.Getenv("PYTHON_BINARY"),
		WorkerScript: os.Getenv("PYTHON_WORKER_SCRIPT"),
	}
	server := &http.Server{
		Addr:              cfg.Address(),
		Handler:           httpapi.NewServerWithDependencies(cfg, store, runner, translationClient).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		log.Printf("control plane listening on %s", cfg.Address())
		serverErrors <- server.ListenAndServe()
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	select {
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	case <-stop:
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Fatal(err)
		}
	}
}
