# Coherent Long-Form ASR Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve long-video transcription coherence by sending compressed five-minute overlapping chunks through the provider/model selected in Settings and merging duplicate boundary segments before highlight analysis.

**Architecture:** Keep `transcribe_video_with_config` as the provider-aware entry point. Local transcription continues using the existing PCM WAV path; OpenRouter uses a dedicated compressed MP3 extractor, five-minute windows, and five-second overlap. A deterministic segment merger removes exact duplicate boundary segments while preserving global timestamps, then the existing text-only highlight analysis runs once over the merged transcript chunks.

**Tech Stack:** Python, FFmpeg, httpx, pytest, existing JSON-lines Python worker, Docker Desktop Kubernetes.

---

### Task 1: Add regression tests for long OpenRouter chunks

**Files:**
- Modify: `tests/test_highlight_generation.py`

- [ ] **Step 1: Write the failing test**

Update the OpenRouter transcription test to require ten 30-second windows becoming four five-minute windows for a 1,200-second source, with five-second overlap:

```python
def test_openrouter_transcription_uses_five_minute_overlapping_chunks(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    config = Mock(transcription_provider="openrouter")
    monkeypatch.setattr(highlight_generation, "load_ai_config", lambda _headers=None: config)
    extracted = []

    def extract_chunk(_source, start, end, destination):
        extracted.append((start, end, destination.suffix))
        destination.write_bytes(b"audio")

    monkeypatch.setattr(highlight_generation, "_extract_openrouter_audio_chunk", extract_chunk)
    monkeypatch.setattr(
        highlight_generation,
        "transcribe_audio_openrouter",
        lambda *_args: {"text": "Cloud text", "language": "en", "segments": [{"start": 0, "end": 1, "text": "Cloud text"}]},
    )

    result = highlight_generation.transcribe_video_with_config(source, 1200.0, headers={"X-AI-Provider": "openrouter"})

    assert result["text"] == " ".join(["Cloud text"] * 5)
    assert extracted == [
        (0.0, 300.0, ".mp3"),
        (295.0, 595.0, ".mp3"),
        (590.0, 890.0, ".mp3"),
        (885.0, 1185.0, ".mp3"),
        (1180.0, 1200.0, ".mp3"),
    ]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_highlight_generation.py::test_openrouter_transcription_uses_five_minute_overlapping_chunks -q`

Expected: FAIL because the current implementation still uses 30-second WAV chunks and does not expose a compressed extractor.

### Task 2: Add compressed OpenRouter extraction

**Files:**
- Modify: `highlight_generation.py:40-95`
- Test: `tests/test_highlight_generation.py`

- [ ] **Step 1: Write the failing test**

Add a command-capture test for the dedicated extractor:

```python
def test_extract_openrouter_audio_chunk_uses_compressed_mono_speech_audio(monkeypatch, tmp_path):
    commands = []
    monkeypatch.setattr(highlight_generation, "_run_ffmpeg", lambda command: commands.append(command))

    destination = tmp_path / "chunk.mp3"
    highlight_generation._extract_openrouter_audio_chunk(tmp_path / "source.mp4", 5.0, 65.0, destination)

    assert commands == [[
        "ffmpeg", "-y", "-ss", "5.000", "-i", str(tmp_path / "source.mp4"),
        "-t", "60.000", "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "libmp3lame", "-b:a", "32k", str(destination),
    ]]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_highlight_generation.py::test_extract_openrouter_audio_chunk_uses_compressed_mono_speech_audio -q`

Expected: FAIL because `_extract_openrouter_audio_chunk` does not exist.

- [ ] **Step 3: Implement the extractor and constants**

Add:

```python
OPENROUTER_TRANSCRIPTION_CHUNK_SECONDS = 300.0
OPENROUTER_TRANSCRIPTION_OVERLAP_SECONDS = 5.0


def _extract_openrouter_audio_chunk(source_path: Path, start: float, end: float, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    _run_ffmpeg([
        "ffmpeg", "-y", "-ss", f"{start:.3f}", "-i", str(source_path),
        "-t", f"{end - start:.3f}", "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "libmp3lame", "-b:a", "32k", str(destination),
    ])
```

Update the OpenRouter path to call `plan_transcription_chunks` with the two OpenRouter constants, write `.mp3` chunks, and call `_extract_openrouter_audio_chunk`. Leave local Whisper extraction unchanged.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `python -m pytest tests/test_highlight_generation.py -q`

Expected: PASS.

### Task 3: Deduplicate overlap segments

**Files:**
- Modify: `highlight_generation.py`
- Test: `tests/test_highlight_generation.py`

- [ ] **Step 1: Write the failing test**

Add:

```python
def test_merge_transcript_segments_removes_duplicate_overlap_segments():
    segments = highlight_generation.merge_transcript_segments([
        {"text": "The important point.", "start": 290.0, "end": 299.0, "words": []},
        {"text": "The important point.", "start": 295.0, "end": 299.0, "words": []},
        {"text": "The next point.", "start": 299.0, "end": 304.0, "words": []},
    ])

    assert [segment["text"] for segment in segments] == ["The important point.", "The next point."]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_highlight_generation.py::test_merge_transcript_segments_removes_duplicate_overlap_segments -q`

Expected: FAIL because `merge_transcript_segments` does not exist.

- [ ] **Step 3: Implement deterministic merging**

Add a public helper that:

1. Sorts segments by global start and end.
2. Normalizes text with case folding and collapsed whitespace.
3. Skips a segment when its normalized text matches a previously kept segment and the time ranges overlap or touch.
4. Keeps non-empty text and returns the original segment shape with global timestamps.

Use the helper at the end of the OpenRouter path before building the transcript text:

```python
segments = merge_transcript_segments(segments)
return {
    "text": " ".join(segment["text"] for segment in segments).strip(),
    "segments": segments,
    "language": language,
}
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `python -m pytest tests/test_highlight_generation.py -q`

Expected: PASS.

### Task 4: Full verification and deployment

**Files:**
- No additional source files.

- [ ] **Step 1: Run the full Python suite**

Run: `python -m pytest -q`

Expected: all tests pass; only the existing dependency deprecation warnings may remain.

- [ ] **Step 2: Run GitNexus staged-change detection**

Stage only `highlight_generation.py` and `tests/test_highlight_generation.py`, then run `detect_changes({repo: "openshorts", scope: "staged"})`. Confirm the result is low-risk and contains no unrelated files or processes.

- [ ] **Step 3: Build and deploy the backend image**

Run:

```powershell
docker build -t openshorts-backend:local .
kubectl --context docker-desktop -n openshorts set image deployment/openshorts-backend backend=openshorts-backend:local
kubectl --context docker-desktop -n openshorts rollout restart deployment/openshorts-backend
kubectl --context docker-desktop -n openshorts rollout status deployment/openshorts-backend --timeout=180s
```

- [ ] **Step 4: Verify the runtime**

Confirm the backend pod is `Running`, `/api/config` returns HTTP 200, and the deployed module reports `OPENROUTER_TRANSCRIPTION_CHUNK_SECONDS == 300.0`.

- [ ] **Step 5: Commit the implementation**

```powershell
git add highlight_generation.py tests/test_highlight_generation.py
git commit -m "feat(asr): improve long-form transcription coherence"
```
