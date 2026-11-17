export function buildProcessRequest({ data, headers }) {
  const requestHeaders = {
    ...headers,
    "X-AI-Transcription-Language": data.transcriptionLanguage || "auto",
    "X-Clip-Analysis-Provider": data.clipAnalysisBackend || "configured",
  };
  if (data.clipAnalysisBackend === "ollama") {
    requestHeaders["X-Clip-Ollama-Base-Url"] = data.ollamaBaseUrl || "";
    requestHeaders["X-Clip-Ollama-Model"] = data.ollamaModel || "";
  }
  let body;

  if (data.type === "minio-object" || data.type === "url") {
    requestHeaders["Content-Type"] = "application/json";
    body = JSON.stringify(
      data.type === "minio-object"
        ? {
            source_object: data.payload,
            source_url: data.sourceUrl?.trim() || undefined,
            acknowledged: !!data.acknowledged,
            defer_render: true,
            layout_format: data.layoutFormat || "standard",
            facecam_size: data.facecamSize || "medium",
          }
        : {
            url: data.payload,
            source_url: data.sourceUrl?.trim() || undefined,
            acknowledged: !!data.acknowledged,
            defer_render: true,
            layout_format: data.layoutFormat || "standard",
            facecam_size: data.facecamSize || "medium",
          },
    );
  } else {
    const formData = new FormData();
    formData.append("file", data.payload);
    formData.append("acknowledged", data.acknowledged ? "true" : "false");
    formData.append("defer_render", "true");
    if (data.sourceUrl?.trim())
      formData.append("source_url", data.sourceUrl.trim());
    formData.append("layout_format", data.layoutFormat || "standard");
    formData.append("facecam_size", data.facecamSize || "medium");
    body = formData;
  }

  return { headers: requestHeaders, body };
}
