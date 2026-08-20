package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const defaultCodexClientID = "app_EMoamEEZ73f0CkXaXp7hrann"

type CodexConfig struct {
	StorePath   string
	AuthBaseURL string
	ClientID    string
}

type CodexStatus struct {
	Connected bool `json:"connected"`
	Pending   bool `json:"pending"`
}

type PendingDeviceLogin struct {
	DeviceAuthID    string  `json:"device_auth_id"`
	UserCode        string  `json:"user_code"`
	IntervalSeconds int     `json:"interval_seconds"`
	StartedAt       float64 `json:"started_at"`
}

type flexibleInt int

func (value *flexibleInt) UnmarshalJSON(data []byte) error {
	var number int
	if err := json.Unmarshal(data, &number); err == nil {
		*value = flexibleInt(number)
		return nil
	}

	var text string
	if err := json.Unmarshal(data, &text); err != nil {
		return err
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(text))
	if err != nil {
		return err
	}
	*value = flexibleInt(parsed)
	return nil
}

type codexCredentials struct {
	AccessToken  string  `json:"access_token"`
	RefreshToken string  `json:"refresh_token"`
	IDToken      string  `json:"id_token"`
	AccountID    string  `json:"account_id"`
	ExpiresAt    float64 `json:"expires_at"`
}

type CodexAuth struct {
	config CodexConfig
	client *http.Client
}

func NewCodexAuth(config CodexConfig, client *http.Client) *CodexAuth {
	if config.AuthBaseURL == "" {
		config.AuthBaseURL = "https://auth.openai.com"
	}
	if config.ClientID == "" {
		config.ClientID = defaultCodexClientID
	}
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	return &CodexAuth{config: config, client: client}
}

func (a *CodexAuth) Status() CodexStatus {
	_, pendingErr := a.loadPending()
	_, credentialsErr := a.loadCredentials()
	return CodexStatus{Connected: credentialsErr == nil, Pending: pendingErr == nil}
}

func (a *CodexAuth) Connect(ctx context.Context) (map[string]any, error) {
	if pending, err := a.loadPending(); err == nil {
		return pendingPublic(pending), nil
	}
	var response struct {
		DeviceAuthID string      `json:"device_auth_id"`
		UserCode     string      `json:"user_code"`
		Usercode     string      `json:"usercode"`
		Interval     flexibleInt `json:"interval"`
	}
	if err := a.postJSON(ctx, "/api/accounts/deviceauth/usercode", map[string]string{"client_id": a.config.ClientID}, &response); err != nil {
		return nil, fmt.Errorf("unable to start ChatGPT device authorization: %w", err)
	}
	if response.DeviceAuthID == "" || (response.UserCode == "" && response.Usercode == "") {
		return nil, errors.New("ChatGPT returned an invalid device authorization response")
	}
	if response.UserCode == "" {
		response.UserCode = response.Usercode
	}
	pending := PendingDeviceLogin{DeviceAuthID: response.DeviceAuthID, UserCode: response.UserCode, IntervalSeconds: maxInt(int(response.Interval), 5), StartedAt: float64(time.Now().Unix())}
	if err := a.savePending(pending); err != nil {
		return nil, err
	}
	return pendingPublic(pending), nil
}

func (a *CodexAuth) Poll(ctx context.Context) (map[string]any, error) {
	pending, err := a.loadPending()
	if err != nil {
		status := a.Status()
		return map[string]any{"connected": status.Connected, "pending": status.Pending}, nil
	}
	var response map[string]any
	request := map[string]string{"device_auth_id": pending.DeviceAuthID, "user_code": pending.UserCode}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.endpoint("/api/accounts/deviceauth/token"), strings.NewReader(mustJSON(request)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, err
	}
	body, readErr := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if readErr != nil {
		return nil, readErr
	}
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusNotFound {
		return map[string]any{"status": "pending", "connected": false, "pending": true}, nil
	}
	if resp.StatusCode != http.StatusOK {
		_ = os.Remove(a.pendingPath())
		return map[string]any{"status": "error", "connected": false, "pending": false, "error": "ChatGPT device authorization failed."}, nil
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, err
	}
	authorizationCode, _ := response["authorization_code"].(string)
	codeVerifier, _ := response["code_verifier"].(string)
	if authorizationCode == "" || codeVerifier == "" {
		return nil, errors.New("ChatGPT returned an invalid authorization response")
	}
	credentials, err := a.exchange(ctx, authorizationCode, codeVerifier)
	if err != nil {
		_ = os.Remove(a.pendingPath())
		return nil, err
	}
	if err := a.saveCredentials(credentials); err != nil {
		return nil, err
	}
	_ = os.Remove(a.pendingPath())
	return map[string]any{"status": "connected", "connected": true, "pending": false}, nil
}

