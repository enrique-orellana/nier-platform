# AI Subtitle Reaction Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reviewed, AI-generated emoji reaction layer for the active subtitle track, persisted through the editor and rendered in preview/export without changing subtitle text.

**Architecture:** The local editor sends active-track cue text and timings to a new `/api/local-editor/subtitle-reactions` endpoint. The Go API forwards the request to a new Python-worker `subtitle_reactions` operation, which calls the existing configured AI provider and returns validated cue-indexed emoji suggestions. React keeps suggestions pending in a review panel until one `commitEdit` operation stores `subtitleReactions` and `subtitleReactionStyle`; both manifest serializers and Remotion then carry and render that separate layer.

**Tech Stack:** React 18, Vite, Vitest, Remotion, TypeScript, Go `net/http`, Python worker, existing `ai_client.chat_json`, existing editor history and manifest adapters.

---

## File map

- Create `dashboard/src/components/local-editor/subtitleReactions.js` for shared reaction defaults, normalization, request shaping, and pending-review conversion.
- Create `dashboard/src/components/local-editor/subtitleReactions.test.js` for pure reaction helper tests.
- Create `dashboard/src/components/local-editor/SubtitleReactionReviewPanel.jsx` for the controlled review UI.
- Create `dashboard/src/components/local-editor/SubtitleReactionReviewPanel.test.jsx` for review editing, removal, style, retry, and apply events.
- Modify `dashboard/src/components/local-editor/LocalEditorTab.jsx` and `LocalEditorTab.test.jsx` to request suggestions, own pending review state, and commit the applied layer.
- Modify `dashboard/src/components/local-editor/localEditorAi.js` only if the request helper needs to share provider headers; keep `getLocalAiHeaders()` as the single header source.
- Modify `backend-go/internal/httpapi/server.go` to register the new endpoint.
- Modify `backend-go/internal/httpapi/local_editor_handlers.go` to validate the request, call the Python worker, and validate the worker response shape.
- Modify `backend-go/internal/httpapi/server_test.go` for route, validation, forwarding, and worker-result tests.
- Modify `python_worker.py` to add the `subtitle_reactions` operation using `chat_json` and strict output normalization.
- Modify `tests/test_python_worker.py` for prompt, provider, structured-output, malformed-output, and empty-output coverage.
- Modify `dashboard/src/components/editor/FullScreenEditor.jsx` and `FullScreenEditor.test.jsx` to hydrate and persist reaction state through local editor drafts and legacy subtitle mirrors.
- Modify `dashboard/src/editor/designcomboAdapter.js` and `designcomboAdapter.test.js` to round-trip reactions in `subtitle_tracks[].reactions` / `reactionStyle` and `layers.subtitles.reactions` / `reactionStyle` for the original legacy mirror.
- Modify `dashboard/src/remotion/lib/types.ts` to define `SubtitleReaction`, `SubtitleReactionStyle`, and optional fields on subtitle config/track schemas.
- Create `dashboard/src/remotion/components/SubtitleReactions.tsx` and `SubtitleReactions.test.jsx` for time-aware reaction rendering.
- Modify `dashboard/src/remotion/compositions/Subtitles.tsx` and `Subtitles.test.jsx` to normalize and render the optional reaction layer alongside the existing subtitle block.

## Execution rules

- Before editing each existing function, class, or method, run GitNexus `impact({target, direction: "upstream", repo: "nier-platform"})`; stop and warn before any HIGH or CRITICAL-risk edit.
- Follow the red-green-refactor cycle for every new behavior: write the failing test, run it and confirm the expected failure, implement the smallest passing change, then refactor only while green.
- Preserve the existing unstaged changes in `dashboard/src/components/editor/FullScreenEditor.jsx`, `FullScreenEditor.test.jsx`, `dashboard/src/editor/designcomboAdapter.js`, and `designcomboAdapter.test.js`; do not stage them unless they are part of this feature’s implementation.

### Task 1: Define and test reaction data helpers

**Files:**
- Create: `dashboard/src/components/local-editor/subtitleReactions.test.js`
- Create: `dashboard/src/components/local-editor/subtitleReactions.js`

- [ ] **Step 1: Write the failing helper tests.** Add tests for the exact shared contract:

