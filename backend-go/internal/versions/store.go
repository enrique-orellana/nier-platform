package versions

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/manifests"
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

type indexFile struct {
	CurrentVersionID string                   `json:"current_version_id"`
	Versions         map[string]VersionRecord `json:"versions"`
}

type Store struct {
	mu          sync.Mutex
	clipRoot    string
	versionsDir string
	indexPath   string
}

func NewStore(clipRoot string) (*Store, error) {
	root, err := filepath.Abs(clipRoot)
	if err != nil {
		return nil, err
	}
	versionsDir := filepath.Join(root, "versions")
	if err := os.MkdirAll(versionsDir, 0o755); err != nil {
		return nil, err
	}
	return &Store{clipRoot: root, versionsDir: versionsDir, indexPath: filepath.Join(versionsDir, "index.json")}, nil
}

func (s *Store) CurrentVersionID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readIndex().CurrentVersionID
}

func (s *Store) ListVersions() []VersionRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	index := s.readIndex()
	versions := make([]VersionRecord, 0, len(index.Versions))
	for _, version := range index.Versions {
		versions = append(versions, version)
	}
	sort.SliceStable(versions, func(i, j int) bool {
		return versions[i].CreatedAt < versions[j].CreatedAt
	})
	return versions
}

func (s *Store) CreateVersion(manifest map[string]any, parentVersionID *string) (VersionRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	index := s.readIndex()
	parent := ""
	if parentVersionID != nil {
		parent = *parentVersionID
		if !validUUID(parent) {
			return VersionRecord{}, errors.New("invalid version id")
		}
		if _, ok := index.Versions[parent]; !ok {
			return VersionRecord{}, errors.New("parent version does not exist")
		}
	}
	versionID, err := newUUID()
	if err != nil {
		return VersionRecord{}, err
	}
	versionManifest := cloneMap(manifest)
	versionManifest["version_id"] = versionID
	versionManifest["parent_version_id"] = nullableString(parent)
	versionManifest["render_status"] = string(RenderStatusPending)
	versionManifest["master"] = nil
	revision, err := manifests.CalculateRevision(versionManifest)
	if err != nil {
		return VersionRecord{}, err
	}
	versionManifest["manifest_revision"] = revision
	if err := s.atomicWrite(filepath.Join(s.versionsDir, versionID+".json"), versionManifest); err != nil {
		return VersionRecord{}, err
	}
	record := VersionRecord{
		VersionID:        versionID,
		ParentVersionID:  parent,
		ManifestRevision: revision,
		Status:           RenderStatusPending,
		CreatedAt:        time.Now().UTC().Format(time.RFC3339Nano),
	}
	index.Versions[versionID] = record
	if err := s.writeIndex(index); err != nil {
		return VersionRecord{}, err
	}
	return record, nil
}

func (s *Store) LoadVersion(versionID string) (VersionRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !validUUID(versionID) {
		return VersionRecord{}, errors.New("invalid version id")
	}
	record, ok := s.readIndex().Versions[versionID]
	if !ok {
		return VersionRecord{}, errors.New("version does not exist")
	}
	return record, nil
}

func (s *Store) LoadManifest(versionID string) (map[string]any, error) {
	if _, err := s.LoadVersion(versionID); err != nil {
		return nil, err
	}
	contents, err := os.ReadFile(filepath.Join(s.versionsDir, versionID+".json"))
	if err != nil {
		return nil, errors.New("version manifest is missing")
	}
	var manifest map[string]any
	if err := json.Unmarshal(contents, &manifest); err != nil {
		return nil, err
	}
	return manifest, nil
}

func (s *Store) UpdateRender(versionID string, status RenderStatus, message string) (VersionRecord, error) {
	if status != RenderStatusPending && status != RenderStatusRendering && status != RenderStatusDone && status != RenderStatusFailed {
		return VersionRecord{}, errors.New("invalid render status")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	index := s.readIndex()
	record, ok := index.Versions[versionID]
	if !ok || !validUUID(versionID) {
		return VersionRecord{}, errors.New("version does not exist")
	}
	record.Status = status
	record.Error = message
	index.Versions[versionID] = record
	if err := s.writeIndex(index); err != nil {
		return VersionRecord{}, err
	}
	return record, nil
}

func (s *Store) PromoteVersion(versionID, outputURL string) (VersionRecord, error) {
	if outputURL == "" {
		return VersionRecord{}, errors.New("successful version requires an output URL")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	index := s.readIndex()
	record, ok := index.Versions[versionID]
	if !ok || !validUUID(versionID) {
		return VersionRecord{}, errors.New("version does not exist")
	}
	if record.Status != RenderStatusDone {
		return VersionRecord{}, errors.New("only successful versions can become current")
	}
	record.OutputURL = outputURL
	index.Versions[versionID] = record
	index.CurrentVersionID = versionID
	if err := s.writeIndex(index); err != nil {
		return VersionRecord{}, err
	}
	return record, nil
}

func (s *Store) DeleteVersion(versionID string) (VersionRecord, string, error) {
	if !validUUID(versionID) {
		return VersionRecord{}, "", errors.New("invalid version id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	index := s.readIndex()
	record, ok := index.Versions[versionID]
	if !ok {
		return VersionRecord{}, "", errors.New("version does not exist")
	}
	manifestPath := filepath.Join(s.versionsDir, versionID+".json")
	if err := os.Remove(manifestPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return VersionRecord{}, "", err
	}
	delete(index.Versions, versionID)
	if index.CurrentVersionID == versionID {
		index.CurrentVersionID = ""
		for candidateID, candidate := range index.Versions {
			if index.CurrentVersionID == "" || candidate.CreatedAt > index.Versions[index.CurrentVersionID].CreatedAt {
				index.CurrentVersionID = candidateID
			}
		}
	}
	if err := s.writeIndex(index); err != nil {
		return VersionRecord{}, "", err
	}
	return record, index.CurrentVersionID, nil
}

func (s *Store) readIndex() indexFile {
	if _, err := os.Stat(s.indexPath); errors.Is(err, os.ErrNotExist) {
		return indexFile{Versions: make(map[string]VersionRecord)}
	}
	contents, err := os.ReadFile(s.indexPath)
	if err != nil {
		return indexFile{Versions: make(map[string]VersionRecord)}
	}
	var index indexFile
	if err := json.Unmarshal(contents, &index); err != nil || index.Versions == nil {
		return indexFile{Versions: make(map[string]VersionRecord)}
	}
	return index
}

func (s *Store) writeIndex(index indexFile) error {
	return s.atomicWrite(s.indexPath, index)
}

func (s *Store) atomicWrite(path string, value any) error {
	contents, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".version-*.tmp")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if _, err := temporary.Write(contents); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryName, path)
}

func newUUID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	encoded := hex.EncodeToString(bytes[:])
	return encoded[:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:], nil
}

func validUUID(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}
	for index, char := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			continue
		}
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func cloneMap(value map[string]any) map[string]any {
	clone := make(map[string]any, len(value))
	for key, item := range value {
		clone[key] = item
	}
	return clone
}
