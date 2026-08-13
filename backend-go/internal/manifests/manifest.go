package manifests

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

const ManifestSchemaVersion = 1

var transientKeys = map[string]struct{}{
	"master": {}, "updated_at": {}, "render_status": {}, "manifest_revision": {},
}

func SHA256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.CopyBuffer(digest, file, make([]byte, 1024*1024)); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func CalculateRevision(manifest map[string]any) (string, error) {
	canonical := make(map[string]any, len(manifest))
	for key, value := range manifest {
		if _, transient := transientKeys[key]; !transient {
			canonical[key] = value
		}
	}
	encoded, err := canonicalJSON(canonical)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(encoded)
	return hex.EncodeToString(hash[:]), nil
}

func VerifyAssets(manifest map[string]any, projectDir string) error {
	if schema, ok := manifest["schema_version"].(int); !ok || schema != ManifestSchemaVersion {
		return errors.New("unsupported manifest schema version")
	}
	assets, ok := manifest["assets"].(map[string]any)
	if !ok {
		return nil
	}
	root, err := filepath.Abs(projectDir)
	if err != nil {
		return err
	}
	for _, rawAsset := range assets {
		asset, ok := rawAsset.(map[string]any)
		if !ok {
			return errors.New("manifest asset must be an object")
		}
		relativePath, _ := asset["relative_path"].(string)
		expectedHash, _ := asset["sha256"].(string)
		if relativePath == "" || expectedHash == "" {
			if _, hasRemote := asset["source_object"]; hasRemote && expectedHash != "" {
				continue
			}
			return errors.New("manifest asset is missing path or checksum")
		}
		candidate, err := filepath.Abs(filepath.Join(root, filepath.FromSlash(relativePath)))
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(root, candidate)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return errors.New("asset path escapes the project directory")
		}
		info, err := os.Stat(candidate)
		if err != nil || info.IsDir() {
			return fmt.Errorf("manifest asset is missing: %s", relativePath)
		}
		actualHash, err := SHA256File(candidate)
		if err != nil {
			return err
		}
		if actualHash != expectedHash {
			return fmt.Errorf("manifest asset checksum mismatch: %s", relativePath)
		}
	}
	return nil
}

func Load(path string) (map[string]any, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var manifest map[string]any
	if err := json.Unmarshal(contents, &manifest); err != nil {
		return nil, err
	}
	if schema, ok := manifest["schema_version"].(float64); !ok || int(schema) != ManifestSchemaVersion {
		return nil, errors.New("unsupported manifest schema version")
	}
	if declared, ok := manifest["manifest_revision"].(string); ok && declared != "" {
		actual, err := CalculateRevision(manifest)
		if err != nil {
			return nil, err
		}
		if declared != actual {
			return nil, errors.New("manifest revision mismatch")
		}
	}
	return manifest, nil
}

func SaveAtomic(path string, manifest map[string]any) (string, error) {
	copyManifest := cloneMap(manifest)
	copyManifest["schema_version"] = ManifestSchemaVersion
	if declared, ok := copyManifest["manifest_revision"].(string); ok && declared != "" {
		actual, err := CalculateRevision(copyManifest)
		if err != nil {
			return "", err
		}
		if declared != actual {
			return "", errors.New("manifest revision mismatch")
		}
	}
	copyManifest["updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if _, ok := copyManifest["master"]; !ok {
		copyManifest["master"] = nil
	}
	contents, err := json.MarshalIndent(copyManifest, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".manifest-*.tmp")
	if err != nil {
		return "", err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if _, err := temporary.Write(contents); err != nil {
		temporary.Close()
		return "", err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return "", err
	}
	if err := temporary.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(temporaryName, path); err != nil {
		return "", err
	}
	return CalculateRevision(copyManifest)
}

func canonicalJSON(value any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	encoded := bytes.TrimSuffix(buffer.Bytes(), []byte{'\n'})
	return asciiJSON(encoded), nil
}

func asciiJSON(value []byte) []byte {
	var output bytes.Buffer
	for index := 0; index < len(value); {
		if value[index] < utf8.RuneSelf {
			output.WriteByte(value[index])
			index++
			continue
		}
		runeValue, size := utf8.DecodeRune(value[index:])
		if runeValue <= 0xffff {
			fmt.Fprintf(&output, "\\u%04x", runeValue)
		} else {
			runeValue -= 0x10000
			hi := 0xd800 + (runeValue >> 10)
			lo := 0xdc00 + (runeValue & 0x3ff)
			fmt.Fprintf(&output, "\\u%04x\\u%04x", hi, lo)
		}
		index += size
	}
	return output.Bytes()
}

func cloneMap(value map[string]any) map[string]any {
	clone := make(map[string]any, len(value))
	for key, item := range value {
		clone[key] = item
	}
	return clone
}
