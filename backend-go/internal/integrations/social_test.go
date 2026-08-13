package integrations

import (
	"strings"
	"testing"
)

func TestNormalizeUploadPostProfiles(t *testing.T) {
	profiles := NormalizeUploadPostProfiles(map[string]any{
		"profiles": []any{
			map[string]any{"username": "creator", "social_accounts": map[string]any{"youtube": map[string]any{}, "tiktok": map[string]any{}}},
			map[string]any{"username": "", "social_accounts": map[string]any{"instagram": map[string]any{}}},
		},
	})

	if len(profiles) != 1 || profiles[0].Username != "creator" {
		t.Fatalf("unexpected profiles: %#v", profiles)
	}
	if strings.Join(profiles[0].Connected, ",") != "tiktok,youtube" {
		t.Fatalf("unexpected connected platforms: %#v", profiles[0].Connected)
	}
}

func TestBuildUploadPostRequestIncludesPlatformAndScheduleFields(t *testing.T) {
	request, err := BuildUploadPostRequest("https://api.example/upload", "key", "clip.mp4", strings.NewReader("video"), PublishRequest{
		UserID:        "creator",
		Title:         "Title",
		Description:   "Description",
		Platforms:     []string{"tiktok", "youtube"},
		ScheduledDate: "2026-08-14T12:00:00Z",
		Timezone:      "UTC",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := request.ParseMultipartForm(1024 * 1024); err != nil {
		t.Fatal(err)
	}
	if request.FormValue("user") != "creator" || request.FormValue("tiktok_title") != "Description" || request.FormValue("youtube_title") != "Title" {
		t.Fatalf("unexpected form fields: %#v", request.Form)
	}
	if request.FormValue("scheduled_date") == "" || request.FormValue("timezone") != "UTC" {
		t.Fatalf("schedule fields missing: %#v", request.Form)
	}
	if request.FormValue("media_type") != "" {
		t.Fatalf("media_type should only be sent for Instagram: %#v", request.Form)
	}
}
