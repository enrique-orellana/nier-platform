package workers

import (
	"context"
	"encoding/json"
	"testing"
)

type operationRunner struct{}

func (operationRunner) RunProtocol(_ context.Context, _ CommandSpec, request map[string]any, onEvent func(ProtocolEvent)) error {
	_ = request
	onEvent(ProtocolEvent{Type: "result", Result: json.RawMessage(`{"track":{"id":"es"}}`)})
	return nil
}

func TestPythonOperationClientReturnsWorkerResult(t *testing.T) {
	client := PythonOperationClient{Runner: operationRunner{}}
	result, err := client.Run(context.Background(), "translation-1", "translation", map[string]any{"target_language": "es"}, map[string]string{"X-AI-Provider": "lmstudio"})
	if err != nil {
		t.Fatalf("run operation: %v", err)
	}
	if string(result) != `{"track":{"id":"es"}}` {
		t.Fatalf("unexpected result: %s", result)
	}
}