```js
import {
  DEFAULT_SUBTITLE_REACTION_STYLE,
  normalizeSubtitleReactionStyle,
  normalizeSubtitleReactions,
  reactionRequestCues,
} from "./subtitleReactions";

it("normalizes valid reaction overlays and drops invalid entries", () => {
  expect(
    normalizeSubtitleReactions([
      { id: "cue-0", cueIndex: 0, startMs: 100, endMs: 900, emojis: ["😱"] },
      { cueIndex: "bad", startMs: 900, endMs: 800, emojis: ["😂"] },
    ]),
  ).toEqual([
    {
      id: "cue-0",
      cueIndex: 0,
      startMs: 100,
      endMs: 900,
      emojis: ["😱"],
      enabled: true,
    },
  ]);
});

it("normalizes reaction style to safe defaults", () => {
  expect(normalizeSubtitleReactionStyle({ position: "left", scale: 9 })).toEqual({
    ...DEFAULT_SUBTITLE_REACTION_STYLE,
    position: "left",
    scale: 2,
  });
});

it("builds an AI request from non-empty timed cues", () => {
  expect(
    reactionRequestCues([
      { text: "", startMs: 0, endMs: 500 },
      { text: "That was close", startMs: 500, endMs: 1500 },
    ]),
  ).toEqual([
    { index: 1, text: "That was close", startMs: 500, endMs: 1500 },
  ]);
});
```

- [ ] **Step 2: Run the focused test and confirm RED.**

Run: `npm test -- --run src/components/local-editor/subtitleReactions.test.js` from `dashboard`.

Expected: FAIL because `subtitleReactions.js` does not exist yet.

- [ ] **Step 3: Implement the minimal helpers.** Export `DEFAULT_SUBTITLE_REACTION_STYLE` as `{ position: "above", animation: "pop", scale: 1 }`; clamp scale to `1..2`; accept only `above|left|right` and `pop|shake|fade`; normalize each reaction to `{ id, cueIndex, startMs, endMs, emojis, enabled }`; keep at most two trimmed emojis; build request cues with original cue indexes; and export `makePendingReactionReview(reactions, cues)` to attach source cue text for the review panel.

```js
export const DEFAULT_SUBTITLE_REACTION_STYLE = {
  position: "above",
  animation: "pop",
  scale: 1,
};

export const normalizeSubtitleReactionStyle = (value = {}) => ({
  position: ["above", "left", "right"].includes(value.position)
    ? value.position
    : DEFAULT_SUBTITLE_REACTION_STYLE.position,
  animation: ["pop", "shake", "fade"].includes(value.animation)
    ? value.animation
    : DEFAULT_SUBTITLE_REACTION_STYLE.animation,
  scale: Math.min(2, Math.max(1, Number(value.scale) || 1)),
});

export const normalizeSubtitleReactions = (items = []) =>
  (Array.isArray(items) ? items : []).flatMap((item, index) => {
    const cueIndex = Number(item?.cueIndex);
    const startMs = Number(item?.startMs);
    const endMs = Number(item?.endMs);
    const emojis = (Array.isArray(item?.emojis) ? item.emojis : [])
      .map((emoji) => String(emoji).trim())
      .filter(Boolean)
      .slice(0, 2);
    if (!Number.isInteger(cueIndex) || startMs < 0 || endMs <= startMs || !emojis.length)
      return [];
    return [{ id: item.id || `reaction-${cueIndex}-${index}`, cueIndex, startMs, endMs, emojis, enabled: item.enabled !== false }];
  });

export const makePendingReactionReview = (reactions = [], cues = []) =>
  normalizeSubtitleReactions(reactions).flatMap((reaction) => {
    const cue = cues[reaction.cueIndex];
    return cue ? [{ ...reaction, text: cue.text || cue.label || "" }] : [];
  });

export const reactionRequestCues = (cues = []) =>
  cues.flatMap((cue, index) => {
    const text = String(cue?.text || cue?.label || "").trim();
    const startMs = Number(cue?.startMs);
    const endMs = Number(cue?.endMs);
    return text && Number.isFinite(startMs) && endMs > startMs
      ? [{ index, text, startMs, endMs }]
      : [];
  });
```

- [ ] **Step 4: Run the focused test and confirm GREEN.**

Run: `npm test -- --run src/components/local-editor/subtitleReactions.test.js`.

Expected: PASS with all helper assertions green.

