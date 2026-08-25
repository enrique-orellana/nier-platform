package jobs

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/mutonby/openshorts/backend-go/internal/domain"
	"github.com/mutonby/openshorts/backend-go/internal/versions"
)

//go:embed migrations/001_jobs.sql
var jobsSchema string

//go:embed migrations/002_highlight_projects.sql
var highlightProjectsSchema string

//go:embed migrations/003_deferred_clip_rendering.sql
var deferredClipRenderingSchema string

//go:embed migrations/004_discarded_clip_status.sql
var discardedClipStatusSchema string

//go:embed migrations/005_job_audit_events.sql
var auditEventsSchema string

//go:embed migrations/006_render_performance_metrics.sql
var renderPerformanceMetricsSchema string

//go:embed migrations/007_render_metric_acceleration_mode.sql
var renderMetricAccelerationModeSchema string

type PostgresStore struct {
	db          *sql.DB
	versionRepo versions.Repository
}

func NewPostgresStore(db *sql.DB) (*PostgresStore, error) {
	if db == nil {
		return nil, errors.New("database is required")
	}
	versionRepo, err := versions.NewPostgresRepository(db)
	if err != nil {
		return nil, err
	}
	return &PostgresStore{db: db, versionRepo: versionRepo}, nil
}

func (s *PostgresStore) VersionRepository() versions.Repository { return s.versionRepo }

func OpenPostgresStore(ctx context.Context, databaseURL string) (*PostgresStore, error) {
	if databaseURL == "" {
		return nil, errors.New("database URL is required")
	}
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database URL: %w", err)
	}
	db := sql.OpenDB(stdlib.GetConnector(*config))
	store, err := NewPostgresStore(db)
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	if err := store.Migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *PostgresStore) Close() error { return s.db.Close() }

