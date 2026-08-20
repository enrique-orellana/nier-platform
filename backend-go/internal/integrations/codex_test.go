package integrations

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestCodexConnectPersistsPendingDeviceLogin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/accounts/deviceauth/usercode" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"device_auth_id": "device-1", "user_code": "ABCD", "interval": 5})
	}))
	defer server.Close()

	auth := NewCodexAuth(CodexConfig{StorePath: filepath.Join(t.TempDir(), "codex.json"), AuthBaseURL: server.URL, ClientID: "client"}, server.Client())
	result, err := auth.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result["status"] != "pending" || result["userCode"] != "ABCD" {
		t.Fatalf("unexpected connect response: %#v", result)
	}
	status := auth.Status()
	if !status.Pending || status.Connected {
		t.Fatalf("unexpected status: %#v", status)
	}
}

func TestCodexConnectAcceptsStringPollingInterval(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/accounts/deviceauth/usercode" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"device_auth_id":"device-1","user_code":"ABCD","interval":"5"}`))
	}))
	defer server.Close()

	auth := NewCodexAuth(CodexConfig{StorePath: filepath.Join(t.TempDir(), "codex.json"), AuthBaseURL: server.URL, ClientID: "client"}, server.Client())
	result, err := auth.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result["intervalSeconds"] != 5 {
		t.Fatalf("unexpected polling interval: %#v", result)
	}
}

func TestCodexPollReturnsPendingForUnapprovedDevice(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/accounts/deviceauth/token" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()

	auth := NewCodexAuth(CodexConfig{StorePath: filepath.Join(t.TempDir(), "codex.json"), AuthBaseURL: server.URL, ClientID: "client"}, server.Client())
	if err := auth.savePending(PendingDeviceLogin{DeviceAuthID: "device-1", UserCode: "ABCD", IntervalSeconds: 5}); err != nil {
		t.Fatal(err)
	}
	result, err := auth.Poll(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result["status"] != "pending" || result["pending"] != true {
		t.Fatalf("unexpected poll response: %#v", result)
	}
}