func (a *CodexAuth) Disconnect() error {
	if err := os.Remove(a.config.StorePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	_ = os.Remove(a.pendingPath())
	return nil
}

func (a *CodexAuth) savePending(pending PendingDeviceLogin) error {
	return writePrivateJSON(a.pendingPath(), pending)
}

func (a *CodexAuth) loadPending() (PendingDeviceLogin, error) {
	var pending PendingDeviceLogin
	err := readJSON(a.pendingPath(), &pending)
	if err != nil {
		return PendingDeviceLogin{}, err
	}
	if pending.DeviceAuthID == "" || pending.UserCode == "" {
		return PendingDeviceLogin{}, errors.New("invalid pending login")
	}
	return pending, nil
}

func (a *CodexAuth) loadCredentials() (codexCredentials, error) {
	var credentials codexCredentials
	err := readJSON(a.config.StorePath, &credentials)
	if err != nil || credentials.AccessToken == "" || credentials.RefreshToken == "" {
		return codexCredentials{}, errors.New("credentials unavailable")
	}
	return credentials, nil
}

func (a *CodexAuth) saveCredentials(credentials codexCredentials) error {
	return writePrivateJSON(a.config.StorePath, credentials)
}

func (a *CodexAuth) exchange(ctx context.Context, code, verifier string) (codexCredentials, error) {
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {a.endpoint("/deviceauth/callback")}, "client_id": {a.config.ClientID}, "code_verifier": {verifier}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.endpoint("/oauth/token"), strings.NewReader(form.Encode()))
	if err != nil {
		return codexCredentials{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := a.client.Do(req)
	if err != nil {
		return codexCredentials{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return codexCredentials{}, errors.New("ChatGPT token exchange failed")
	}
	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return codexCredentials{}, err
	}
	access, _ := payload["access_token"].(string)
	refresh, _ := payload["refresh_token"].(string)
	if access == "" || refresh == "" {
		return codexCredentials{}, errors.New("Codex authentication returned no access token")
	}
	return codexCredentials{AccessToken: access, RefreshToken: refresh, IDToken: stringValue(payload["id_token"]), AccountID: stringValue(payload["account_id"]), ExpiresAt: float64(time.Now().Add(time.Hour).Unix())}, nil
}

func (a *CodexAuth) postJSON(ctx context.Context, path string, payload any, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.endpoint(path), strings.NewReader(mustJSON(payload)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("auth endpoint returned status %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(target)
}

func (a *CodexAuth) endpoint(path string) string {
	return strings.TrimRight(a.config.AuthBaseURL, "/") + path
}
func (a *CodexAuth) pendingPath() string {
	return filepath.Join(filepath.Dir(a.config.StorePath), ".codex-pending.json")
}

func pendingPublic(pending PendingDeviceLogin) map[string]any {
	return map[string]any{"status": "pending", "verificationUrl": "https://auth.openai.com/codex/device", "userCode": pending.UserCode, "intervalSeconds": pending.IntervalSeconds}
}

func writePrivateJSON(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".codex-*")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(encoded); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryName, path)
}

func readJSON(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}
func mustJSON(value any) string    { data, _ := json.Marshal(value); return string(data) }
func stringValue(value any) string { result, _ := value.(string); return result }
func maxInt(value, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}
