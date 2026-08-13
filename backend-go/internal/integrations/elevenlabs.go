package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type ElevenLabsClient struct {
	BaseURL      string
	HTTP         *http.Client
	PollInterval time.Duration
	MaxWait      time.Duration
}

func (c ElevenLabsClient) TranslateFile(ctx context.Context, filename string, video []byte, targetLanguage, sourceLanguage, apiKey, outputPath string) error {
	if strings.TrimSpace(apiKey) == "" {
		return fmt.Errorf("ElevenLabs API key is required")
	}
	if targetLanguage == "" {
		return fmt.Errorf("target language is required")
	}
	base := strings.TrimRight(c.BaseURL, "/")
	if base == "" {
		base = "https://api.elevenlabs.io/v1"
	}
	client := c.HTTP
	if client == nil {
		client = &http.Client{Timeout: 120 * time.Second}
	}
	payload := &bytes.Buffer{}
	writer := multipart.NewWriter(payload)
	for key, value := range map[string]string{"target_lang": targetLanguage, "mode": "automatic", "num_speakers": "0", "watermark": "false", "source_lang": sourceLanguage} {
		if value != "" {
			if err := writer.WriteField(key, value); err != nil {
				return err
			}
		}
	}
	part, err := writer.CreateFormFile("file", filepath.Base(filename))
	if err != nil {
		return err
	}
	if _, err := part.Write(video); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/dubbing", payload)
	if err != nil {
		return err
	}
	request.Header.Set("xi-api-key", apiKey)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	body, readErr := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if readErr != nil {
		return readErr
	}
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusCreated {
		return fmt.Errorf("ElevenLabs dubbing request failed with status %d: %s", response.StatusCode, string(body))
	}
	var created struct {
		DubbingID string `json:"dubbing_id"`
	}
	if err := json.Unmarshal(body, &created); err != nil {
		return err
	}
	if created.DubbingID == "" {
		return fmt.Errorf("ElevenLabs returned no dubbing ID")
	}
	interval := c.PollInterval
	if interval == 0 {
		interval = 5 * time.Second
	}
	maxWait := c.MaxWait
	if maxWait <= 0 {
		maxWait = 10 * time.Minute
	}
	deadline := time.Now().Add(maxWait)
	for {
		status, err := c.dubbingStatus(ctx, client, base, created.DubbingID, apiKey)
		if err != nil {
			return err
		}
		switch status {
		case "dubbed":
			return c.download(ctx, client, base, created.DubbingID, targetLanguage, apiKey, outputPath)
		case "failed":
			return fmt.Errorf("ElevenLabs dubbing failed")
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("ElevenLabs dubbing timed out")
		}
		if interval < 0 {
			continue
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

func (c ElevenLabsClient) dubbingStatus(ctx context.Context, client *http.Client, base, id, apiKey string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/dubbing/"+id, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("xi-api-key", apiKey)
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ElevenLabs status request failed with status %d", response.StatusCode)
	}
	var payload struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", err
	}
	return payload.Status, nil
}

func (c ElevenLabsClient) download(ctx context.Context, client *http.Client, base, id, language, apiKey, outputPath string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/dubbing/"+id+"/audio/"+language, nil)
	if err != nil {
		return err
	}
	request.Header.Set("xi-api-key", apiKey)
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("ElevenLabs download failed with status %d", response.StatusCode)
	}
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(outputPath), ".translated-*")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if _, err := io.Copy(temporary, response.Body); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryName, outputPath)
}
