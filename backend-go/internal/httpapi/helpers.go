package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func isLocalAddress(ip net.IP) bool {
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate())
}

func resolveLocalAddress(ctx context.Context, host string) ([]net.IP, error) {
	if ip := net.ParseIP(host); ip != nil {
		if !isLocalAddress(ip) {
			return nil, errors.New("service host must resolve to a local address")
		}
		return []net.IP{ip}, nil
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil || len(addresses) == 0 {
		return nil, errors.New("service host must resolve to a local address")
	}
	ips := make([]net.IP, 0, len(addresses))
	for _, address := range addresses {
		if !isLocalAddress(address.IP) {
			return nil, errors.New("service host must resolve only to local addresses")
		}
		ips = append(ips, address.IP)
	}
	return ips, nil
}

func localServiceOrigin(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.Opaque != "" {
		return "", errors.New("invalid local service URL")
	}
	if parsed.Scheme != "http" {
		return "", errors.New("local service URL must use HTTP")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("local service URL cannot include a query or fragment")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", errors.New("local service URL must be an origin without a path")
	}
	if port := parsed.Port(); port != "" {
		portNumber, err := strconv.Atoi(port)
		if err != nil || portNumber < 1 || portNumber > 65535 {
			return "", errors.New("local service URL has an invalid port")
		}
	}
	host := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	if ip := net.ParseIP(host); ip != nil {
		if !ip.IsLoopback() {
			return "", errors.New("local service URL must use loopback or host.docker.internal")
		}
	} else if host == "localhost" {
		ips, err := resolveLocalAddress(context.Background(), host)
		if err != nil {
			return "", err
		}
		for _, ip := range ips {
			if !ip.IsLoopback() {
				return "", errors.New("localhost must resolve only to loopback addresses")
			}
		}
	} else if host == "host.docker.internal" {
		if _, err := resolveLocalAddress(context.Background(), host); err != nil {
			return "", err
		}
	} else {
		return "", errors.New("local service URL must use loopback or host.docker.internal")
	}
	parsed.Path, parsed.RawPath = "", ""
	return strings.TrimRight(parsed.String(), "/"), nil
}

func localOnlyHTTPClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{Timeout: timeout}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			ips, err := resolveLocalAddress(ctx, host)
			if err != nil {
				return nil, err
			}
			var lastErr error
			for _, ip := range ips {
				connection, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
				if dialErr == nil {
					return connection, nil
				}
				lastErr = dialErr
			}
			return nil, lastErr
		},
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
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
