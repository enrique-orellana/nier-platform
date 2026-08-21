package audit

import (
	"testing"

	"github.com/mutonby/openshorts/backend-go/internal/config"
)

func TestConfigNormalizesAuditBodyHostAllowlistAndAddsS3Host(t *testing.T) {
	t.Setenv("AUDIT_BODY_HOST_ALLOWLIST", "chatgpt.com,OPENROUTER.AI")
	t.Setenv("AWS_S3_ENDPOINT_URL", "https://minio.example.test:9000")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if len(cfg.AuditBodyHostAllowlist) != 3 || cfg.AuditBodyHostAllowlist[0] != "chatgpt.com" || cfg.AuditBodyHostAllowlist[1] != "openrouter.ai" || cfg.AuditBodyHostAllowlist[2] != "minio.example.test" {
		t.Fatalf("unexpected normalized allowlist: %#v", cfg.AuditBodyHostAllowlist)
	}
	if !AuditHostAllowed("chatgpt.com", cfg.AuditBodyHostAllowlist) {
		t.Fatal("expected chatgpt.com to be allowlisted")
	}
	if AuditHostAllowed("evilchatgpt.com", cfg.AuditBodyHostAllowlist) {
		t.Fatal("did not expect evilchatgpt.com to be allowlisted")
	}
}