func (s *PostgresStore) Migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, jobsSchema); err != nil {
		return fmt.Errorf("run jobs migration: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, highlightProjectsSchema); err != nil {
		return fmt.Errorf("run highlight projects migration: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, deferredClipRenderingSchema); err != nil {
		return fmt.Errorf("run deferred clip rendering migration: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, discardedClipStatusSchema); err != nil {
		return fmt.Errorf("run discarded clip status migration: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, auditEventsSchema); err != nil {
		return fmt.Errorf("run audit events migration: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, renderPerformanceMetricsSchema); err != nil {
		return fmt.Errorf("run render performance metrics migration: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, renderMetricAccelerationModeSchema); err != nil {
		return fmt.Errorf("run render metric acceleration mode migration: %w", err)
	}
	return nil
}

func (s *PostgresStore) Create(ctx context.Context, input domain.CreateJobInput) (domain.Job, error) {
	if input.Kind == "" {
		return domain.Job{}, errors.New("job kind is required")
	}
	id, err := newID()
	if err != nil {
		return domain.Job{}, fmt.Errorf("generate job id: %w", err)
	}
	metadata, err := json.Marshal(input.Metadata)
	if err != nil {
		return domain.Job{}, fmt.Errorf("encode job metadata: %w", err)
	}
	if input.Metadata == nil {
		metadata = []byte(`{}`)
	}
	var job domain.Job
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO jobs (id, kind, project_id, status, source_url, clip_count, output_dir, parent_job_id, clip_index, metadata)
		VALUES ($1, $2, NULLIF($3, '')::uuid, 'queued', NULLIF($4, ''), COALESCE(NULLIF($5, 0), 6), $6, NULLIF($7, '')::uuid, $8, $9::jsonb)
		RETURNING id, kind, COALESCE(project_id::text, ''), status, COALESCE(source_url, ''), clip_count, output_dir, COALESCE(parent_job_id::text, ''), clip_index, metadata, result, COALESCE(error, ''), created_at, updated_at
	`, id, input.Kind, input.ProjectID, input.SourceURL, input.ClipCount, input.OutputDir, input.ParentJobID, input.ClipIndex, metadata).Scan(
		&job.ID, &job.Kind, &job.ProjectID, &job.Status, &job.SourceURL, &job.ClipCount, &job.OutputDir, &job.ParentJobID, &job.ClipIndex,
		&metadata, &job.Result, &job.Error, &job.CreatedAt, &job.UpdatedAt,
	)
	if err != nil {
		return domain.Job{}, fmt.Errorf("create job: %w", err)
	}
	job.Metadata = decodeMetadata(metadata)
	return job, nil
}

func (s *PostgresStore) CreateClipRenderIfAbsent(ctx context.Context, input domain.CreateJobInput) (domain.Job, error) {
	if input.Kind != "clip-render" {
		return domain.Job{}, errors.New("clip render job kind is required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Job{}, err
	}
	defer tx.Rollback()
	lockKey := fmt.Sprintf("clip-render:%s:%d", input.ParentJobID, input.ClipIndex)
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, lockKey); err != nil {
		return domain.Job{}, err
	}
	var existing domain.Job
	existing, err = scanJob(tx.QueryRowContext(ctx, `
		SELECT id, kind, COALESCE(project_id::text, ''), status, COALESCE(source_url, ''), clip_count, output_dir,
		       COALESCE(parent_job_id::text, ''), clip_index, metadata, result, COALESCE(error, ''), created_at, updated_at
		FROM jobs
		WHERE kind = 'clip-render' AND parent_job_id = NULLIF($1, '')::uuid AND clip_index = $2
		  AND status IN ('queued', 'processing')
		ORDER BY created_at DESC, id DESC
		LIMIT 1
	`, input.ParentJobID, input.ClipIndex))
	if err == nil {
		if err := tx.Commit(); err != nil {
			return domain.Job{}, err
		}
		return existing, nil
	}
	if !errors.Is(err, ErrJobNotFound) {
		return domain.Job{}, err
	}
	id, err := newID()
	if err != nil {
		return domain.Job{}, fmt.Errorf("generate id: %w", err)
	}
	metadata, err := json.Marshal(input.Metadata)
	if err != nil {
		return domain.Job{}, fmt.Errorf("encode job metadata: %w", err)
	}
	if input.Metadata == nil {
		metadata = []byte(`{}`)
	}
	err = tx.QueryRowContext(ctx, `
		INSERT INTO jobs (id, kind, project_id, status, source_url, clip_count, output_dir, parent_job_id, clip_index, metadata)
		VALUES ($1, $2, NULLIF($3, '')::uuid, 'queued', NULLIF($4, ''), COALESCE(NULLIF($5, 0), 6), $6, NULLIF($7, '')::uuid, $8, $9::jsonb)
		RETURNING id, kind, COALESCE(project_id::text, ''), status, COALESCE(source_url, ''), clip_count, output_dir, COALESCE(parent_job_id::text, ''), clip_index, metadata, result, COALESCE(error, ''), created_at, updated_at
	`, id, input.Kind, input.ProjectID, input.SourceURL, input.ClipCount, input.OutputDir, input.ParentJobID, input.ClipIndex, metadata).Scan(
		&existing.ID, &existing.Kind, &existing.ProjectID, &existing.Status, &existing.SourceURL, &existing.ClipCount, &existing.OutputDir, &existing.ParentJobID, &existing.ClipIndex,
		&metadata, &existing.Result, &existing.Error, &existing.CreatedAt, &existing.UpdatedAt,
	)
	if err != nil {
		return domain.Job{}, fmt.Errorf("create clip render job: %w", err)
	}
	existing.Metadata = decodeMetadata(metadata)
	if err := tx.Commit(); err != nil {
		return domain.Job{}, err
	}
	return existing, nil
}

func (s *PostgresStore) CreateIfNoActive(ctx context.Context, kind string, input domain.CreateJobInput) (domain.Job, error) {
	if kind == "" || input.Kind == "" {
		return domain.Job{}, errors.New("job kind is required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Job{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, kind); err != nil {
		return domain.Job{}, err
	}
	var active bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM jobs WHERE kind = $1 AND status IN ('queued', 'processing'))`, kind).Scan(&active); err != nil {
		return domain.Job{}, err
	}
	if active {
		return domain.Job{}, ErrActiveJob
	}
	id, err := newID()
	if err != nil {
		return domain.Job{}, fmt.Errorf("generate job id: %w", err)
	}
	metadata, err := json.Marshal(input.Metadata)
	if err != nil {
		return domain.Job{}, fmt.Errorf("encode job metadata: %w", err)
	}
	if input.Metadata == nil {
		metadata = []byte(`{}`)
	}
	var job domain.Job
	err = tx.QueryRowContext(ctx, `
		INSERT INTO jobs (id, kind, project_id, status, source_url, clip_count, output_dir, parent_job_id, clip_index, metadata)
		VALUES ($1, $2, NULLIF($3, '')::uuid, 'queued', NULLIF($4, ''), COALESCE(NULLIF($5, 0), 6), $6, NULLIF($7, '')::uuid, $8, $9::jsonb)
		RETURNING id, kind, COALESCE(project_id::text, ''), status, COALESCE(source_url, ''), clip_count, output_dir, COALESCE(parent_job_id::text, ''), clip_index, metadata, result, COALESCE(error, ''), created_at, updated_at
	`, id, input.Kind, input.ProjectID, input.SourceURL, input.ClipCount, input.OutputDir, input.ParentJobID, input.ClipIndex, metadata).Scan(
		&job.ID, &job.Kind, &job.ProjectID, &job.Status, &job.SourceURL, &job.ClipCount, &job.OutputDir, &job.ParentJobID, &job.ClipIndex,
		&metadata, &job.Result, &job.Error, &job.CreatedAt, &job.UpdatedAt,
	)
	if err != nil {
		return domain.Job{}, fmt.Errorf("create job: %w", err)
	}
	job.Metadata = decodeMetadata(metadata)
	if err := tx.Commit(); err != nil {
		return domain.Job{}, err
	}
	return job, nil
}

func (s *PostgresStore) CreateHighlightProject(ctx context.Context, input domain.CreateHighlightProjectInput) (domain.HighlightProject, domain.Job, error) {
	if err := validateHighlightProjectInput(input.Name, input.SourceBucket, input.SourceKey, input.MinDurationSeconds, input.IdealDurationSeconds); err != nil {
		return domain.HighlightProject{}, domain.Job{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.HighlightProject{}, domain.Job{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('highlight-generation'))`); err != nil {
		return domain.HighlightProject{}, domain.Job{}, err
	}
	var active bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM jobs WHERE kind = 'highlight-generation' AND status IN ('queued', 'processing'))`).Scan(&active); err != nil {
		return domain.HighlightProject{}, domain.Job{}, err
	}
	if active {
		return domain.HighlightProject{}, domain.Job{}, ErrActiveJob
	}
	projectID, err := newID()
	if err != nil {
		return domain.HighlightProject{}, domain.Job{}, fmt.Errorf("generate project id: %w", err)
	}
	var project domain.HighlightProject
	err = tx.QueryRowContext(ctx, `
		INSERT INTO highlight_projects (id, name, source_bucket, source_key, min_duration_seconds, ideal_duration_seconds)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, name, source_bucket, source_key, min_duration_seconds, ideal_duration_seconds, COALESCE(latest_job_id::text, ''), created_at, updated_at
	`, projectID, input.Name, input.SourceBucket, input.SourceKey, input.MinDurationSeconds, input.IdealDurationSeconds).Scan(
		&project.ID, &project.Name, &project.SourceBucket, &project.SourceKey, &project.MinDurationSeconds,
		&project.IdealDurationSeconds, &project.LatestJobID, &project.CreatedAt, &project.UpdatedAt,
	)
	if err != nil {
		return domain.HighlightProject{}, domain.Job{}, fmt.Errorf("create highlight project: %w", err)
	}
	job, err := insertQueuedJob(ctx, tx, domain.CreateJobInput{
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
	if _, err := tx.ExecContext(ctx, `UPDATE highlight_projects SET latest_job_id = $2, updated_at = now() WHERE id = $1`, project.ID, job.ID); err != nil {
		return domain.HighlightProject{}, domain.Job{}, err
	}
	project.LatestJobID = job.ID
	project.UpdatedAt = job.UpdatedAt
	if err := tx.Commit(); err != nil {
		return domain.HighlightProject{}, domain.Job{}, err
	}
	return project, job, nil
}

func (s *PostgresStore) ListHighlightProjects(ctx context.Context) ([]domain.HighlightProject, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, source_bucket, source_key, min_duration_seconds, ideal_duration_seconds,
		       COALESCE(latest_job_id::text, ''), created_at, updated_at
		FROM highlight_projects ORDER BY updated_at DESC, id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := make([]domain.HighlightProject, 0)
	for rows.Next() {
		project, err := scanHighlightProject(rows)
		if err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}
	return projects, rows.Err()
}

func (s *PostgresStore) GetHighlightProject(ctx context.Context, id string) (domain.HighlightProject, domain.Job, error) {
	project, err := scanHighlightProject(s.db.QueryRowContext(ctx, `
		SELECT id, name, source_bucket, source_key, min_duration_seconds, ideal_duration_seconds,
		       COALESCE(latest_job_id::text, ''), created_at, updated_at
		FROM highlight_projects WHERE id = $1
	`, id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.HighlightProject{}, domain.Job{}, ErrProjectNotFound
		}
		return domain.HighlightProject{}, domain.Job{}, err
	}
	if project.LatestJobID == "" {
		return domain.HighlightProject{}, domain.Job{}, ErrProjectNotFound
	}
	job, err := s.get(ctx, s.db, project.LatestJobID)
	if err != nil {
		return domain.HighlightProject{}, domain.Job{}, err
	}
	return project, job, nil
}

func (s *PostgresStore) UpdateHighlightProject(ctx context.Context, id string, input domain.UpdateHighlightProjectInput) (domain.HighlightProject, error) {
	if err := validateHighlightProjectDurations(input.MinDurationSeconds, input.IdealDurationSeconds); err != nil {
		return domain.HighlightProject{}, err
	}
	if input.Name == "" {
		return domain.HighlightProject{}, errors.New("project name is required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.HighlightProject{}, err
	}
	defer tx.Rollback()
	project, err := scanHighlightProject(tx.QueryRowContext(ctx, `
		SELECT id, name, source_bucket, source_key, min_duration_seconds, ideal_duration_seconds,
		       COALESCE(latest_job_id::text, ''), created_at, updated_at
		FROM highlight_projects WHERE id = $1 FOR UPDATE
	`, id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.HighlightProject{}, ErrProjectNotFound
		}
		return domain.HighlightProject{}, err
	}
	if project.LatestJobID != "" {
		job, err := s.getForUpdate(ctx, tx, project.LatestJobID)
		if err != nil {
			return domain.HighlightProject{}, err
		}
		if isActive(job.Status) {
			return domain.HighlightProject{}, ErrProjectActive
		}
	}
	if err := tx.QueryRowContext(ctx, `
		UPDATE highlight_projects
		SET name = $2, min_duration_seconds = $3, ideal_duration_seconds = $4, updated_at = now()
		WHERE id = $1
		RETURNING id, name, source_bucket, source_key, min_duration_seconds, ideal_duration_seconds,
		          COALESCE(latest_job_id::text, ''), created_at, updated_at
	`, id, input.Name, input.MinDurationSeconds, input.IdealDurationSeconds).Scan(
		&project.ID, &project.Name, &project.SourceBucket, &project.SourceKey, &project.MinDurationSeconds,
		&project.IdealDurationSeconds, &project.LatestJobID, &project.CreatedAt, &project.UpdatedAt,
	); err != nil {
		return domain.HighlightProject{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.HighlightProject{}, err
	}
	return project, nil
}

func (s *PostgresStore) RetryHighlightProject(ctx context.Context, id string) (domain.Job, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Job{}, err
	}
	defer tx.Rollback()
	project, err := scanHighlightProject(tx.QueryRowContext(ctx, `
		SELECT id, name, source_bucket, source_key, min_duration_seconds, ideal_duration_seconds,
		       COALESCE(latest_job_id::text, ''), created_at, updated_at
		FROM highlight_projects WHERE id = $1 FOR UPDATE
	`, id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Job{}, ErrProjectNotFound
		}
		return domain.Job{}, err
	}
	if project.LatestJobID != "" {
		latest, err := s.getForUpdate(ctx, tx, project.LatestJobID)
		if err != nil {
			return domain.Job{}, err
		}
		if isActive(latest.Status) {
			return domain.Job{}, ErrProjectActive
		}
	}
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('highlight-generation'))`); err != nil {
		return domain.Job{}, err
	}
	var active bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM jobs WHERE kind = 'highlight-generation' AND status IN ('queued', 'processing'))`).Scan(&active); err != nil {
		return domain.Job{}, err
	}
	if active {
		return domain.Job{}, ErrActiveJob
	}
	job, err := insertQueuedJob(ctx, tx, domain.CreateJobInput{
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
	if _, err := tx.ExecContext(ctx, `UPDATE highlight_projects SET latest_job_id = $2, updated_at = now() WHERE id = $1`, id, job.ID); err != nil {
		return domain.Job{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Job{}, err
	}
	return job, nil
}

func (s *PostgresStore) DeleteHighlightProject(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM highlight_projects WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return ErrProjectNotFound
	}
	return nil
}

type sqlJobInserter interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func insertQueuedJob(ctx context.Context, queryer sqlJobInserter, input domain.CreateJobInput) (domain.Job, error) {
	id, err := newID()
	if err != nil {
		return domain.Job{}, fmt.Errorf("generate job id: %w", err)
	}
	metadata, err := json.Marshal(input.Metadata)
	if err != nil {
		return domain.Job{}, fmt.Errorf("encode job metadata: %w", err)
	}
	if input.Metadata == nil {
		metadata = []byte(`{}`)
	}
	var job domain.Job
	err = queryer.QueryRowContext(ctx, `
		INSERT INTO jobs (id, kind, project_id, status, source_url, clip_count, output_dir, metadata)
		VALUES ($1, $2, NULLIF($3, '')::uuid, 'queued', NULLIF($4, ''), COALESCE(NULLIF($5, 0), 6), $6, $7::jsonb)
		RETURNING id, kind, COALESCE(project_id::text, ''), status, COALESCE(source_url, ''), clip_count, output_dir, metadata, result, COALESCE(error, ''), created_at, updated_at
	`, id, input.Kind, input.ProjectID, input.SourceURL, input.ClipCount, input.OutputDir, metadata).Scan(
		&job.ID, &job.Kind, &job.ProjectID, &job.Status, &job.SourceURL, &job.ClipCount, &job.OutputDir,
		&metadata, &job.Result, &job.Error, &job.CreatedAt, &job.UpdatedAt,
	)
	if err != nil {
		return domain.Job{}, fmt.Errorf("create job: %w", err)
	}
	job.Metadata = decodeMetadata(metadata)
	return job, nil
}

func (s *PostgresStore) Get(ctx context.Context, id string) (domain.Job, bool) {
	job, err := s.get(ctx, s.db, id)
	if err != nil {
		return domain.Job{}, false
	}
	return job, true
}

func (s *PostgresStore) DeleteJob(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM clip_statuses WHERE project_id = $1`, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM clip_version_heads WHERE project_id = $1`, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM clip_versions WHERE project_id = $1`, id); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM jobs WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return ErrJobNotFound
	}
	return tx.Commit()
}

func (s *PostgresStore) Claim(ctx context.Context, id string) (domain.Job, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Job{}, err
	}
	defer tx.Rollback()
	job, err := s.getForUpdate(ctx, tx, id)
	if err != nil {
		return domain.Job{}, err
	}
	if job.Status != domain.JobStatusQueued {
		return domain.Job{}, fmt.Errorf("%w: %s", ErrJobNotClaimable, job.Status)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE jobs SET status = 'processing', error = NULL, updated_at = now() WHERE id = $1`, id); err != nil {
		return domain.Job{}, err
	}
	job.Status = domain.JobStatusProcessing
	job.Error = ""
	job.UpdatedAt = time.Now().UTC()
	if err := tx.Commit(); err != nil {
		return domain.Job{}, err
	}
	return job, nil
}

func (s *PostgresStore) Transition(ctx context.Context, id string, next domain.JobStatus, message string) (domain.Job, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Job{}, err
	}
	defer tx.Rollback()
	job, err := s.getForUpdate(ctx, tx, id)
	if err != nil {
		return domain.Job{}, err
	}
	if !allowedTransition(job.Status, next) {
		return domain.Job{}, fmt.Errorf("%w: %s -> %s", ErrInvalidTransition, job.Status, next)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE jobs SET status = $2, error = NULLIF($3, ''), updated_at = now() WHERE id = $1`, id, next, message); err != nil {
		return domain.Job{}, err
	}
	job.Status = next
	job.Error = ""
	if next == domain.JobStatusFailed || next == domain.JobStatusCancelled {
		job.Error = message
	}
	job.UpdatedAt = time.Now().UTC()
	if err := tx.Commit(); err != nil {
		return domain.Job{}, err
	}
	return job, nil
}

func (s *PostgresStore) AppendLog(ctx context.Context, id, message string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM jobs WHERE id = $1 FOR UPDATE)`, id).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrJobNotFound
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO job_logs (job_id, sequence, message) VALUES ($1, COALESCE((SELECT MAX(sequence) + 1 FROM job_logs WHERE job_id = $1), 1), $2)`, id, message)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE jobs SET updated_at = now() WHERE id = $1`, id)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *PostgresStore) SetResult(ctx context.Context, id string, result []byte) error {
	if _, err := s.db.ExecContext(ctx, `UPDATE jobs SET result = $2::jsonb, updated_at = now() WHERE id = $1`, id, result); err != nil {
		return err
	}
	return nil
}

func (s *PostgresStore) ListByStatus(ctx context.Context, status domain.JobStatus) ([]domain.Job, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, kind, COALESCE(project_id::text, ''), status, COALESCE(source_url, ''), clip_count, output_dir, COALESCE(parent_job_id::text, ''), clip_index, metadata, result, COALESCE(error, ''), created_at, updated_at FROM jobs WHERE status = $1 ORDER BY created_at, id`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	jobs := make([]domain.Job, 0)
	for rows.Next() {
		job, err := scanJob(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return jobs, nil
}

func (s *PostgresStore) SetOutputDir(ctx context.Context, id, outputDir string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE jobs SET output_dir = $2, updated_at = now() WHERE id = $1`, id, outputDir)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return ErrJobNotFound
	}
	return nil
}

func (s *PostgresStore) GetClipStatuses(ctx context.Context, projectID string) (map[int]ClipStatus, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT clip_index, status, updated_at
		FROM clip_statuses
		WHERE project_id = $1
		ORDER BY clip_index
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("get clip statuses: %w", err)
	}
	defer rows.Close()
	statuses := make(map[int]ClipStatus)
	for rows.Next() {
		var index int
		var status ClipStatus
		if err := rows.Scan(&index, &status.Status, &status.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan clip status: %w", err)
		}
		statuses[index] = status
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate clip statuses: %w", err)
	}
	return statuses, nil
}

func (s *PostgresStore) SetClipStatus(ctx context.Context, projectID string, clipIndex int, status string) (ClipStatus, error) {
	var updatedAt time.Time
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO clip_statuses (project_id, clip_index, status, updated_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (project_id, clip_index)
		DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
		RETURNING updated_at
	`, projectID, clipIndex, status).Scan(&updatedAt)
	if err != nil {
		return ClipStatus{}, fmt.Errorf("set clip status: %w", err)
	}
	return ClipStatus{Status: status, UpdatedAt: updatedAt}, nil
}

func (s *PostgresStore) ListByKind(ctx context.Context, kind string) ([]domain.Job, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, kind, COALESCE(project_id::text, ''), status, COALESCE(source_url, ''), clip_count, output_dir, COALESCE(parent_job_id::text, ''), clip_index, metadata, result, COALESCE(error, ''), created_at, updated_at FROM jobs WHERE kind = $1 ORDER BY created_at, id`, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]domain.Job, 0)
	for rows.Next() {
		job, err := scanJob(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, job)
	}
	return result, rows.Err()
}

func (s *PostgresStore) RequeueProcessing(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `UPDATE jobs SET status = 'queued', error = NULL, updated_at = now() WHERE status = 'processing'`)
	return err
}

