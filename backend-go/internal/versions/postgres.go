package versions

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/manifests"
)

type PostgresRepository struct {
	db *sql.DB
}

func NewPostgresRepository(db *sql.DB) (*PostgresRepository, error) {
	if db == nil {
		return nil, errors.New("database is required")
	}
	return &PostgresRepository{db: db}, nil
}

func (r *PostgresRepository) List(ctx context.Context, projectID string, clipIndex int) (string, []VersionRecord, error) {
	var current string
	err := r.db.QueryRowContext(ctx, `
		SELECT current_version_id::text
		FROM clip_version_heads
		WHERE project_id = $1 AND clip_index = $2
	`, projectID, clipIndex).Scan(&current)
	if errors.Is(err, sql.ErrNoRows) {
		current = ""
	} else if err != nil {
		return "", nil, fmt.Errorf("load current version head: %w", err)
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT version_id::text, COALESCE(parent_version_id::text, ''), manifest_revision,
		       status, COALESCE(output_url, ''), COALESCE(error, ''), created_at
		FROM clip_versions
		WHERE project_id = $1 AND clip_index = $2
		ORDER BY created_at ASC, version_id ASC
	`, projectID, clipIndex)
	if err != nil {
		return "", nil, fmt.Errorf("list versions: %w", err)
	}
	defer rows.Close()
	versions := make([]VersionRecord, 0)
	for rows.Next() {
		version, err := scanVersionRecord(rows)
		if err != nil {
			return "", nil, fmt.Errorf("scan version: %w", err)
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		return "", nil, fmt.Errorf("list versions rows: %w", err)
	}
	return current, versions, nil
}

func (r *PostgresRepository) Create(ctx context.Context, projectID string, clipIndex int, manifest map[string]any, parentVersionID *string) (VersionRecord, map[string]any, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return VersionRecord{}, nil, fmt.Errorf("begin version creation: %w", err)
	}
	defer tx.Rollback()
	parent := ""
	if parentVersionID != nil {
		parent = *parentVersionID
		if !validUUID(parent) {
			return VersionRecord{}, nil, ErrParentVersionMissing
		}
		var exists bool
		if err := tx.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM clip_versions
				WHERE version_id = $1 AND project_id = $2 AND clip_index = $3
			)
		`, parent, projectID, clipIndex).Scan(&exists); err != nil {
			return VersionRecord{}, nil, fmt.Errorf("validate parent version: %w", err)
		}
		if !exists {
			return VersionRecord{}, nil, ErrParentVersionMissing
		}
	}
	versionID, err := newUUID()
	if err != nil {
		return VersionRecord{}, nil, fmt.Errorf("generate version id: %w", err)
	}
	versionManifest := cloneManifest(manifest)
	versionManifest["version_id"] = versionID
	if parent == "" {
		versionManifest["parent_version_id"] = nil
	} else {
		versionManifest["parent_version_id"] = parent
	}
	versionManifest["render_status"] = string(RenderStatusPending)
	versionManifest["master"] = nil
	revision, err := manifests.CalculateRevision(versionManifest)
	if err != nil {
		return VersionRecord{}, nil, fmt.Errorf("calculate manifest revision: %w", err)
	}
	versionManifest["manifest_revision"] = revision
	encodedManifest, err := json.Marshal(versionManifest)
	if err != nil {
		return VersionRecord{}, nil, fmt.Errorf("encode version manifest: %w", err)
	}
	var record VersionRecord
	var createdAt time.Time
	err = tx.QueryRowContext(ctx, `
		INSERT INTO clip_versions (
			version_id, project_id, clip_index, parent_version_id, manifest,
			manifest_revision, status
		)
		VALUES ($1, $2, $3, NULLIF($4, '')::uuid, $5::jsonb, $6, $7)
		RETURNING version_id::text, COALESCE(parent_version_id::text, ''), manifest_revision,
		          status, COALESCE(output_url, ''), COALESCE(error, ''), created_at
	`, versionID, projectID, clipIndex, parent, encodedManifest, revision, RenderStatusPending).Scan(
		&record.VersionID, &record.ParentVersionID, &record.ManifestRevision, &record.Status,
		&record.OutputURL, &record.Error, &createdAt,
	)
	if err != nil {
		return VersionRecord{}, nil, fmt.Errorf("insert version: %w", err)
	}
	record.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
	if err := tx.Commit(); err != nil {
		return VersionRecord{}, nil, fmt.Errorf("commit version creation: %w", err)
	}
	return record, cloneManifest(versionManifest), nil
}

