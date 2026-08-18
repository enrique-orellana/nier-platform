package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

func safeJSON(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return strings.NewReplacer("<", "\\u003c", ">", "\\u003e", "&", "\\u0026").Replace(string(encoded))
}

func metadataFloat(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case json.Number:
		parsed, _ := typed.Float64()
		return parsed
	default:
		return 0
	}
}

func metadataNestedFloat(value map[string]any, key, nested string) float64 {
	child, _ := value[key].(map[string]any)
	return metadataFloat(child[nested])
}

func metadataStrings(value any) []string {
	result := []string{}
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		for _, item := range typed {
			if text, ok := item.(string); ok {
				result = append(result, text)
			}
		}
	}
	return result
}

func serviceOrigin(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(value), "/"))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("invalid service URL")
	}
	parsed.Path, parsed.RawPath, parsed.RawQuery, parsed.Fragment = "", "", "", ""
	return strings.TrimRight(parsed.String(), "/"), nil
}

func lmStudioDiscoveryFailure(baseURL string) map[string]any {
	return map[string]any{
		"available":    false,
		"provider":     "lmstudio",
		"baseUrl":      baseURL,
		"textModels":   []any{},
		"visionModels": []any{},
		"error":        "Unable to discover LM Studio models",
	}
}

func firstString(value map[string]any, keys ...string) string {
	for _, key := range keys {
		if text, ok := value[key].(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

func boolValue(value any) bool {
	result, _ := value.(bool)
	return result
}

func inlineContentDisposition(filename string) string {
	ascii := "video.mp4"
	for _, char := range filename {
		if char >= 32 && char <= 126 {
			ascii = strings.ReplaceAll(strings.ReplaceAll(filename, `"`, "'"), `\`, "_")
			break
		}
	}
	return fmt.Sprintf(`inline; filename="%s"; filename*=UTF-8''%s`, ascii, url.QueryEscape(filename))
}

func firstMetadataPath(root string) (string, error) {
	files, err := filepath.Glob(filepath.Join(root, "*_metadata.json"))
	if err != nil || len(files) == 0 {
		return "", os.ErrNotExist
	}
	return files[0], nil
}
