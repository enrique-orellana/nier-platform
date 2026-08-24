# Clip Information Regeneration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended for inline work). Steps use checkbox syntax for tracking.

**Goal:** Add a local-editor action that regenerates and persists YouTube/TikTok/Instagram/hook metadata using live selected content, trim range, source_metadata, and source_context, while enriching hashtag generation with the same source facts.

**Architecture:** Keep hashtags and clip-information generation as separate HTTP/worker operations with small JSON contracts. Hydrate the already-persisted sanitized source_metadata onto each project clip, pass live editor state from LocalEditorTab to ClipMetadataPanel, and persist generated fields through the existing project clip metadata PATCH route.

**Tech Stack:** React 18, Vitest Testing Library, Go net/http, Python worker protocol, existing translationRunner, and the existing AI chat_json boundary.

---

## File map

- Modify dashboard/src/components/local-editor/ClipMetadataPanel.jsx: generated metadata state, both AI requests, loading/errors.
- Modify dashboard/src/components/local-editor/LocalEditorTab.jsx: current trim start/end and persistence callback wiring.
- Modify dashboard/src/components/editor/FullScreenEditor.jsx: PATCH regenerated clip information.
- Modify dashboard/src/components/local-editor/ClipMetadataPanel.test.jsx, LocalEditorTab.test.jsx, and editor/FullScreenEditor.test.jsx: red/green UI and persistence coverage.
- Modify backend-go/internal/httpapi/server.go and local_editor_handlers.go: new route and worker handler.
- Modify backend-go/internal/httpapi/project_handlers.go: source_metadata hydration and optional metadata merge.
- Modify backend-go/internal/httpapi/server_test.go: Go route, hydration, and persistence coverage.
- Modify python_worker.py and tests/test_python_worker.py: clip_info operation and organized prompts.

## Task 1: Confirm blast radius and contracts

**Files:** None; read-only analysis before editing symbols.

- [ ] Run GitNexus impact with direction 'upstream', repo 'openshorts', and minConfidence 0.8 for ClipMetadataPanel, LocalEditorTab, FullScreenEditor, Server.generateHashtags, Server.updateProjectClipMetadata, Server.readPersistedProjectClips, and handle_request.
- [ ] Review d=1 callers and affected processes. Stop and warn before editing if any result is HIGH or CRITICAL.
- [ ] Confirm existing contracts: POST /api/local-editor/hashtags accepts title, caption, subtitle_text, source_context and returns hashtags; PATCH /api/projects/{jobID}/clips/{clipIndex}/metadata accepts hashtags.
- [ ] Confirm new contracts: POST /api/local-editor/clip-info accepts title, caption, instagram_caption, subtitle_text, trim_start_seconds, trim_end_seconds, source_metadata, source_context, viral_hook_text; its response has the four generated fields; the PATCH route accepts those fields as optional additions.

## Task 2: Add failing frontend tests

**Files:**
- Modify: dashboard/src/components/local-editor/ClipMetadataPanel.test.jsx
- Modify: dashboard/src/components/local-editor/LocalEditorTab.test.jsx
- Modify: dashboard/src/components/editor/FullScreenEditor.test.jsx

- [ ] Add this bounded source_metadata fixture beside source_context:

~~~js
source_metadata: {
  platform: "youtube",
  title: "Rubius juega Meltopia y desbloquea mejoras",
  channel: "Rubius",
  description: "Partida de Meltopia con mejoras del arma.",
  categories: ["Gaming"],
  tags: ["Meltopia", "Rubius"],
},
~~~

- [ ] Add a red ClipMetadataPanel test with trimStartSeconds={120}, trimEndSeconds={158}, edited subtitle text, and a worker response containing all four generated fields. Click /regenerate clip information/i and assert the body sent to /api/local-editor/clip-info contains title, both current captions, subtitle_text, trim_start_seconds 120, trim_end_seconds 158, source_metadata, source_context, and viral_hook_text. Assert onClipInfoChange receives the exact response and the displayed title/caption update.

- [ ] Extend the existing hashtag test to assert source_metadata is included in the /api/local-editor/hashtags body while preserving title, caption, subtitle_text, and source_context assertions.

