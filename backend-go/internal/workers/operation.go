package workers

import (
	"context"
	"encoding/json"
	"errors"
)

type PythonOperationClient struct {
	PythonBinary string
	WorkerScript string
	Runner       ProtocolRunner
}

func (c PythonOperationClient) Run(ctx context.Context, id, operation string, payload map[string]any, headers map[string]string) (json.RawMessage, error) {
	if id == "" {
		return nil, errors.New("operation ID is required")
	}
	if operation == "" {
		return nil, errors.New("operation name is required")
	}
	runner := c.Runner
	if runner == nil {
		runner = ExecProtocolRunner{}
	}
	pythonBinary := c.PythonBinary
	if pythonBinary == "" {
		pythonBinary = "python"
	}
	workerScript := c.WorkerScript
	if workerScript == "" {
		workerScript = "python_worker.py"
	}
	request := map[string]any{
		"id":        id,
		"operation": operation,
		"payload":   payload,
		"headers":   headers,
	}
	var result json.RawMessage
	var protocolErr error
	runErr := runner.RunProtocol(ctx, CommandSpec{
		Name: pythonBinary,
		Args: []string{"-u", workerScript},
		Env:  []string{"PYTHONUNBUFFERED=1"},
	}, request, func(event ProtocolEvent) {
		if event.Type == "error" && protocolErr == nil {
			protocolErr = errors.New(event.Error)
		}
		if event.Type == "result" {
			result = append(json.RawMessage(nil), event.Result...)
		}
	})
	if runErr != nil {
		return nil, runErr
	}
	if protocolErr != nil {
		return nil, protocolErr
	}
	if len(result) == 0 {
		return nil, errors.New("worker returned no result")
	}
	return result, nil
}
