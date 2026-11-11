package httpapi

func (s *Server) setRuntimeMetadata(jobID string, metadata map[string]any) {
	s.runtimeMetadataMu.Lock()
	defer s.runtimeMetadataMu.Unlock()
	s.runtimeMetadata[jobID] = cloneRuntimeMetadata(metadata)
}

func (s *Server) runtimeMetadataForJob(jobID string) map[string]any {
	s.runtimeMetadataMu.Lock()
	defer s.runtimeMetadataMu.Unlock()
	return cloneRuntimeMetadata(s.runtimeMetadata[jobID])
}

func (s *Server) releaseRuntimeMetadata(jobID string) {
	s.runtimeMetadataMu.Lock()
	delete(s.runtimeMetadata, jobID)
	s.runtimeMetadataMu.Unlock()
}

func cloneRuntimeMetadata(metadata map[string]any) map[string]any {
	if metadata == nil {
		return nil
	}
	clone := make(map[string]any, len(metadata))
	for key, value := range metadata {
		if headers, ok := value.(map[string]string); ok {
			copyHeaders := make(map[string]string, len(headers))
			for header, headerValue := range headers {
				copyHeaders[header] = headerValue
			}
			clone[key] = copyHeaders
			continue
		}
		clone[key] = value
	}
	return clone
}