func (r *PostgresRepository) Load(ctx context.Context, projectID string, clipIndex int, versionID string) (VersionRecord, map[string]any, error) {
	if !validUUID(versionID) {
		return VersionRecord{}, nil, ErrInvalidVersionID
	}
	var record VersionRecord
	var createdAt time.Time
	var encoded []byte
	err := r.db.QueryRowContext(ctx, `
		SELECT version_id::text, COALESCE(parent_version_id::text, ''), manifest_revision,
		       status, COALESCE(output_url, ''), COALESCE(error, ''), created_at, manifest
		FROM clip_versions
		WHERE project_id = $1 AND clip_index = $2 AND version_id = $3
	`, projectID, clipIndex, versionID).Scan(
		&record.VersionID, &record.ParentVersionID, &record.ManifestRevision, &record.Status,
		&record.OutputURL, &record.Error, &createdAt, &encoded,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return VersionRecord{}, nil, ErrVersionNotFound
	}
	if err != nil {
		return VersionRecord{}, nil, fmt.Errorf("load version: %w", err)
	}
	record.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
	var manifest map[string]any
	if err := json.Unmarshal(encoded, &manifest); err != nil {
		return VersionRecord{}, nil, fmt.Errorf("decode version manifest: %w", err)
	}
	return record, manifest, nil
}