const auditEventColumns = `id, job_id, sequence, category, name, status, provider, host, path, method,
       http_status, request_bytes, response_bytes, started_at, finished_at, duration_ms, detail, error,
       request_body, response_body, request_content_type, response_content_type, capture_mode, metadata`

func (s *PostgresStore) StartAuditEvent(ctx context.Context, jobID string, input domain.StartAuditEventInput) (domain.JobAuditEvent, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.JobAuditEvent{}, err
	}
	defer tx.Rollback()

	var lockedJobID string
	if err := tx.QueryRowContext(ctx, `SELECT id FROM jobs WHERE id = $1 FOR UPDATE`, jobID).Scan(&lockedJobID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.JobAuditEvent{}, ErrJobNotFound
		}
		return domain.JobAuditEvent{}, err
	}

	var sequence int
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(sequence), 0) + 1 FROM job_audit_events WHERE job_id = $1`, jobID).Scan(&sequence); err != nil {
		return domain.JobAuditEvent{}, err
	}
	id, err := newID()
	if err != nil {
		return domain.JobAuditEvent{}, fmt.Errorf("generate audit event id: %w", err)
	}
	metadata, err := json.Marshal(input.Metadata)
	if err != nil {
		return domain.JobAuditEvent{}, fmt.Errorf("encode audit metadata: %w", err)
	}
	if input.Metadata == nil {
		metadata = []byte(`{}`)
	}
	startedAt := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO job_audit_events (
			id, job_id, sequence, category, name, status, provider, host, path, method,
			request_bytes, started_at, detail, request_body, request_content_type, capture_mode, metadata
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
	`, id, jobID, sequence, input.Category, input.Name, domain.AuditEventStatusStarted, input.Provider, input.Host, input.Path, input.Method,
		input.RequestBytes, startedAt, input.Detail, input.RequestBody, input.RequestContentType, input.CaptureMode, metadata); err != nil {
		return domain.JobAuditEvent{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.JobAuditEvent{}, err
	}
	return domain.JobAuditEvent{
		ID:                 id,
		JobID:              jobID,
		Sequence:           sequence,
		Category:           input.Category,
		Name:               input.Name,
		Status:             domain.AuditEventStatusStarted,
		Provider:           input.Provider,
		Host:               input.Host,
		Path:               input.Path,
		Method:             input.Method,
		RequestBytes:       input.RequestBytes,
		StartedAt:          startedAt,
		Detail:             input.Detail,
		RequestBody:        input.RequestBody,
		RequestContentType: input.RequestContentType,
		CaptureMode:        input.CaptureMode,
		Metadata:           decodeMetadata(metadata),
	}, nil
}