- [ ] **Step 5: Commit the isolated helper change after GitNexus review.** Run `git diff --check`, run `mcp__gitnexus__detect_changes({repo:"nier-platform",scope:"all"})`, confirm only the new helper files are in scope, then commit:

```text
feat: add subtitle reaction data helpers
```

### Task 2: Add the AI worker contract and Python tests

**Files:**
- Modify: `tests/test_python_worker.py`
- Modify: `python_worker.py`

- [ ] **Step 1: Write failing worker tests.** Add tests showing that `handle_request({operation: "subtitle_reactions"})` calls `ai_client.chat_json`, includes the cue text and JSON-only instructions in the prompt, returns valid reactions, limits each result to two emojis, and rejects malformed or empty results.

```python
def test_handle_request_generates_valid_subtitle_reactions(monkeypatch, capsys):
    prompts = []

    def fake_chat_json(_config, prompt, **_kwargs):
        prompts.append(prompt)
        return {"reactions": [{"cueIndex": 0, "emojis": ["😱", "💥", "😂"]}]}

    monkeypatch.setattr("ai_client.chat_json", fake_chat_json)
    handle_request({
        "id": "reactions-1",
        "operation": "subtitle_reactions",
        "payload": {"cues": [{"index": 0, "text": "That was close", "startMs": 0, "endMs": 900}]},
        "headers": {"X-AI-Provider": "lmstudio"},
    })

    event = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert "That was close" in prompts[0]
    assert event["result"] == {"reactions": [{"cueIndex": 0, "emojis": ["😱", "💥"]}]}


def test_handle_request_rejects_empty_subtitle_reactions(monkeypatch):
    monkeypatch.setattr("ai_client.chat_json", lambda *_args, **_kwargs: {"reactions": []})
    with pytest.raises(ValueError, match="no usable subtitle reactions"):
        handle_request({
            "id": "reactions-2",
            "operation": "subtitle_reactions",
            "payload": {"cues": [{"index": 0, "text": "Hello", "startMs": 0, "endMs": 500}]},
            "headers": {"X-AI-Provider": "lmstudio"},
        })
```

- [ ] **Step 2: Run the focused Python tests and confirm RED.**

Run: `python -m pytest tests/test_python_worker.py -k subtitle_reactions -q`.

Expected: FAIL because the worker does not recognize `subtitle_reactions`.

- [ ] **Step 3: Implement the worker operation.** In `python_worker.py`, add a branch beside `hashtags` that loads the AI config, calls `chat_json(config, prompt, model=config.analyze_model or config.text_model)`, asks for JSON shaped as `{ "reactions": [{ "cueIndex": 0, "emojis": ["😱"] }] }`, ignores unknown indexes, trims empty values, keeps at most two emojis per cue, deduplicates within each cue, and raises `ValueError("AI returned no usable subtitle reactions")` when no valid entries remain.

```python
        if operation == "subtitle_reactions":
            from ai_client import chat_json, load_ai_config

            payload = request.get("payload") or {}
            config = load_ai_config(request.get("headers") or {})
            if config.is_gemini() and not config.api_key:
                raise ValueError("Missing X-Gemini-Key header")
            cues = payload.get("cues") or []
            prompt = (
                "Suggest expressive, readable emoji reactions for these subtitle cues. "
                "Return JSON only with {\\"reactions\\":[{\\"cueIndex\\":0,\\"emojis\\":[\\"😱\\"]}]}. "
                "Use zero, one, or two emojis per cue and avoid repeating the same reaction everywhere.\\n\\n"
                f"CUES: {json.dumps(cues, ensure_ascii=False, default=str)}"
            )
            response = chat_json(config, prompt, model=config.analyze_model or config.text_model)
            valid_indexes = {int(cue.get("index")) for cue in cues if str(cue.get("index")).isdigit()}
            reactions = []
            for item in response.get("reactions", []) if isinstance(response, dict) else []:
                try:
                    cue_index = int(item.get("cueIndex"))
                except (TypeError, ValueError):
                    continue
                emojis = list(dict.fromkeys(str(value).strip() for value in item.get("emojis", []) if str(value).strip()))[:2]
                if cue_index in valid_indexes and emojis:
                    reactions.append({"cueIndex": cue_index, "emojis": emojis})
            if not reactions:
                raise ValueError("AI returned no usable subtitle reactions")
            _emit({"id": request_id, "type": "result", "result": {"reactions": reactions}})
            return
```

