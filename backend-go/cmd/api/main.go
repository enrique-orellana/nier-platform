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

	var store jobs.Store
	var closeStore func() error
	if cfg.DatabaseURL != "" {
		postgresStore, storeErr := jobs.OpenPostgresStore(context.Background(), cfg.DatabaseURL)
		if storeErr != nil {
			log.Fatalf("open postgres job store: %v", storeErr)
		}
		store = postgresStore
		closeStore = postgresStore.Close
	} else {
		log.Print("DATABASE_URL is not configured; using in-memory job storage")
		memoryStore := jobs.NewMemoryStore()
		store = memoryStore
		closeStore = func() error { return nil }
	}
	defer closeStore()
	var sourceDownloader workers.SourceDownloader
	var artifactDownloader workers.ArtifactDownloader
	if cfg.S3Bucket != "" || cfg.S3Endpoint != "" {
		sourceStore, storeErr := integrations.NewS3Store(context.Background(), integrations.S3Config{Endpoint: cfg.S3Endpoint, Region: cfg.S3Region, AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey, ForcePathStyle: cfg.S3ForcePathStyle, Bucket: cfg.S3Bucket, SourceBucket: cfg.S3SourceBucket, PublicEndpoint: cfg.S3PublicEndpoint, PublicURLBase: cfg.S3PublicURLBase})
		if storeErr != nil {
			log.Printf("S3 source store unavailable: %v", storeErr)
		} else {
			sourceDownloader = sourceStore
			artifactDownloader = sourceStore
		}
	}
	runner := &jobs.Runner{
		Store: store,
		Worker: workers.PythonWorkerAdapter{
			PythonBinary:           os.Getenv("PYTHON_BINARY"),
			WorkerScript:           os.Getenv("PYTHON_WORKER_SCRIPT"),
			SourceDownloader:       sourceDownloader,
			ArtifactDownloader:     artifactDownloader,
			AuditSink:              store,
			AuditBodyHostAllowlist: cfg.AuditBodyHostAllowlist,
		},
	}
	runtimeContext, cancelRuntime := context.WithCancel(context.Background())
	defer cancelRuntime()
	scheduler := jobs.NewScheduler(store, runner, cfg.MaxConcurrentJobs)
	if err := scheduler.Start(runtimeContext); err != nil {
		log.Fatalf("start job scheduler: %v", err)
	}
	translationClient := workers.PythonOperationClient{
		PythonBinary: os.Getenv("PYTHON_BINARY"),
		WorkerScript: os.Getenv("PYTHON_WORKER_SCRIPT"),
	}
	server := &http.Server{
		Addr:              cfg.Address(),
		Handler:           httpapi.NewServerWithDependenciesAndScheduler(cfg, store, runner, translationClient, scheduler).Handler(),
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
			_ = scheduler.Stop(context.Background())
			log.Fatal(err)
		}
	case <-stop:
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Fatal(err)
		}
		if err := scheduler.Stop(ctx); err != nil {
			log.Printf("stop job scheduler: %v", err)
		}
	}
}
