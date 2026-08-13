package config

import "testing"

func TestLoadUsesDefaults(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("MAX_CONCURRENT_JOBS", "")
	t.Setenv("RENDER_SERVICE_URL", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load defaults: %v", err)
	}
	if cfg.Port != 8000 || cfg.MaxConcurrentJobs != 5 || cfg.RenderServiceURL != "http://localhost:3100" {
		t.Fatalf("unexpected defaults: %#v", cfg)
	}
}

func TestLoadReadsEnvironment(t *testing.T) {
	t.Setenv("PORT", "8123")
	t.Setenv("MAX_CONCURRENT_JOBS", "7")
	t.Setenv("RENDER_SERVICE_URL", "http://renderer:3100")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load environment: %v", err)
	}
	if cfg.Port != 8123 || cfg.MaxConcurrentJobs != 7 || cfg.RenderServiceURL != "http://renderer:3100" {
		t.Fatalf("unexpected environment config: %#v", cfg)
	}
}

func TestLoadRejectsInvalidPort(t *testing.T) {
	t.Setenv("PORT", "not-a-port")

	if _, err := Load(); err == nil {
		t.Fatal("expected invalid PORT to fail")
	}
}