- [ ] **Step 4: Run the focused Python tests and confirm GREEN.**

Run: `python -m pytest tests/test_python_worker.py -k subtitle_reactions -q`.

Expected: PASS.

- [ ] **Step 5: Commit the worker contract after GitNexus review.** Run `git diff --check`, run `mcp__gitnexus__detect_changes({repo:"nier-platform",scope:"all"})`, and commit:

```text
feat: generate subtitle reactions with AI
```

### Task 3: Expose and validate the Go local-editor endpoint

**Files:**
- Modify: `backend-go/internal/httpapi/server_test.go`
- Modify: `backend-go/internal/httpapi/local_editor_handlers.go`
- Modify: `backend-go/internal/httpapi/server.go`

- [ ] **Step 1: Run GitNexus impact analysis for `NewServer`.** Use the upstream impact report to confirm the route-registration blast radius before editing the existing route table; warn the user before proceeding if the risk is HIGH or CRITICAL. The new handler itself is a new symbol and does not require a pre-change impact report.

- [ ] **Step 2: Write failing Go handler tests.** Add coverage for POST forwarding, malformed JSON, missing/empty cues, worker errors, malformed worker JSON, invalid indexes, and successful normalization. Use the existing fake Python runner in `server_test.go` and assert the worker operation is `subtitle_reactions` with the forwarded AI headers.

```go
type subtitleReactionsOperation struct{}

func (subtitleReactionsOperation) Run(_ context.Context, _ string, operation string, payload map[string]any, _ map[string]string) (json.RawMessage, error) {
    if operation != "subtitle_reactions" || payload["track_id"] != "original" {
        return nil, fmt.Errorf("unexpected subtitle reaction request: %s %#v", operation, payload)
    }
    return json.RawMessage(`{"reactions":[{"cueIndex":0,"emojis":["😱"]}]}`), nil
}

func TestLocalEditorSubtitleReactionsValidatesAndForwards(t *testing.T) {
    server := NewServerWithDependencies(config.Config{}, jobs.NewMemoryStore(), nil, subtitleReactionsOperation{})
    request := httptest.NewRequest(http.MethodPost, "/api/local-editor/subtitle-reactions", strings.NewReader(
        `{"track_id":"original","cues":[{"index":0,"text":"That was close","startMs":0,"endMs":900}]}`,
    ))
    request.Header.Set("X-AI-Provider", "lmstudio")
    response := httptest.NewRecorder()

    server.Handler().ServeHTTP(response, request)

    if response.Code != http.StatusOK { t.Fatalf("status = %d", response.Code) }
    if !strings.Contains(response.Body.String(), `"cueIndex":0`) { t.Fatalf("body = %s", response.Body.String()) }
}
```

- [ ] **Step 3: Run the focused Go tests and confirm RED.**

Run: `go test ./internal/httpapi -run LocalEditorSubtitleReactions -count=1` from `backend-go`.

Expected: FAIL because the route is not registered.

- [ ] **Step 4: Implement the route and handler.** Register `/api/local-editor/subtitle-reactions` in `NewServer`; add `generateSubtitleReactions` beside `generateHashtags`; decode `{track_id,cues}`, require a non-empty track ID and at least one cue with non-empty text and `endMs > startMs`, call `s.translationRunner.Run(r.Context(), "subtitle-reactions", "subtitle_reactions", payload, translationHeaders(r))`, decode the worker result, validate its `reactions` array against submitted indexes and a maximum of two emojis, and return `400`, `502`, or `200` using the project’s existing `detail` response shape.