func (s *PostgresStore) FinishAuditEvent(ctx context.Context, jobID, eventID string, input domain.FinishAuditEventInput) (domain.JobAuditEvent, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.JobAuditEvent{}, err
	}
	defer tx.Rollback()

	var startedAt time.Time
	if err := tx.QueryRowContext(ctx, `SELECT started_at FROM job_audit_events WHERE id = $1 AND job_id = $2 FOR UPDATE`, eventID, jobID).Scan(&startedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.JobAuditEvent{}, ErrAuditEventNotFound
		}
		return domain.JobAuditEvent{}, err
	}
	status := input.Status
	if status == "" {
		status = domain.AuditEventStatusUnknown
	}
	finishedAt := input.FinishedAt
	if finishedAt.IsZero() {
		finishedAt = time.Now().UTC()
	}
	durationMS := input.DurationMS
	if durationMS == 0 {
		durationMS = finishedAt.Sub(startedAt).Milliseconds()
	}
	metadata, err := json.Marshal(input.Metadata)
	if err != nil {
		return domain.JobAuditEvent{}, fmt.Errorf("encode audit metadata: %w", err)
	}
	var metadataArg any
	if input.Metadata != nil {
		metadataArg = metadata
	}
	row := tx.QueryRowContext(ctx, `
		UPDATE job_audit_events
		SET status = $1, http_status = $2, response_bytes = $3, finished_at = $4, duration_ms = $5,
		    response_body = $6, response_content_type = $7, detail = $8, error = $9,
		    metadata = CASE WHEN $10::jsonb IS NULL THEN metadata ELSE $10::jsonb END
		WHERE id = $11 AND job_id = $12
		RETURNING `+auditEventColumns,
		status, input.HTTPStatus, input.ResponseBytes, finishedAt, durationMS, input.ResponseBody,
		input.ResponseContentType, input.Detail, input.Error, metadataArg, eventID, jobID)
	event, err := scanAuditEvent(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.JobAuditEvent{}, ErrAuditEventNotFound
		}
		return domain.JobAuditEvent{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.JobAuditEvent{}, err
	}
	return event, nil
}

