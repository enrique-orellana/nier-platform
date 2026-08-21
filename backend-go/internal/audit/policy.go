package audit

import (
	"net/url"
	"strings"
)

func AuditHostAllowed(host string, allowlist []string) bool {
	host = normalizeHost(host)
	if host == "" {
		return false
	}
	for _, allowed := range allowlist {
		if host == normalizeHost(allowed) {
			return true
		}
	}
	return false
}

func normalizeHost(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return ""
	}
	if !strings.Contains(value, "://") {
		value = "http://" + value
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}
	return strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
}