```go
func cueMillisecondValue(value any) float64 {
    parsed, err := strconv.ParseFloat(fmt.Sprint(value), 64)
    if err != nil { return -1 }
    return parsed
}

func (s *Server) generateSubtitleReactions(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost { writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"}); return }
    if s.translationRunner == nil { writeJSON(w, http.StatusNotImplemented, map[string]string{"detail": "Python worker is not configured"}); return }
    var payload struct { TrackID string `json:"track_id"`; Cues []map[string]any `json:"cues"` }
    if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || strings.TrimSpace(payload.TrackID) == "" {
        writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "A subtitle track and valid cues are required."}); return
    }
    validCues := make([]map[string]any, 0, len(payload.Cues))
    for _, cue := range payload.Cues {
        if strings.TrimSpace(fmt.Sprint(cue["text"])) == "" || cueMillisecondValue(cue["endMs"]) <= cueMillisecondValue(cue["startMs"]) { continue }
        validCues = append(validCues, cue)
    }
    if len(validCues) == 0 { writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "At least one timed subtitle cue is required."}); return }
    result, err := s.translationRunner.Run(r.Context(), "subtitle-reactions", "subtitle_reactions", map[string]any{"track_id": payload.TrackID, "cues": validCues}, translationHeaders(r))
    if err != nil { writeJSON(w, http.StatusBadGateway, map[string]string{"detail": fmt.Sprintf("Subtitle reaction generation failed: %s", err)}); return }
    var response struct { Reactions []map[string]any `json:"reactions"` }
    if err := json.Unmarshal(result, &response); err != nil { writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Invalid subtitle reaction worker result"}); return }
    writeJSON(w, http.StatusOK, map[string]any{"reactions": response.Reactions})
}
```

- [ ] **Step 5: Run the focused Go tests and confirm GREEN.**

Run: `go test ./internal/httpapi -run LocalEditorSubtitleReactions -count=1`.

Expected: PASS.

- [ ] **Step 6: Commit the API boundary after GitNexus review.** Run `gofmt` on changed Go files, `git diff --check`, `mcp__gitnexus__detect_changes({repo:"nier-platform",scope:"all"})`, and commit:

```text
feat: expose subtitle reaction suggestions endpoint
```

### Task 4: Round-trip reactions through editor state and manifests

**Files:**
- Modify: `dashboard/src/components/editor/FullScreenEditor.test.jsx`
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Modify: `dashboard/src/editor/designcomboAdapter.test.js`
- Modify: `dashboard/src/editor/designcomboAdapter.js`

- [ ] **Step 1: Run GitNexus upstream impact analysis for `manifestToLocalEditorState`, `localEditorStateToManifest`, `manifestToEditorState`, and `editorStateToManifest`.** Review direct callers and affected flows before modifying these symbols.

- [ ] **Step 2: Write failing round-trip tests.** Add fixtures with `subtitle_tracks[0].reactions` and `reactionStyle`; assert hydration exposes `subtitleReactions` and `subtitleReactionStyle`, serialization preserves them on the active track, and original-track legacy mirrors are written to `layers.subtitles` without mutating the source manifest. Add an empty-layer test proving old manifests yield `[]` plus default style.

```js
it("round-trips subtitle reactions without mutating the source manifest", () => {
  const source = {
    layers: { subtitles: { cues: [{ text: "Close", startMs: 0, endMs: 900 }] } },
    subtitle_tracks: [{ id: "original", cues: [{ text: "Close", startMs: 0, endMs: 900 }], captions: [] }],
    active_subtitle_track_id: "original",
  };
  const state = manifestToLocalEditorState({ ...source, subtitle_tracks: [{ ...source.subtitle_tracks[0], reactions: [{ id: "r0", cueIndex: 0, startMs: 0, endMs: 900, emojis: ["😱"] }] }] }, "original");
  const next = localEditorStateToManifest(source, state, "original");

  expect(state.subtitleReactions[0]).toMatchObject({ cueIndex: 0, emojis: ["😱"] });
  expect(next.subtitle_tracks[0].reactions[0]).toMatchObject({ cueIndex: 0, emojis: ["😱"] });
  expect(source.subtitle_tracks[0].reactions).toBeUndefined();
});
```

- [ ] **Step 3: Run the focused adapter tests and confirm RED.**

Run: `npm test -- --run src/components/editor/FullScreenEditor.test.jsx src/editor/designcomboAdapter.test.js` from `dashboard`.

Expected: FAIL because the state and manifest adapters currently omit reaction fields.

- [ ] **Step 4: Implement the state and adapter mapping.** Add `subtitleReactions` and `subtitleReactionStyle` to the local editor state defaults; hydrate from the selected track and legacy original-layer mirror; normalize through `subtitleReactions.js`; spread the fields into `nextTrack`; and mirror them into `layers.subtitles` only for the original legacy layer. In `manifestToRenderProps`, pass the selected track’s reactions and style into `subtitles` / `subtitleTracks`.