func (s *PostgresStore) ListAuditEvents(ctx context.Context, jobID string) ([]domain.JobAuditEvent, error) {
	var exists string
	if err := s.db.QueryRowContext(ctx, `SELECT id FROM jobs WHERE id = $1`, jobID).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrJobNotFound
		}
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+auditEventColumns+` FROM job_audit_events WHERE job_id = $1 ORDER BY sequence`, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := make([]domain.JobAuditEvent, 0)
	for rows.Next() {
		event, err := scanAuditEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func (s *PostgresStore) UpsertRenderPerformanceMetric(ctx context.Context, metric RenderPerformanceMetric) error {
	if err := validateRenderPerformanceMetric(metric); err != nil {
		return err
	}
	stageDurations, err := json.Marshal(metric.StageDurationsMS)
	if err != nil {
		return fmt.Errorf("encode render stage durations: %w", err)
	}
	if metric.StageDurationsMS == nil {
		stageDurations = []byte(`{}`)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO render_performance_metrics (
			render_id, job_id, version_id, clip_index, status, started_at, finished_at,
			total_duration_ms, stage_durations_ms, render_concurrency, worker_count,
			output_bytes, acceleration_mode, error
		) VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14)
		ON CONFLICT (render_id) DO UPDATE SET
			job_id = EXCLUDED.job_id,
			version_id = EXCLUDED.version_id,
			clip_index = EXCLUDED.clip_index,
			status = EXCLUDED.status,
			started_at = EXCLUDED.started_at,
			finished_at = EXCLUDED.finished_at,
			total_duration_ms = EXCLUDED.total_duration_ms,
			stage_durations_ms = EXCLUDED.stage_durations_ms,
			render_concurrency = EXCLUDED.render_concurrency,
			worker_count = EXCLUDED.worker_count,
			output_bytes = EXCLUDED.output_bytes,
			acceleration_mode = EXCLUDED.acceleration_mode,
			error = EXCLUDED.error,
			updated_at = now()
	`, metric.RenderID, metric.JobID, metric.VersionID, metric.ClipIndex, metric.Status,
		metric.StartedAt, metric.FinishedAt, metric.TotalDurationMS, stageDurations,
		metric.RenderConcurrency, metric.WorkerCount, metric.OutputBytes,
		metric.AccelerationMode, metric.Error)
	return err
}

func (s *PostgresStore) GetRenderPerformanceMetric(ctx context.Context, renderID string) (RenderPerformanceMetric, bool, error) {
	var metric RenderPerformanceMetric
	var stageDurations []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT render_id, job_id, COALESCE(version_id, ''), clip_index, status,
		       started_at, finished_at, total_duration_ms, stage_durations_ms,
		       render_concurrency, worker_count, output_bytes, acceleration_mode,
		       error, created_at, updated_at
		FROM render_performance_metrics WHERE render_id = $1
	`, renderID).Scan(
		&metric.RenderID, &metric.JobID, &metric.VersionID, &metric.ClipIndex, &metric.Status,
		&metric.StartedAt, &metric.FinishedAt, &metric.TotalDurationMS, &stageDurations,
		&metric.RenderConcurrency, &metric.WorkerCount, &metric.OutputBytes,
		&metric.AccelerationMode, &metric.Error,
		&metric.CreatedAt, &metric.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return RenderPerformanceMetric{}, false, nil
	}
	if err != nil {
		return RenderPerformanceMetric{}, false, err
	}
	metric.StageDurationsMS = map[string]int64{}
	if len(stageDurations) > 0 {
		if err := json.Unmarshal(stageDurations, &metric.StageDurationsMS); err != nil {
			return RenderPerformanceMetric{}, false, fmt.Errorf("decode render stage durations: %w", err)
		}
	}
	return metric, true, nil
}

