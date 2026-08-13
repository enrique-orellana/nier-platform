package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
)

type SocialProfile struct {
	Username  string   `json:"username"`
	Connected []string `json:"connected"`
}

func NormalizeUploadPostProfiles(payload map[string]any) []SocialProfile {
	profiles := make([]SocialProfile, 0)
	items, _ := payload["profiles"].([]any)
	platforms := []string{"tiktok", "instagram", "youtube"}
	for _, item := range items {
		profile, _ := item.(map[string]any)
		username, _ := profile["username"].(string)
		if username == "" {
			continue
		}
		accounts, _ := profile["social_accounts"].(map[string]any)
		connected := make([]string, 0, len(platforms))
		for _, platform := range platforms {
			if _, ok := accounts[platform]; ok {
				connected = append(connected, platform)
			}
		}
		profiles = append(profiles, SocialProfile{Username: username, Connected: connected})
	}
	return profiles
}

type PublishRequest struct {
	UserID        string
	Title         string
	Description   string
	Platforms     []string
	ScheduledDate string
	Timezone      string
}

type SocialClient struct {
	HTTP      *http.Client
	UploadURL string
}

func (c SocialClient) FetchProfiles(ctx context.Context, endpoint, apiKey string) ([]SocialProfile, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Apikey "+apiKey)
	client := c.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	if err := DecodeJSONResponse(response, &payload); err != nil {
		return nil, err
	}
	return NormalizeUploadPostProfiles(payload), nil
}

func (c SocialClient) Publish(ctx context.Context, apiKey, filename string, video io.Reader, input PublishRequest) (map[string]any, error) {
	request, err := BuildUploadPostRequestWithContext(ctx, c.UploadURL, apiKey, filename, video, input)
	if err != nil {
		return nil, err
	}
	client := c.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	if err := DecodeJSONResponse(response, &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func BuildUploadPostRequest(endpoint, apiKey, filename string, video io.Reader, input PublishRequest) (*http.Request, error) {
	return BuildUploadPostRequestWithContext(context.Background(), endpoint, apiKey, filename, video, input)
}

func BuildUploadPostRequestWithContext(ctx context.Context, endpoint, apiKey, filename string, video io.Reader, input PublishRequest) (*http.Request, error) {
	if endpoint == "" || input.UserID == "" || len(input.Platforms) == 0 {
		return nil, fmt.Errorf("social publish endpoint, user, and platform are required")
	}
	var body bytes.Buffer
	multipartWriter := multipart.NewWriter(&body)
	fields := map[string]string{
		"user": input.UserID, "title": input.Title, "async_upload": "true",
	}
	if input.Description != "" {
		fields["tiktok_title"] = input.Description
		fields["instagram_title"] = input.Description
		fields["youtube_description"] = input.Description
	}
	for _, platform := range input.Platforms {
		if platform == "youtube" {
			fields["youtube_title"] = input.Title
		}
	}
	for key, value := range fields {
		if err := multipartWriter.WriteField(key, value); err != nil {
			return nil, err
		}
	}
	for _, platform := range input.Platforms {
		if err := multipartWriter.WriteField("platform[]", platform); err != nil {
			return nil, err
		}
	}
	for key, value := range map[string]string{"scheduled_date": input.ScheduledDate, "timezone": input.Timezone} {
		if value != "" {
			if err := multipartWriter.WriteField(key, value); err != nil {
				return nil, err
			}
		}
	}
	for _, platform := range input.Platforms {
		if platform == "instagram" {
			if err := multipartWriter.WriteField("media_type", "REELS"); err != nil {
				return nil, err
			}
			break
		}
	}
	part, err := multipartWriter.CreateFormFile("video", filename)
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(part, video); err != nil {
		return nil, err
	}
	if err := multipartWriter.Close(); err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Apikey "+apiKey)
	request.Header.Set("Content-Type", multipartWriter.FormDataContentType())
	return request, nil
}

func DecodeJSONResponse(response *http.Response, target any) error {
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("social vendor returned status %d", response.StatusCode)
	}
	return json.NewDecoder(response.Body).Decode(target)
}