```js
const subtitleReactions = normalizeSubtitleReactions(
  activeTrack?.reactions || (trackId === "original" ? source.layers?.subtitles?.reactions : []),
);
const subtitleReactionStyle = normalizeSubtitleReactionStyle(
  activeTrack?.reactionStyle || (trackId === "original" ? source.layers?.subtitles?.reactionStyle : null),
);

// Add these properties to the existing manifestToLocalEditorState return object:
  subtitleReactions,
  subtitleReactionStyle,
```

- [ ] **Step 5: Run the focused adapter tests and confirm GREEN.**

Run: `npm test -- --run src/components/editor/FullScreenEditor.test.jsx src/editor/designcomboAdapter.test.js`.

Expected: PASS, including all pre-existing subtitle adapter tests.

- [ ] **Step 6: Commit the persistence boundary after GitNexus review.** Run `npm run format` only after reviewing the diff, then `npm run format:check`, run `mcp__gitnexus__detect_changes({repo:"nier-platform",scope:"all"})`, and commit:

```text
feat: persist subtitle reaction layers
```

### Task 5: Add the Remotion reaction renderer

**Files:**
- Modify: `dashboard/src/remotion/lib/types.ts`
- Create: `dashboard/src/remotion/components/SubtitleReactions.tsx`
- Create: `dashboard/src/remotion/components/SubtitleReactions.test.jsx`
- Modify: `dashboard/src/remotion/compositions/Subtitles.tsx`
- Modify: `dashboard/src/remotion/compositions/Subtitles.test.jsx`

- [ ] **Step 1: Run GitNexus upstream impact analysis for `Subtitles` and `SubtitleConfig`.** Review the ShortVideo composition and all subtitle timing flows before changing the shared render contract.

- [ ] **Step 2: Write failing renderer tests.** Test that an enabled reaction renders only during `[startMs,endMs)`, uses the selected emoji text, renders nothing outside its cue, and remains absent when the optional layer is omitted. Mock `useCurrentFrame` / `useVideoConfig` using the existing `Subtitles.test.jsx` pattern.