func (s *PostgresStore) GetRenderPerformanceSummary(ctx context.Context, rangeKey string, now time.Time) (RenderPerformanceSummary, error) {
	period, err := ParseRenderPerformanceRange(rangeKey, now)
	if err != nil {
		return RenderPerformanceSummary{}, err
	}
	where, args := renderPerformanceTimeFilter(period)
	result := RenderPerformanceSummary{
		Range:  period.Key,
		From:   period.From,
		To:     period.To,
		Trend:  make([]RenderPerformanceTrendPoint, 0),
		Stages: make([]RenderPerformanceStage, 0),
		Recent: make([]RenderPerformanceRecentEntry, 0),
	}
	result.Summary.AccelerationCounts = map[string]int64{"cpu": 0, "gpu": 0}

	var averageDurationMS float64
	var p95DurationMS float64
	var cpuCount int64
	var gpuCount int64
	err = s.db.QueryRowContext(ctx, `
		SELECT COUNT(*)::bigint,
		       COUNT(*) FILTER (WHERE status = 'done')::bigint,
		       COUNT(*) FILTER (WHERE status = 'error')::bigint,
		       COALESCE(AVG(total_duration_ms) FILTER (WHERE status = 'done'), 0)::double precision,
		       COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_duration_ms) FILTER (WHERE status = 'done'), 0)::double precision,
		       COALESCE(SUM(output_bytes), 0)::bigint,
		       COUNT(*) FILTER (WHERE acceleration_mode = 'cpu')::bigint,
		       COUNT(*) FILTER (WHERE acceleration_mode = 'gpu')::bigint
		FROM render_performance_metrics
		WHERE `+where, args...).Scan(
		&result.Summary.RenderCount,
		&result.Summary.SuccessfulCount,
		&result.Summary.FailedCount,
		&averageDurationMS,
		&p95DurationMS,
		&result.Summary.TotalOutputBytes,
		&cpuCount,
		&gpuCount,
	)
	if err != nil {
		return RenderPerformanceSummary{}, fmt.Errorf("query render performance summary: %w", err)
	}
	result.Summary.AccelerationCounts["cpu"] = cpuCount
	result.Summary.AccelerationCounts["gpu"] = gpuCount
	result.Summary.AverageDurationMS = int64(averageDurationMS + 0.5)
	result.Summary.P95DurationMS = int64(p95DurationMS + 0.5)
	if result.Summary.RenderCount > 0 {
		result.Summary.SuccessRate = roundToOneDecimal(float64(result.Summary.SuccessfulCount) / float64(result.Summary.RenderCount) * 100)
	}

	trendRows, err := s.db.QueryContext(ctx, `
		SELECT TO_CHAR(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
		       COUNT(*)::bigint,
		       COUNT(*) FILTER (WHERE status = 'error')::bigint,
		       COALESCE(AVG(total_duration_ms) FILTER (WHERE status = 'done'), 0)::double precision,
		       COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_duration_ms) FILTER (WHERE status = 'done'), 0)::double precision
		FROM render_performance_metrics
		WHERE `+where+`
		GROUP BY 1
		ORDER BY 1`, args...)
	if err != nil {
		return RenderPerformanceSummary{}, fmt.Errorf("query render performance trend: %w", err)
	}
	for trendRows.Next() {
		var point RenderPerformanceTrendPoint
		var average, p95 float64
		if err := trendRows.Scan(&point.Date, &point.RenderCount, &point.FailedCount, &average, &p95); err != nil {
			trendRows.Close()
			return RenderPerformanceSummary{}, fmt.Errorf("scan render performance trend: %w", err)
		}
		point.AverageDurationMS = int64(average + 0.5)
		point.P95DurationMS = int64(p95 + 0.5)
		result.Trend = append(result.Trend, point)
	}
	if err := trendRows.Err(); err != nil {
		trendRows.Close()
		return RenderPerformanceSummary{}, fmt.Errorf("read render performance trend: %w", err)
	}
	trendRows.Close()

	stageRows, err := s.db.QueryContext(ctx, `
		SELECT stage.key, COALESCE(SUM((stage.value)::bigint), 0)::bigint
		FROM render_performance_metrics AS metrics
		CROSS JOIN LATERAL jsonb_each_text(metrics.stage_durations_ms) AS stage(key, value)
		WHERE metrics.status = 'done' AND `+where+`
		GROUP BY stage.key`, args...)
	if err != nil {
		return RenderPerformanceSummary{}, fmt.Errorf("query render performance stages: %w", err)
	}
	type stageTotal struct {
		name     string
		duration int64
	}
	stageTotals := make([]stageTotal, 0)
	var totalStageDuration int64
	for stageRows.Next() {
		var stage stageTotal
		if err := stageRows.Scan(&stage.name, &stage.duration); err != nil {
			stageRows.Close()
			return RenderPerformanceSummary{}, fmt.Errorf("scan render performance stage: %w", err)
		}
		stageTotals = append(stageTotals, stage)
		totalStageDuration += stage.duration
	}
	if err := stageRows.Err(); err != nil {
		stageRows.Close()
		return RenderPerformanceSummary{}, fmt.Errorf("read render performance stages: %w", err)
	}
	stageRows.Close()
	sort.Slice(stageTotals, func(i, j int) bool {
		if stageTotals[i].duration == stageTotals[j].duration {
			return stageTotals[i].name < stageTotals[j].name
		}
		return stageTotals[i].duration > stageTotals[j].duration
	})
	for _, stage := range stageTotals {
		share := float64(0)
		if totalStageDuration > 0 {
			share = roundToOneDecimal(float64(stage.duration) / float64(totalStageDuration) * 100)
		}
		result.Stages = append(result.Stages, RenderPerformanceStage{Name: stage.name, DurationMS: stage.duration, Share: share})
	}

	recentRows, err := s.db.QueryContext(ctx, `
		SELECT render_id, job_id, COALESCE(version_id, ''), clip_index, status,
		       total_duration_ms, acceleration_mode, output_bytes, finished_at, error
		FROM render_performance_metrics
		WHERE `+where+`
		ORDER BY finished_at DESC, render_id DESC
		LIMIT `+fmt.Sprint(renderPerformanceRecentLimit), args...)
	if err != nil {
		return RenderPerformanceSummary{}, fmt.Errorf("query recent render performance: %w", err)
	}
	for recentRows.Next() {
		var entry RenderPerformanceRecentEntry
		if err := recentRows.Scan(
			&entry.RenderID, &entry.JobID, &entry.VersionID, &entry.ClipIndex, &entry.Status,
			&entry.TotalDurationMS, &entry.AccelerationMode, &entry.OutputBytes, &entry.FinishedAt, &entry.Error,
		); err != nil {
			recentRows.Close()
			return RenderPerformanceSummary{}, fmt.Errorf("scan recent render performance: %w", err)
		}
		result.Recent = append(result.Recent, entry)
	}
	if err := recentRows.Err(); err != nil {
		recentRows.Close()
		return RenderPerformanceSummary{}, fmt.Errorf("read recent render performance: %w", err)
	}
	recentRows.Close()
	return result, nil
}