- [ ] Add an integrated LocalEditorTab test with initialPlaybackStartMs={120000}, initialPlaybackDurationMs={38000}, edited subtitle cues, and source_metadata. After clicking regeneration, assert subtitle_text is 'Primera frase Segunda frase', trim_start_seconds is 120, trim_end_seconds is 158, and source_metadata is forwarded.

- [ ] Add a FullScreenEditor test that returns the clip-info response, clicks regeneration, and asserts a PATCH to /api/projects/{jobId}/clips/{clipIndex}/metadata with only the four generated fields.

- [ ] Run from dashboard:

~~~powershell
npm test -- --run src/components/local-editor/ClipMetadataPanel.test.jsx src/components/local-editor/LocalEditorTab.test.jsx src/components/editor/FullScreenEditor.test.jsx
~~~

Expected: the new assertions fail for missing behavior; existing tests continue to run.

## Task 3: Implement frontend live-context wiring

**Files:**
- Modify: dashboard/src/components/local-editor/ClipMetadataPanel.jsx
- Modify: dashboard/src/components/local-editor/LocalEditorTab.jsx
- Modify: dashboard/src/components/editor/FullScreenEditor.jsx

- [ ] Add a clipInfoFromMetadata helper and local state with video_title_for_youtube_short, video_description_for_tiktok, video_description_for_instagram, and viral_hook_text. Use local values for the displayed title and caption so a successful response updates immediately.

- [ ] Add sourceMetadata, trimStartSeconds, trimEndSeconds, and onClipInfoChange props to ClipMetadataPanel. Add onClipInfoChange to LocalEditorTab and pass:

~~~jsx
sourceMetadata={clipMetadata?.source_metadata}
trimStartSeconds={playbackStartMs / 1000}
trimEndSeconds={(playbackStartMs + durationMs) / 1000}
onClipInfoChange={onClipInfoChange}
~~~

Use subtitleTextFromCues(subtitleCues) at click time so edited captions are authoritative.

- [ ] Implement the clip-info request with getLocalAiHeaders and this body:

~~~js
{
  title,
  caption,
  instagram_caption: clipInfo.video_description_for_instagram,
  subtitle_text: subtitleTextFromCues(subtitleCues),
  trim_start_seconds: Number(trimStartSeconds) || 0,
  trim_end_seconds: Number(trimEndSeconds) || 0,
  source_metadata: sourceMetadata || {},
  source_context: metadata.source_context || null,
  viral_hook_text: clipInfo.viral_hook_text,
}
~~~

Require all four returned values to be non-empty strings before updating local state or calling onClipInfoChange. Preserve existing values on failure.

- [ ] Add source_metadata: sourceMetadata || {} to the existing hashtag request without changing its response contract.

- [ ] Add a separate Regenerate clip information button beside Generate hashtags. Disable it while active, show Loader2 while active, and show an inline error distinct from hashtagError.

- [ ] In FullScreenEditor, create saveGeneratedClipInfo beside saveGeneratedHashtags. PATCH only the four generated fields to the existing project metadata route and pass it through LocalEditorTab. Standalone local editor behavior remains local-only when no callback exists.

- [ ] Run the focused dashboard tests again. Expected: all new and existing tests pass.

## Task 4: Add failing Python worker tests and implement prompts

**Files:**
- Modify: tests/test_python_worker.py
- Modify: python_worker.py

- [ ] Add a red test that monkeypatches ai_client.load_ai_config and ai_client.chat_json, calls handle_request with operation clip_info and payload containing old fields, live subtitle_text, trim 120/158, source_metadata, and source_context, then parses the emitted result. Assert the result has exactly the four generated fields and the prompt contains CURRENT CLIP, SELECTED CONTENT, SOURCE METADATA, SOURCE CONTEXT, 120, 158, and the source facts.

- [ ] Add a red hashtag prompt test with source_metadata and assert the prompt contains both SOURCE METADATA and SOURCE CONTEXT while output remains {hashtags: [...]}.

- [ ] Implement the clip_info branch beside hashtags. Keep the prompt organized:

~~~python
prompt = f"""Generate clip publishing metadata from the supplied content.
Return JSON only with exactly these keys:
["video_title_for_youtube_short", "video_description_for_tiktok",
 "video_description_for_instagram", "viral_hook_text"].

CURRENT CLIP
YouTube title: {title}
TikTok caption: {caption}
Instagram caption: {instagram_caption}
Viral hook: {viral_hook_text}

SELECTED CONTENT
Trim: {trim_start_seconds:.3f}s to {trim_end_seconds:.3f}s
Caption transcript: {subtitle_text}

SOURCE METADATA
{json.dumps(source_metadata, ensure_ascii=False)}

SOURCE CONTEXT
{json.dumps(source_context, ensure_ascii=False)}

Use only supplied facts, keep the source language, keep the title under 100 characters,
and keep the hook under 10 words.
"""
~~~