```jsx
it("renders an enabled reaction during its cue window", () => {
  render(
    <SubtitleReactions
      reactions={[{ id: "r0", cueIndex: 0, startMs: 0, endMs: 1000, emojis: ["😱"], enabled: true }]}
      style={{ position: "above", animation: "pop", scale: 1 }}
      currentTimeMs={500}
      fps={30}
    />,
  );
  expect(screen.getByText("😱")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run the focused renderer tests and confirm RED.**

Run: `npm test -- --run src/remotion/components/SubtitleReactions.test.jsx src/remotion/compositions/Subtitles.test.jsx` from `dashboard`.

Expected: FAIL because the component and reaction fields do not exist.

- [ ] **Step 4: Implement the minimal renderer.** Add the optional reaction types and schemas; create a pointer-transparent `SubtitleReactions` component that filters enabled timed reactions, positions them relative to the subtitle block, clamps scale, applies the selected animation with Remotion `spring` / `interpolate`, and renders each overlay as a span. In `Subtitles.tsx`, normalize reaction data once, compute the same media/frame time used by `SubtitleBlock`, and render the reaction component inside the subtitle block wrapper without changing `WordSpan` behavior.

```tsx
// Define SubtitleReactionsProps, positionStyle, and reactionStyle in this file.
export const SubtitleReactions: React.FC<SubtitleReactionsProps> = ({
  reactions = [],
  style,
  currentTimeMs,
  fps,
}) => {
  const active = reactions.filter(
    (reaction) => reaction.enabled && currentTimeMs >= reaction.startMs && currentTimeMs < reaction.endMs,
  );
  if (!active.length) return null;
  return (
    <div style={{ pointerEvents: "none", position: "absolute", ...positionStyle(style.position) }}>
      {active.map((reaction) => (
        <span key={reaction.id} style={reactionStyle(reaction, style, currentTimeMs, fps)}>
          {reaction.emojis.join(" ")}
        </span>
      ))}
    </div>
  );
};
```

- [ ] **Step 5: Run the focused renderer tests and confirm GREEN.**

Run: `npm test -- --run src/remotion/components/SubtitleReactions.test.jsx src/remotion/compositions/Subtitles.test.jsx`.

Expected: PASS, including legacy subtitle rendering tests.

- [ ] **Step 6: Commit the render boundary after GitNexus review.** Run `npm run format`, `npm run format:check`, `npm run lint`, `mcp__gitnexus__detect_changes({repo:"nier-platform",scope:"all"})`, and commit:

```text
feat: render subtitle reaction overlays
```

### Task 6: Build and test the review panel

**Files:**
- Create: `dashboard/src/components/local-editor/SubtitleReactionReviewPanel.test.jsx`
- Create: `dashboard/src/components/local-editor/SubtitleReactionReviewPanel.jsx`

- [ ] **Step 1: Write failing review-panel tests.** Assert that the panel renders cue text and emoji suggestions, editing calls `onChange`, removing disables/removes a row, shared position/animation/size controls call `onStyleChange`, Retry calls `onRetry`, and Apply calls `onApply` with only enabled suggestions.

```jsx
it("applies only enabled edited reactions", () => {
  const onApply = vi.fn();
  render(
    <SubtitleReactionReviewPanel
      suggestions={[{ id: "r0", cueIndex: 0, text: "Close", startMs: 0, endMs: 900, emojis: ["😱"], enabled: true }]}
      style={{ position: "above", animation: "pop", scale: 1 }}
      onApply={onApply}
      onChange={vi.fn()}
      onStyleChange={vi.fn()}
      onRetry={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /apply/i }));
  expect(onApply).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ emojis: ["😱"] })]), expect.any(Object));
});
```

- [ ] **Step 2: Run the focused panel tests and confirm RED.**

Run: `npm test -- --run src/components/local-editor/SubtitleReactionReviewPanel.test.jsx`.

Expected: FAIL because the panel does not exist.

- [ ] **Step 3: Implement the controlled panel.** Render a scrollable cue list with editable emoji text, remove/enable controls, shared style selects/range, loading/empty/error slots, Retry, Close, and Apply. Keep all state controlled by `LocalEditorTab`; the panel must not mutate editor history directly.

```jsx
// Define ReactionReviewRow and ReactionStyleControls in this file beside the panel.
export default function SubtitleReactionReviewPanel({ suggestions, style, onChange, onStyleChange, onRetry, onClose, onApply }) {
  const enabled = suggestions.filter((suggestion) => suggestion.enabled);
  return (
    <div role="dialog" aria-label="Review reactions" className="space-y-3">
      <div className="max-h-[48vh] space-y-2 overflow-y-auto">
        {suggestions.map((suggestion) => (
          <ReactionReviewRow key={suggestion.id} suggestion={suggestion} onChange={onChange} />
        ))}
      </div>
      <ReactionStyleControls value={style} onChange={onStyleChange} />
      <div className="flex gap-2">
        <button type="button" onClick={onRetry}>Retry</button>
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" onClick={() => onApply(enabled, style)} disabled={!enabled.length}>Apply reactions</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the focused panel tests and confirm GREEN.**

Run: `npm test -- --run src/components/local-editor/SubtitleReactionReviewPanel.test.jsx`.

Expected: PASS.

- [ ] **Step 5: Commit the panel after frontend checks and GitNexus review.** Run `npm run format`, `npm run format:check`, `npm run lint`, `mcp__gitnexus__detect_changes({repo:"nier-platform",scope:"all"})`, and commit:

```text
feat: add subtitle reaction review panel
```

### Task 7: Integrate generation, review, apply, and undo in the local editor

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`

- [ ] **Step 1: Run GitNexus upstream impact analysis for `LocalEditorTab` and `commitEdit`.** Review the editor history, persistence callback, preview props, and subtitle control callers before editing.

- [ ] **Step 2: Write failing integration tests.** Add coverage that clicking `Suggest reactions` posts the active cues with `getLocalAiHeaders()`, opens the review panel, preserves current reactions until Apply, edits/removes suggestions, applies one `subtitleReactions` state update, and Undo restores the prior state. Add tests for disabled-without-cues, loading, provider error, malformed response, and retry.

```jsx
it("applies the reviewed full-clip reaction batch as one undoable edit", async () => {
  const cue = { id: "cue-0", text: "That was close", startMs: 0, endMs: 900 };
  const onStateChange = vi.fn();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ reactions: [{ cueIndex: 0, emojis: ["😱"] }] }),
  });
  render(
    <LocalEditorTab
      initialEditorState={{ subtitleCues: [cue], subtitleReactions: [] }}
      onStateChange={onStateChange}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /suggest reactions/i }));
  expect(await screen.findByRole("dialog", { name: /review reactions/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /apply/i }));
  fireEvent.click(screen.getByRole("button", { name: /undo/i }));

  expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ subtitleReactions: [] }));
});
```

- [ ] **Step 3: Run the focused integration tests and confirm RED.**

Run: `npm test -- --run src/components/local-editor/LocalEditorTab.test.jsx`.

Expected: FAIL because the action, panel, and reaction state do not exist.

- [ ] **Step 4: Implement the local editor flow.** Add an `activeSubtitleTrackId` prop to `LocalEditorTab` with a default of `"original"`, pass the `FullScreenEditor` active track ID through it, and add `generatingReactions`, `reactionReview`, and `reactionError` state. Post `{ track_id: activeSubtitleTrackId, cues: reactionRequestCues(subtitleCues) }` to `/api/local-editor/subtitle-reactions` with `getLocalAiHeaders()`; map the response to pending rows with cue text/timings; preserve existing applied reactions until Apply; commit `{ ...present, subtitleReactions: normalizeSubtitleReactions(approved), subtitleReactionStyle: normalizeSubtitleReactionStyle(style) }` through `commitEdit`; and pass reaction props into `RemotionPreview` via the current state-to-render-props path.

```js
const suggestReactions = async () => {
  setGeneratingReactions(true);
  setReactionError("");
  try {
    const response = await fetch(getApiUrl("/api/local-editor/subtitle-reactions"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getLocalAiHeaders() },
      body: JSON.stringify({ track_id: activeSubtitleTrackId, cues: reactionRequestCues(subtitleCues) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || "Could not suggest subtitle reactions.");
    setReactionReview(makePendingReactionReview(payload.reactions, subtitleCues));
  } catch (error) {
    setReactionError(error.message || "Could not suggest subtitle reactions.");
  } finally {
    setGeneratingReactions(false);
  }
};

const applyReactionReview = (approved, style) => {
  commitEdit((present) => ({
    ...present,
    subtitleReactions: normalizeSubtitleReactions(approved),
    subtitleReactionStyle: normalizeSubtitleReactionStyle(style),
  }));
  setReactionReview(null);
};
```

- [ ] **Step 5: Run the focused integration tests and confirm GREEN.**

Run: `npm test -- --run src/components/local-editor/LocalEditorTab.test.jsx`.

Expected: PASS, including existing subtitle generation, import, translation, history, and preview tests.

- [ ] **Step 6: Commit the editor integration after frontend checks and GitNexus review.** Run `npm run format`, `npm run format:check`, `npm run lint`, `mcp__gitnexus__detect_changes({repo:"nier-platform",scope:"all"})`, and commit:

```text
feat: integrate AI subtitle reaction review flow
```

### Task 8: Run the complete verification suite and hand off

**Files:**
- No new files; verify the implementation files from Tasks 1–7.

- [ ] **Step 1: Run all focused frontend tests.**

Run from `dashboard`:

```text
npm test -- --run src/components/local-editor/subtitleReactions.test.js src/components/local-editor/SubtitleReactionReviewPanel.test.jsx src/components/local-editor/LocalEditorTab.test.jsx src/components/editor/FullScreenEditor.test.jsx src/editor/designcomboAdapter.test.js src/remotion/components/SubtitleReactions.test.jsx src/remotion/compositions/Subtitles.test.jsx
```

Expected: PASS with zero failed tests.

- [ ] **Step 2: Run backend and worker tests.**

Run:

```text
go test ./...                       # from backend-go
python -m pytest tests/test_python_worker.py -q
```

Expected: PASS with zero failed tests.

- [ ] **Step 3: Run required frontend checks.**

Run from `dashboard`:

```text
npm run format
npm run format:check
npm run lint
npm run build
```

Expected: each command exits 0 with no lint errors or formatting differences.

- [ ] **Step 4: Review the final diff and GitNexus scope.** Confirm the unrelated pre-existing editor changes remain unstaged, run `git diff --check`, and run `mcp__gitnexus__detect_changes({repo:"nier-platform",scope:"all"})`. Review all affected processes and confirm they are limited to subtitle editing, manifest persistence, AI generation, and subtitle rendering.

- [ ] **Step 5: Commit the verified implementation.** Stage only the feature files, create the final conventional commit, and report the commit plus test commands/results. If the user later asks to apply the change to the running local app, follow the repository restart workflow with the matching frontend/backend/renderer components.