func (r *PostgresRepository) UpdateManifest(ctx context.Context, projectID string, clipIndex int, versionID string, manifest map[string]any) (VersionRecord, map[string]any, error) {
	if !validUUID(versionID) {
		return VersionRecord{}, nil, ErrInvalidVersionID
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return VersionRecord{}, nil, fmt.Errorf("begin version update: %w", err)
	}
	defer tx.Rollback()

	record, err := scanVersionRecord(tx.QueryRowContext(ctx, `
		SELECT version_id::text, COALESCE(parent_version_id::text, ''), manifest_revision,
		       status, COALESCE(output_url, ''), COALESCE(error, ''), created_at
		FROM clip_versions
		WHERE project_id = $1 AND clip_index = $2 AND version_id = $3
		FOR UPDATE
	`, projectID, clipIndex, versionID))
	if errors.Is(err, sql.ErrNoRows) {
		return VersionRecord{}, nil, ErrVersionNotFound
	}
	if err != nil {
		return VersionRecord{}, nil, fmt.Errorf("lock version for update: %w", err)
	}
	if record.Status == RenderStatusRendering {
		return VersionRecord{}, nil, ErrVersionRendering
	}

	versionManifest := cloneManifest(manifest)
	versionManifest["version_id"] = versionID
	if record.ParentVersionID == "" {
		versionManifest["parent_version_id"] = nil
	} else {
		versionManifest["parent_version_id"] = record.ParentVersionID
	}
	versionManifest["render_status"] = string(RenderStatusPending)
	versionManifest["master"] = nil
	delete(versionManifest, "error")
	revision, err := manifests.CalculateRevision(versionManifest)
	if err != nil {
		return VersionRecord{}, nil, fmt.Errorf("calculate manifest revision: %w", err)
	}
	versionManifest["manifest_revision"] = revision
	encodedManifest, err := json.Marshal(versionManifest)
	if err != nil {
		return VersionRecord{}, nil, fmt.Errorf("encode version manifest: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE clip_versions
		SET manifest = $4::jsonb, manifest_revision = $5, status = 'pending', output_url = NULL, error = NULL
		WHERE project_id = $1 AND clip_index = $2 AND version_id = $3
	`, projectID, clipIndex, versionID, encodedManifest, revision); err != nil {
		return VersionRecord{}, nil, fmt.Errorf("update version manifest: %w", err)
	}
	record.ManifestRevision = revision
	record.Status = RenderStatusPending
	record.OutputURL = ""
	record.Error = ""
	if err := tx.Commit(); err != nil {
		return VersionRecord{}, nil, fmt.Errorf("commit version update: %w", err)
	}
	return record, cloneManifest(versionManifest), nil
}

func (r *PostgresRepository) UpdateRender(ctx context.Context, projectID string, clipIndex int, versionID string, status RenderStatus, message string) (VersionRecord, error) {
	if !validRenderStatus(status) {
		return VersionRecord{}, ErrInvalidRenderStatus
	}
	if !validUUID(versionID) {
		return VersionRecord{}, ErrInvalidVersionID
	}
	var record VersionRecord
	var createdAt time.Time
	err := r.db.QueryRowContext(ctx, `
		UPDATE clip_versions
		SET status = $4,
		    error = NULLIF($5, ''),
		    manifest = jsonb_set(
				jsonb_set(manifest, '{render_status}', to_jsonb($4::text), true),
				'{error}', CASE WHEN $5 = '' THEN 'null'::jsonb ELSE to_jsonb($5::text) END, true
			)
		WHERE project_id = $1 AND clip_index = $2 AND version_id = $3
		RETURNING version_id::text, COALESCE(parent_version_id::text, ''), manifest_revision,
		          status, COALESCE(output_url, ''), COALESCE(error, ''), created_at
	`, projectID, clipIndex, versionID, status, message).Scan(
		&record.VersionID, &record.ParentVersionID, &record.ManifestRevision, &record.Status,
		&record.OutputURL, &record.Error, &createdAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return VersionRecord{}, ErrVersionNotFound
	}
	if err != nil {
		return VersionRecord{}, fmt.Errorf("update render status: %w", err)
	}
	record.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
	return record, nil
}

func (r *PostgresRepository) Complete(ctx context.Context, projectID string, clipIndex int, versionID string, outputURL string) (VersionRecord, error) {
	if outputURL == "" {
		return VersionRecord{}, ErrOutputURLRequired
	}
	if !validUUID(versionID) {
		return VersionRecord{}, ErrInvalidVersionID
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return VersionRecord{}, fmt.Errorf("begin version completion: %w", err)
	}
	defer tx.Rollback()
	record, err := scanVersionRecord(tx.QueryRowContext(ctx, `
		SELECT version_id::text, COALESCE(parent_version_id::text, ''), manifest_revision,
		       status, COALESCE(output_url, ''), COALESCE(error, ''), created_at
		FROM clip_versions
		WHERE project_id = $1 AND clip_index = $2 AND version_id = $3
		FOR UPDATE
	`, projectID, clipIndex, versionID))
	if errors.Is(err, sql.ErrNoRows) {
		return VersionRecord{}, ErrVersionNotFound
	}
	if err != nil {
		return VersionRecord{}, fmt.Errorf("lock version for completion: %w", err)
	}
	record.Status = RenderStatusDone
	record.Error = ""
	record.OutputURL = outputURL
	if _, err := tx.ExecContext(ctx, `
		UPDATE clip_versions
		SET status = 'done', output_url = $4, error = NULL,
		    manifest = jsonb_set(
				jsonb_set(manifest, '{render_status}', '"done"'::jsonb, true),
				'{master}', to_jsonb($4::text), true
			)
		WHERE project_id = $1 AND clip_index = $2 AND version_id = $3
	`, projectID, clipIndex, versionID, outputURL); err != nil {
		return VersionRecord{}, fmt.Errorf("complete version: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO clip_version_heads (project_id, clip_index, current_version_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (project_id, clip_index) DO UPDATE
		SET current_version_id = EXCLUDED.current_version_id, updated_at = now()
	`, projectID, clipIndex, versionID); err != nil {
		return VersionRecord{}, fmt.Errorf("promote completed version: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return VersionRecord{}, fmt.Errorf("commit version completion: %w", err)
	}
	return record, nil
}

func (r *PostgresRepository) Promote(ctx context.Context, projectID string, clipIndex int, versionID string, outputURL string) (VersionRecord, error) {
	if outputURL == "" {
		return VersionRecord{}, ErrOutputURLRequired
	}
	if !validUUID(versionID) {
		return VersionRecord{}, ErrInvalidVersionID
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return VersionRecord{}, fmt.Errorf("begin version promotion: %w", err)
	}
	defer tx.Rollback()
	record, err := scanVersionRecord(tx.QueryRowContext(ctx, `
		SELECT version_id::text, COALESCE(parent_version_id::text, ''), manifest_revision,
		       status, COALESCE(output_url, ''), COALESCE(error, ''), created_at
		FROM clip_versions
		WHERE project_id = $1 AND clip_index = $2 AND version_id = $3
		FOR UPDATE
	`, projectID, clipIndex, versionID))
	if errors.Is(err, sql.ErrNoRows) {
		return VersionRecord{}, ErrVersionNotFound
	}
	if err != nil {
		return VersionRecord{}, fmt.Errorf("lock version for promotion: %w", err)
	}
	if record.Status != RenderStatusDone {
		return VersionRecord{}, ErrVersionNotCompleted
	}
	record.OutputURL = outputURL
	if _, err := tx.ExecContext(ctx, `
		UPDATE clip_versions
		SET output_url = $4,
		    manifest = jsonb_set(manifest, '{master}', to_jsonb($4::text), true)
		WHERE project_id = $1 AND clip_index = $2 AND version_id = $3
	`, projectID, clipIndex, versionID, outputURL); err != nil {
		return VersionRecord{}, fmt.Errorf("update promoted version: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO clip_version_heads (project_id, clip_index, current_version_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (project_id, clip_index) DO UPDATE
		SET current_version_id = EXCLUDED.current_version_id, updated_at = now()
	`, projectID, clipIndex, versionID); err != nil {
		return VersionRecord{}, fmt.Errorf("update current version head: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return VersionRecord{}, fmt.Errorf("commit version promotion: %w", err)
	}
	return record, nil
}

func (r *PostgresRepository) Delete(ctx context.Context, projectID string, clipIndex int, versionID string) (VersionRecord, string, error) {
	if !validUUID(versionID) {
		return VersionRecord{}, "", ErrInvalidVersionID
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return VersionRecord{}, "", fmt.Errorf("begin version deletion: %w", err)
	}
	defer tx.Rollback()
	record, err := scanVersionRecord(tx.QueryRowContext(ctx, `
		SELECT version_id::text, COALESCE(parent_version_id::text, ''), manifest_revision,
		       status, COALESCE(output_url, ''), COALESCE(error, ''), created_at
		FROM clip_versions
		WHERE project_id = $1 AND clip_index = $2 AND version_id = $3
		FOR UPDATE
	`, projectID, clipIndex, versionID))
	if errors.Is(err, sql.ErrNoRows) {
		return VersionRecord{}, "", ErrVersionNotFound
	}
	if err != nil {
		return VersionRecord{}, "", fmt.Errorf("lock version for deletion: %w", err)
	}
	var childCount int
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM clip_versions
		WHERE project_id = $1 AND clip_index = $2 AND parent_version_id = $3
	`, projectID, clipIndex, versionID).Scan(&childCount); err != nil {
		return VersionRecord{}, "", fmt.Errorf("check version children: %w", err)
	}
	if childCount > 0 {
		return VersionRecord{}, "", ErrVersionHasChildren
	}
	var current string
	err = tx.QueryRowContext(ctx, `
		SELECT current_version_id::text FROM clip_version_heads
		WHERE project_id = $1 AND clip_index = $2
		FOR UPDATE
	`, projectID, clipIndex).Scan(&current)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return VersionRecord{}, "", fmt.Errorf("load current version head: %w", err)
	}
	replacement := ""
	if current == versionID {
		var candidateID string
		err := tx.QueryRowContext(ctx, `
			SELECT version_id::text
			FROM clip_versions
			WHERE project_id = $1 AND clip_index = $2 AND version_id <> $3
			  AND status = 'done' AND output_url IS NOT NULL AND output_url <> ''
			ORDER BY created_at DESC, version_id DESC
			LIMIT 1
		`, projectID, clipIndex, versionID).Scan(&candidateID)
		if err == nil {
			replacement = candidateID
			if _, err := tx.ExecContext(ctx, `
				UPDATE clip_version_heads SET current_version_id = $3, updated_at = now()
				WHERE project_id = $1 AND clip_index = $2
			`, projectID, clipIndex, replacement); err != nil {
				return VersionRecord{}, "", fmt.Errorf("replace current version head: %w", err)
			}
		} else if errors.Is(err, sql.ErrNoRows) {
			if _, err := tx.ExecContext(ctx, `DELETE FROM clip_version_heads WHERE project_id = $1 AND clip_index = $2`, projectID, clipIndex); err != nil {
				return VersionRecord{}, "", fmt.Errorf("clear current version head: %w", err)
			}
		} else {
			return VersionRecord{}, "", fmt.Errorf("find replacement version head: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM clip_versions WHERE project_id = $1 AND clip_index = $2 AND version_id = $3`, projectID, clipIndex, versionID); err != nil {
		return VersionRecord{}, "", fmt.Errorf("delete version: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return VersionRecord{}, "", fmt.Errorf("commit version deletion: %w", err)
	}
	return record, replacement, nil
}

type scanner interface {
	Scan(...any) error
}

func scanVersionRecord(row scanner) (VersionRecord, error) {
	var record VersionRecord
	var createdAt time.Time
	err := row.Scan(
		&record.VersionID, &record.ParentVersionID, &record.ManifestRevision, &record.Status,
		&record.OutputURL, &record.Error, &createdAt,
	)
	if err != nil {
		return VersionRecord{}, err
	}
	record.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
	return record, nil
}
