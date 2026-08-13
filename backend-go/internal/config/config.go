package config

import (
	"fmt"
	"os"
	"strconv"
)

const (
	defaultPort              = 8000
	defaultMaxConcurrentJobs = 5
	defaultRenderServiceURL  = "http://localhost:3100"
	defaultOutputDir         = "output"
)

type Config struct {
	Port              int
	MaxConcurrentJobs int
	RenderServiceURL  string
	OutputDir         string
}

func Load() (Config, error) {
	cfg := Config{
		Port:              defaultPort,
		MaxConcurrentJobs: defaultMaxConcurrentJobs,
		RenderServiceURL:  defaultRenderServiceURL,
		OutputDir:         defaultOutputDir,
	}

	if value := os.Getenv("PORT"); value != "" {
		port, err := strconv.Atoi(value)
		if err != nil || port < 1 || port > 65535 {
			return Config{}, fmt.Errorf("PORT must be an integer between 1 and 65535")
		}
		cfg.Port = port
	}
	if value := os.Getenv("MAX_CONCURRENT_JOBS"); value != "" {
		jobs, err := strconv.Atoi(value)
		if err != nil || jobs < 1 {
			return Config{}, fmt.Errorf("MAX_CONCURRENT_JOBS must be a positive integer")
		}
		cfg.MaxConcurrentJobs = jobs
	}
	if value := os.Getenv("RENDER_SERVICE_URL"); value != "" {
		cfg.RenderServiceURL = value
	}
	if value := os.Getenv("OUTPUT_DIR"); value != "" {
		cfg.OutputDir = value
	}

	return cfg, nil
}

func (c Config) Address() string {
	return fmt.Sprintf(":%d", c.Port)
}
