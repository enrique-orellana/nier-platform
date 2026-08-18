package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

const (
	defaultPort              = 8000
	defaultMaxConcurrentJobs = 5
	defaultRenderServiceURL  = "http://localhost:3100"
	defaultOutputDir         = "output"
	defaultUploadPostUserURL = "https://api.upload-post.com/api/uploadposts/users"
)

type Config struct {
	Port              int
	MaxConcurrentJobs int
	RenderServiceURL  string
	OutputDir         string
	DisableYouTubeURL bool
	UploadPostUserURL string
	UploadPostURL     string
	CodexAuthFile     string
	S3Endpoint        string
	S3Region          string
	S3AccessKey       string
	S3SecretKey       string
	S3Bucket          string
	S3SourceBucket    string
	S3PublicEndpoint  string
	S3PublicURLBase   string
	S3ForcePathStyle  bool
	ElevenLabsURL     string
	DatabaseURL       string
}

func Load() (Config, error) {
	cfg := Config{
		Port:              defaultPort,
		MaxConcurrentJobs: defaultMaxConcurrentJobs,
		RenderServiceURL:  defaultRenderServiceURL,
		OutputDir:         defaultOutputDir,
		UploadPostUserURL: defaultUploadPostUserURL,
		UploadPostURL:     "https://api.upload-post.com/api/upload",
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
	if value := os.Getenv("DISABLE_YOUTUBE_URL"); value != "" {
		cfg.DisableYouTubeURL = strings.EqualFold(value, "1") || strings.EqualFold(value, "true") || strings.EqualFold(value, "yes")
	}
	if value := os.Getenv("UPLOAD_POST_USER_URL"); value != "" {
		cfg.UploadPostUserURL = value
	}
	if value := os.Getenv("UPLOAD_POST_URL"); value != "" {
		cfg.UploadPostURL = value
	}
	if value := os.Getenv("OPENSHORTS_CODEX_AUTH_FILE"); value != "" {
		cfg.CodexAuthFile = value
	} else {
		cfg.CodexAuthFile = fmt.Sprintf("%s/.openshorts/codex-auth.json", strings.TrimRight(cfg.OutputDir, `/\\`))
	}
	cfg.S3Endpoint = os.Getenv("AWS_S3_ENDPOINT_URL")
	cfg.DatabaseURL = os.Getenv("DATABASE_URL")
	cfg.ElevenLabsURL = os.Getenv("ELEVENLABS_API_BASE_URL")
	if cfg.ElevenLabsURL == "" {
		cfg.ElevenLabsURL = "https://api.elevenlabs.io/v1"
	}
	cfg.S3Region = os.Getenv("AWS_REGION")
	cfg.S3AccessKey = os.Getenv("AWS_ACCESS_KEY_ID")
	cfg.S3SecretKey = os.Getenv("AWS_SECRET_ACCESS_KEY")
	cfg.S3Bucket = os.Getenv("AWS_S3_BUCKET")
	cfg.S3SourceBucket = os.Getenv("AWS_S3_SOURCE_BUCKET")
	cfg.S3PublicEndpoint = os.Getenv("AWS_S3_PUBLIC_ENDPOINT_URL")
	cfg.S3PublicURLBase = os.Getenv("AWS_S3_PUBLIC_URL_BASE")
	if cfg.S3SourceBucket == "" {
		cfg.S3SourceBucket = "youtube-downloads"
	}
	if value := os.Getenv("AWS_S3_FORCE_PATH_STYLE"); value != "" {
		cfg.S3ForcePathStyle = strings.EqualFold(value, "1") || strings.EqualFold(value, "true") || strings.EqualFold(value, "yes")
	}

	return cfg, nil
}

func (c Config) Address() string {
	return fmt.Sprintf(":%d", c.Port)
}
