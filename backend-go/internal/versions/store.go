package versions

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"time"
)

type RenderStatus string

const (
	RenderStatusPending   RenderStatus = "pending"
	RenderStatusRendering RenderStatus = "rendering"
	RenderStatusDone      RenderStatus = "done"
	RenderStatusFailed    RenderStatus = "failed"
)

type VersionRecord struct {
	VersionID        string       `json:"version_id"`
	ParentVersionID  string       `json:"parent_version_id"`
	ManifestRevision string       `json:"manifest_revision"`
	Status           RenderStatus `json:"status"`
	OutputURL        string       `json:"output_url,omitempty"`
	Error            string       `json:"error,omitempty"`
	CreatedAt        string       `json:"created_at"`
}

type Repository interface {
	List(context.Context, string, int) (string, []VersionRecord, error)
	Create(context.Context, string, int, map[string]any, *string) (VersionRecord, map[string]any, error)
	UpdateManifest(context.Context, string, int, string, map[string]any) (VersionRecord, map[string]any, error)
	Load(context.Context, string, int, string) (VersionRecord, map[string]any, error)
	UpdateRender(context.Context, string, int, string, RenderStatus, string) (VersionRecord, error)
	Complete(context.Context, string, int, string, string) (VersionRecord, error)
	Promote(context.Context, string, int, string, string) (VersionRecord, error)
	Delete(context.Context, string, int, string) (VersionRecord, string, error)
}

var (
	ErrVersionNotFound      = errors.New("version does not exist")
	ErrInvalidVersionID     = errors.New("invalid version id")
	ErrInvalidRenderStatus  = errors.New("invalid render status")
	ErrVersionHasChildren   = errors.New("version has child versions")
	ErrVersionNotCompleted  = errors.New("only successful versions can become current")
	ErrOutputURLRequired    = errors.New("successful version requires an output URL")
	ErrParentVersionMissing = errors.New("parent version does not exist")
	ErrVersionRendering     = errors.New("version is currently rendering")
	ErrManifestRevision     = errors.New("manifest revision mismatch")
)

func validUUID(value string) bool {
	if !regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`).MatchString(value) {
		return false
	}
	return true
}

func newUUID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	encoded := hex.EncodeToString(bytes[:])
	return fmt.Sprintf("%s-%s-%s-%s-%s", encoded[:8], encoded[8:12], encoded[12:16], encoded[16:20], encoded[20:]), nil
}

func nowUTC() string { return time.Now().UTC().Format(time.RFC3339Nano) }