func renderPerformanceTimeFilter(period RenderPerformanceRange) (string, []any) {
	if period.From == nil {
		return "finished_at <= $1", []any{period.To}
	}
	return "finished_at >= $1 AND finished_at <= $2", []any{*period.From, period.To}
}

type sqlQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (s *PostgresStore) get(ctx context.Context, queryer sqlQueryer, id string) (domain.Job, error) {
	job, err := scanJob(queryer.QueryRowContext(ctx, `SELECT id, kind, COALESCE(project_id::text, ''), status, COALESCE(source_url, ''), clip_count, output_dir, COALESCE(parent_job_id::text, ''), clip_index, metadata, result, COALESCE(error, ''), created_at, updated_at FROM jobs WHERE id = $1`, id))
	if err != nil {
		return domain.Job{}, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT sequence, created_at, message FROM job_logs WHERE job_id = $1 ORDER BY sequence`, id)
	if err != nil {
		return domain.Job{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var entry domain.JobLog
		if err := rows.Scan(&entry.Sequence, &entry.Timestamp, &entry.Message); err != nil {
			return domain.Job{}, err
		}
		job.Logs = append(job.Logs, entry)
	}
	return job, rows.Err()
}

func (s *PostgresStore) getForUpdate(ctx context.Context, tx *sql.Tx, id string) (domain.Job, error) {
	return scanJob(tx.QueryRowContext(ctx, `SELECT id, kind, COALESCE(project_id::text, ''), status, COALESCE(source_url, ''), clip_count, output_dir, COALESCE(parent_job_id::text, ''), clip_index, metadata, result, COALESCE(error, ''), created_at, updated_at FROM jobs WHERE id = $1 FOR UPDATE`, id))
}

type rowScanner interface{ Scan(...any) error }

func scanJob(row rowScanner) (domain.Job, error) {
	var job domain.Job
	var status string
	var metadata, result []byte
	if err := row.Scan(&job.ID, &job.Kind, &job.ProjectID, &status, &job.SourceURL, &job.ClipCount, &job.OutputDir, &job.ParentJobID, &job.ClipIndex, &metadata, &result, &job.Error, &job.CreatedAt, &job.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Job{}, ErrJobNotFound
		}
		return domain.Job{}, err
	}
	job.Status = domain.JobStatus(status)
	job.Metadata = decodeMetadata(metadata)
	job.Result = append([]byte(nil), result...)
	return job, nil
}

func scanAuditEvent(row rowScanner) (domain.JobAuditEvent, error) {
	var event domain.JobAuditEvent
	var status string
	var finishedAt sql.NullTime
	var metadata []byte
	if err := row.Scan(
		&event.ID, &event.JobID, &event.Sequence, &event.Category, &event.Name, &status,
		&event.Provider, &event.Host, &event.Path, &event.Method, &event.HTTPStatus,
		&event.RequestBytes, &event.ResponseBytes, &event.StartedAt, &finishedAt, &event.DurationMS,
		&event.Detail, &event.Error, &event.RequestBody, &event.ResponseBody,
		&event.RequestContentType, &event.ResponseContentType, &event.CaptureMode, &metadata,
	); err != nil {
		return domain.JobAuditEvent{}, err
	}
	event.Status = domain.AuditEventStatus(status)
	if finishedAt.Valid {
		event.FinishedAt = finishedAt.Time
	}
	event.Metadata = decodeMetadata(metadata)
	return event, nil
}

func scanHighlightProject(row rowScanner) (domain.HighlightProject, error) {
	var project domain.HighlightProject
	if err := row.Scan(
		&project.ID, &project.Name, &project.SourceBucket, &project.SourceKey,
		&project.MinDurationSeconds, &project.IdealDurationSeconds, &project.LatestJobID,
		&project.CreatedAt, &project.UpdatedAt,
	); err != nil {
		return domain.HighlightProject{}, err
	}
	return project, nil
}

func decodeMetadata(value []byte) map[string]any {
	if len(value) == 0 {
		return map[string]any{}
	}
	metadata := map[string]any{}
	if json.Unmarshal(value, &metadata) != nil {
		return map[string]any{}
	}
	return metadata
}

var _ Store = (*PostgresStore)(nil)
