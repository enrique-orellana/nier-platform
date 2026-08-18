import { describe, expect, it } from "vitest";
import { buildProcessRequest } from "./processRequest";

const baseHeaders = {
  "X-AI-Provider": "openrouter",
  "X-AI-Transcription-Language": "auto",
};

describe("buildProcessRequest", () => {
  it("includes the per-generation language in JSON requests", () => {
    const request = buildProcessRequest({
      data: {
        type: "minio-object",
        payload: { bucket: "youtube-downloads", key: "source.mp4" },
        sourceUrl: "https://example.com/source",
        acknowledged: true,
        layoutFormat: "standard",
        facecamSize: "medium",
        transcriptionLanguage: "it",
      },
      headers: baseHeaders,
    });

    expect(request.headers).toMatchObject({
      ...baseHeaders,
      "X-AI-Transcription-Language": "it",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(request.body)).toMatchObject({
      source_object: { bucket: "youtube-downloads", key: "source.mp4" },
      source_url: "https://example.com/source",
      acknowledged: true,
      defer_render: true,
    });
  });

  it("keeps the per-generation language in multipart requests", () => {
    const file = new File(["video"], "source.mp4", { type: "video/mp4" });
    const request = buildProcessRequest({
      data: {
        type: "file",
        payload: file,
        sourceUrl: "https://example.com/source",
        acknowledged: true,
        layoutFormat: "standard",
        facecamSize: "medium",
        transcriptionLanguage: "it",
      },
      headers: baseHeaders,
    });

    expect(request.headers).toMatchObject({
      ...baseHeaders,
      "X-AI-Transcription-Language": "it",
    });
    expect(request.headers).not.toHaveProperty("Content-Type");
    expect(request.body).toBeInstanceOf(FormData);
    expect(request.body.get("file")).toBe(file);
    expect(request.body.get("source_url")).toBe("https://example.com/source");
  });
});
