# Automatic Subtitle Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add text-only automatic subtitle translation that creates selectable language tracks while preserving original subtitle text, timing, and audio.

**Architecture:** Translation is a backend operation over subtitle cue text, not over video media. The backend uses the configured AI text provider, maps translated cues onto source cue intervals, and stores the resulting track in a version draft. The versioned render plan owns persistence; this plan supplies translation behavior and UI.

**Tech Stack:** Python, FastAPI, existing AI provider configuration, Pydantic, React, Vitest, pytest.

**Dependency:** Complete `2026-07-26-immutable-clip-versions.md` Tasks 1–4 first so translated tracks can be stored in a draft/version manifest.

---

### Task 1: Define subtitle-track and translation types

**Files:**
- Modify: `remotion/src/lib/types.ts`
- Modify: `dashboard/src/remotion/lib/types.ts`
- Create: `tests/test_subtitle_tracks.py`
- Create: `dashboard/src/remotion/lib/subtitleTracks.test.js`

- [ ] **Step 1: Write failing type/behavior tests**

Test that a manifest can hold `original`, `es`, and `fr` tracks, each track has a stable ID and language, and `activeSubtitleTrackId` references an existing track.

```javascript
it('keeps original and translated tracks independently selectable', () => {
  const tracks = makeSubtitleTracks(originalCaptions, translatedCaptions, 'es');
  expect(tracks.map((track) => track.language)).toEqual(['en', 'es']);
  expect(selectSubtitleTrack(tracks, 'en').id).toBe('original');
  expect(selectSubtitleTrack(tracks, 'es').id).toBe('es');
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `python -m pytest tests/test_subtitle_tracks.py -q` and `npm test -- --run src/remotion/lib/subtitleTracks.test.js` in `dashboard`.  
Expected: FAIL because the track helpers/types do not exist.

- [ ] **Step 3: Implement shared track shape and pure helpers**

Add:

```ts
type SubtitleTrack = {
  id: string;
  language: string;
  label: string;
  sourceTrackId?: string;
  origin: 'original' | 'translation' | 'manual';
  captions: CaptionWord[];
};
```

Implement `selectSubtitleTrack(tracks, id)` and reject missing active IDs. Keep the dashboard and renderer type definitions structurally identical.

- [ ] **Step 4: Run focused tests**

Run the same Python and dashboard commands.  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add remotion/src/lib/types.ts dashboard/src/remotion/lib/types.ts tests/test_subtitle_tracks.py dashboard/src/remotion/lib/subtitleTracks.test.js
git commit -m "feat: define selectable subtitle tracks"
```

### Task 2: Implement cue timing and translation mapping

**Files:**
- Create: `subtitle_translation.py`
- Create: `tests/test_subtitle_translation.py`

- [ ] **Step 1: Write failing translation-mapping tests**

Cover equal and unequal word counts, punctuation, empty cues, and source intervals:

```python
def test_translated_words_share_original_cue_interval():
    source = [cue("This is", 0, 1000)]
    result = map_translation_to_cues(source, ["Esto es"], language="es")
    assert [(w["startMs"], w["endMs"]) for w in result[0]["captions"]] == [(0, 500), (500, 1000)]
```

Assert that translating does not change source cue start/end and that the original track object is not mutated.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `python -m pytest tests/test_subtitle_translation.py -q`  
Expected: FAIL because `subtitle_translation` does not exist.

- [ ] **Step 3: Implement pure translation mapping**

Implement `map_translation_to_cues(source_cues, translated_texts, language)` to split each translated cue into words and distribute each word over the original cue interval using integer millisecond boundaries. Preserve empty/source-untranslated cues with an explicit error result rather than silently dropping them.

- [ ] **Step 4: Add provider adapter test doubles**

Implement `translate_cue_texts(cues, source_language, target_language, translate_text)` so the provider callable is injected. Test batching, deterministic cue ordering, and provider exceptions.

- [ ] **Step 5: Run translation tests**

Run: `python -m pytest tests/test_subtitle_translation.py -q`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add subtitle_translation.py tests/test_subtitle_translation.py
git commit -m "feat: map translated subtitle cues to source timing"
```

### Task 3: Add backend translation endpoint

**Files:**
- Modify: `app.py`
- Create: `tests/test_subtitle_translation_api.py`

- [ ] **Step 1: Write failing API tests**

Test:

```python
def test_translate_subtitles_adds_track_without_mutating_original(client, version_fixture): ...
def test_translate_subtitles_requires_target_language(client, version_fixture): ...
def test_translation_failure_leaves_current_version_unchanged(client, version_fixture): ...
```

Assert that the response contains `track_id`, `language`, `captions`, and a draft version ID, while the original track checksum/content is unchanged.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `python -m pytest tests/test_subtitle_translation_api.py -q`  
Expected: FAIL because the endpoint does not exist.

- [ ] **Step 3: Implement the endpoint**

Add `POST /api/clip/{job_id}/{clip_index}/versions/{version_id}/subtitle-tracks/translate` with `{target_language, source_track_id}`. Load the requested version, call the configured text provider using the existing AI configuration helpers, create a new track ID such as `translation-es-<short uuid>`, and return a draft manifest without activating or rendering it.

Reject duplicate target tracks unless the request explicitly asks to replace a draft track. Return 400 for unsupported language codes and 502 with cue-level errors for provider failures.

- [ ] **Step 4: Run API tests**

Run: `python -m pytest tests/test_subtitle_translation_api.py -q`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_subtitle_translation_api.py
git commit -m "feat: add automatic subtitle translation API"
```

### Task 4: Build translation track UI

**Files:**
- Create: `dashboard/src/components/SubtitleTrackPicker.jsx`
- Create: `dashboard/src/components/SubtitleTranslationPanel.jsx`
- Create: `dashboard/src/components/SubtitleTranslationPanel.test.jsx`
- Modify: `dashboard/src/components/TranslateModal.jsx`

- [ ] **Step 1: Write failing component tests**

Test that the panel lists Original and translated tracks, calls translation with the selected target language, reports progress/errors, and does not remove Original when a translation succeeds.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/components/SubtitleTranslationPanel.test.jsx` in `dashboard`.  
Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the panel and picker**

Use the existing language list from `TranslateModal.jsx`, but label the action `Translate subtitles` and clarify that audio is unchanged. Keep the original track visible and selectable. Return the new track/draft manifest to the editor.

- [ ] **Step 4: Run dashboard tests**

Run: `npm test -- --run src/components/SubtitleTranslationPanel.test.jsx`; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/SubtitleTrackPicker.jsx dashboard/src/components/SubtitleTranslationPanel.jsx dashboard/src/components/SubtitleTranslationPanel.test.jsx dashboard/src/components/TranslateModal.jsx
git commit -m "feat: add selectable subtitle translation tracks"
```

### Task 5: Verify translation through rendering

**Files:**
- Modify: `render-service/src/composition.test.ts`
- Create: `tests/test_translated_subtitle_render.py`

- [ ] **Step 1: Add render contract tests**

Assert that the renderer receives `activeSubtitleTrackId`, renders only the selected track, and keeps the original track in the manifest for future selection.

- [ ] **Step 2: Run tests and fix integration gaps**

Run: `npm test` in `render-service` and `python -m pytest tests/test_translated_subtitle_render.py -q`.  
Expected: PASS with no mutation of source/original track data.

- [ ] **Step 3: Commit**

```bash
git add render-service/src/composition.test.ts tests/test_translated_subtitle_render.py
git commit -m "test: verify translated subtitle track rendering"
```
