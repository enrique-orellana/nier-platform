package versions

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"sync"

	"github.com/mutonby/openshorts/backend-go/internal/manifests"
)

type versionKey struct {
	projectID string
	clipIndex int
	versionID string
}

type clipKey struct {
	projectID string
	clipIndex int
}

type MemoryRepository struct {
	mu        sync.RWMutex
	records   map[versionKey]VersionRecord
	manifests map[versionKey]map[string]any
	heads     map[clipKey]string
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		records:   make(map[versionKey]VersionRecord),
		manifests: make(map[versionKey]map[string]any),
		heads:     make(map[clipKey]string),
	}
}

func (r *MemoryRepository) List(_ context.Context, projectID string, clipIndex int) (string, []VersionRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	key := clipKey{projectID: projectID, clipIndex: clipIndex}
	versions := make([]VersionRecord, 0)
	for versionKey, record := range r.records {
		if versionKey.projectID == projectID && versionKey.clipIndex == clipIndex {
			versions = append(versions, record)
		}
	}
	sort.SliceStable(versions, func(i, j int) bool {
		if versions[i].CreatedAt == versions[j].CreatedAt {
			return versions[i].VersionID < versions[j].VersionID
		}
		return versions[i].CreatedAt < versions[j].CreatedAt
	})
	return r.heads[key], versions, nil
}

func (r *MemoryRepository) Create(_ context.Context, projectID string, clipIndex int, manifest map[string]any, parentVersionID *string) (VersionRecord, map[string]any, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	parent := ""
	if parentVersionID != nil {
		parent = *parentVersionID
		if !validUUID(parent) || !r.hasRecordLocked(projectID, clipIndex, parent) {
			return VersionRecord{}, nil, ErrParentVersionMissing
		}
	}
	return r.createLocked(projectID, clipIndex, manifest, parent)
}

func (r *MemoryRepository) createLocked(projectID string, clipIndex int, manifest map[string]any, parent string) (VersionRecord, map[string]any, error) {
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
	record := VersionRecord{
		VersionID:        versionID,
		ParentVersionID:  parent,
		ManifestRevision: revision,
		Status:           RenderStatusPending,
		CreatedAt:        nowUTC(),
	}
	key := versionKey{projectID: projectID, clipIndex: clipIndex, versionID: versionID}
	r.records[key] = record
	r.manifests[key] = cloneManifest(versionManifest)
	return record, cloneManifest(versionManifest), nil
}

func (r *MemoryRepository) Load(_ context.Context, projectID string, clipIndex int, versionID string) (VersionRecord, map[string]any, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	key := versionKey{projectID: projectID, clipIndex: clipIndex, versionID: versionID}
	record, ok := r.records[key]
	if !ok || !validUUID(versionID) {
		return VersionRecord{}, nil, ErrVersionNotFound
	}
	return record, cloneManifest(r.manifests[key]), nil
}

func (r *MemoryRepository) UpdateRender(_ context.Context, projectID string, clipIndex int, versionID string, status RenderStatus, message string) (VersionRecord, error) {
	if !validRenderStatus(status) {
		return VersionRecord{}, ErrInvalidRenderStatus
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	key := versionKey{projectID: projectID, clipIndex: clipIndex, versionID: versionID}
	record, ok := r.records[key]
	if !ok || !validUUID(versionID) {
		return VersionRecord{}, ErrVersionNotFound
	}
	record.Status = status
	record.Error = message
	r.records[key] = record
	manifest := r.manifests[key]
	manifest["render_status"] = string(status)
	if message == "" {
		delete(manifest, "error")
	} else {
		manifest["error"] = message
	}
	return record, nil
}

func (r *MemoryRepository) Complete(_ context.Context, projectID string, clipIndex int, versionID string, outputURL string) (VersionRecord, error) {
	if outputURL == "" {
		return VersionRecord{}, ErrOutputURLRequired
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	key := versionKey{projectID: projectID, clipIndex: clipIndex, versionID: versionID}
	record, ok := r.records[key]
	if !ok || !validUUID(versionID) {
		return VersionRecord{}, ErrVersionNotFound
	}
	record.Status = RenderStatusDone
	record.Error = ""
	record.OutputURL = outputURL
	r.records[key] = record
	manifest := r.manifests[key]
	manifest["render_status"] = string(RenderStatusDone)
	manifest["master"] = outputURL
	delete(manifest, "error")
	r.heads[clipKey{projectID: projectID, clipIndex: clipIndex}] = versionID
	return record, nil
}

func (r *MemoryRepository) Promote(_ context.Context, projectID string, clipIndex int, versionID string, outputURL string) (VersionRecord, error) {
	if outputURL == "" {
		return VersionRecord{}, ErrOutputURLRequired
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	key := versionKey{projectID: projectID, clipIndex: clipIndex, versionID: versionID}
	record, ok := r.records[key]
	if !ok || !validUUID(versionID) {
		return VersionRecord{}, ErrVersionNotFound
	}
	if record.Status != RenderStatusDone {
		return VersionRecord{}, ErrVersionNotCompleted
	}
	record.OutputURL = outputURL
	r.records[key] = record
	r.manifests[key]["master"] = outputURL
	r.heads[clipKey{projectID: projectID, clipIndex: clipIndex}] = versionID
	return record, nil
}

func (r *MemoryRepository) Delete(_ context.Context, projectID string, clipIndex int, versionID string) (VersionRecord, string, error) {
	if !validUUID(versionID) {
		return VersionRecord{}, "", ErrInvalidVersionID
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	key := versionKey{projectID: projectID, clipIndex: clipIndex, versionID: versionID}
	record, ok := r.records[key]
	if !ok {
		return VersionRecord{}, "", ErrVersionNotFound
	}
	for childKey, child := range r.records {
		if childKey.projectID == projectID && childKey.clipIndex == clipIndex && child.ParentVersionID == versionID {
			return VersionRecord{}, "", ErrVersionHasChildren
		}
	}
	delete(r.records, key)
	delete(r.manifests, key)
	clip := clipKey{projectID: projectID, clipIndex: clipIndex}
	if r.heads[clip] != versionID {
		return record, r.heads[clip], nil
	}
	delete(r.heads, clip)
	var replacement VersionRecord
	for candidateKey, candidate := range r.records {
		if candidateKey.projectID != projectID || candidateKey.clipIndex != clipIndex || candidate.Status != RenderStatusDone || candidate.OutputURL == "" {
			continue
		}
		if replacement.VersionID == "" || candidate.CreatedAt > replacement.CreatedAt || (candidate.CreatedAt == replacement.CreatedAt && candidate.VersionID > replacement.VersionID) {
			replacement = candidate
		}
	}
	if replacement.VersionID != "" {
		r.heads[clip] = replacement.VersionID
	}
	return record, replacement.VersionID, nil
}

func (r *MemoryRepository) hasRecordLocked(projectID string, clipIndex int, versionID string) bool {
	_, ok := r.records[versionKey{projectID: projectID, clipIndex: clipIndex, versionID: versionID}]
	return ok
}

func validRenderStatus(status RenderStatus) bool {
	return status == RenderStatusPending || status == RenderStatusRendering || status == RenderStatusDone || status == RenderStatusFailed
}

func cloneManifest(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return map[string]any{}
	}
	var cloned map[string]any
	if err := json.Unmarshal(encoded, &cloned); err != nil || cloned == nil {
		return map[string]any{}
	}
	return cloned
}