Normalize the four returned values with str(value).strip(), reject any empty value with ValueError('AI returned incomplete clip information'), and emit only those four fields.

- [ ] Reorganize the hashtag prompt into CURRENT CLIP, SELECTED CONTENT, SOURCE METADATA, SOURCE CONTEXT, and OUTPUT sections. Keep existing 8–12 normalization/deduplication and {hashtags: [...]} response unchanged.

- [ ] Run python -m pytest tests/test_python_worker.py -q. Expected: all Python-worker tests pass.

## Task 5: Add failing Go API, hydration, and persistence tests

**Files:**
- Modify: backend-go/internal/httpapi/server_test.go
- Modify: backend-go/internal/httpapi/local_editor_handlers.go
- Modify: backend-go/internal/httpapi/server.go
- Modify: backend-go/internal/httpapi/project_handlers.go

- [ ] Add a clip-info worker double accepting only operation clip_info and returning the four generated fields. Add TestLocalEditorClipInfoUsesGoWorkerBoundary that POSTs title and subtitle_text to /api/local-editor/clip-info and expects HTTP 200 plus the new title. It must fail before the route/handler exists.

- [ ] Extend TestProjectClipHashtagsPersistInJobResult to PATCH hashtags plus all four generated fields. Assert the stored clip contains all new values while title, caption, hashtags, and the top-level source field remain intact.

- [ ] Add TestProjectClipsExposeSourceMetadata. Store a result with top-level source_metadata and one clip, GET /api/projects/clips/{jobID}, and assert the returned clip contains the same source_metadata object. It must fail before hydration.

- [ ] Run:

~~~powershell
go test ./backend-go/internal/httpapi -run "TestLocalEditorClipInfoUsesGoWorkerBoundary|TestProjectClipHashtagsPersistInJobResult|TestProjectClipsExposeSourceMetadata" -count=1
~~~

Expected: the new route, fields, and hydration assertions fail before implementation.

## Task 6: Implement Go routing, validation, hydration, and persistence

- [ ] Register /api/local-editor/clip-info in backend-go/internal/httpapi/server.go while keeping /api/local-editor/hashtags unchanged.

- [ ] Implement Server.generateClipInfo in local_editor_handlers.go. Mirror hashtag method/worker checks, require at least one of title, caption, subtitle_text, or source_context, call translationRunner.Run with request id clip-info and operation clip_info, decode the result, require non-empty strings for all four fields, and return the same 400/501/502 error style as hashtags.

- [ ] Keep generic hashtag payload forwarding and update only its worker prompt to read source_metadata.

- [ ] In readPersistedProjectClips, read payload source_metadata as map[string]any and attach it only when non-empty and absent from the clip. Do not alter filename, ranges, source URLs, or unrelated fields.

- [ ] In updateProjectClipMetadata, use optional pointer fields for hashtags and the four generated strings so omitted values are distinguishable. Require at least one field, preserve hashtag normalization, trim and reject empty generated values, merge only supplied fields, and persist the complete result.

- [ ] Run the focused Go test command from Task 5. Expected: all selected tests pass.

## Task 7: Full verification and impact review

- [ ] From dashboard run npm run format, npm run format:check, the focused Vitest command, npm run lint, and npm run build. Expected: every command exits 0.

- [ ] From the repository root run:

~~~powershell
go test ./backend-go/...
python -m pytest tests/test_python_worker.py tests/test_source_context.py -q
~~~

Expected: both commands exit 0 with no new failures.

- [ ] Before any code commit or completion claim, run GitNexus detect_changes with repo openshorts and scope all. Confirm only local-editor metadata/hashtag generation, worker prompts, source-metadata hydration, persistence, and tests are affected. Investigate unexpected HIGH or CRITICAL risk.

- [ ] Run git status --short, git diff --stat, and git diff --check. Confirm no unrelated files changed and video_filename, hashtags, and unrelated clip fields are preserved.
