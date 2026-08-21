# Editor Hashtag Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update local editor AI hashtag generation so its existing flat list balances post-specific, niche-specific, and broad hashtags.

**Architecture:** Keep the existing `POST /api/local-editor/hashtags` request and response contracts unchanged. Strengthen only the prompt assembled by `generate_local_editor_hashtags` so the model returns 9–12 hashtags in three ordered groups of 3–4, while the existing normalization and downstream UI/persistence continue to operate unchanged.

**Tech Stack:** FastAPI/Pydantic, Python, pytest, the existing provider-agnostic `chat_json` helper, and GitNexus code intelligence.

---

## File map

- Modify `tests/test_local_editor_hashtags_api.py`: add a red API test that captures the generated prompt and asserts the category/count/order contract.
- Modify `app.py:1930-1950` in `generate_local_editor_hashtags`: replace only the prompt text; keep request validation, provider configuration, `chat_json` invocation, normalization, and error handling unchanged.
- Create `docs/superpowers/plans/2026-08-22-editor-hashtag-balance.md`: this implementation plan.

## Task 1: Add the failing prompt-contract test

**Files:**

- Modify: `tests/test_local_editor_hashtags_api.py`

- [ ] **Step 1: Add one focused test below the existing generation test.**

Add this test to capture the prompt sent to `chat_json` while using the existing endpoint and provider headers:

```python
def test_prompt_requests_balanced_hashtag_groups(monkeypatch):
    seen = {}

    def fake_chat_json(config, prompt, **kwargs):
        seen["prompt"] = prompt
        return {"hashtags": ["#specific", "#niche", "#shorts"]}

    monkeypatch.setattr(app_module, "chat_json", fake_chat_json)
    response = TestClient(app_module.app).post(
        "/api/local-editor/hashtags",
        headers={"X-AI-Provider": "lmstudio", "X-AI-Base-Url": "http://lmstudio.test"},
        json={
            "title": "Unexpected training result",
            "caption": "A quick strength-training tip",
            "subtitle_text": "Keep your back straight during the deadlift",
        },
    )

    assert response.status_code == 200
    prompt = seen["prompt"].lower()
    assert "post-specific" in prompt
    assert "niche-specific" in prompt
    assert "broad" in prompt
    assert "3 to 4" in prompt
    assert "in that order" in prompt
    assert '{"hashtags": ["#tag1", "#tag2"]}' in seen["prompt"]
```

- [ ] **Step 2: Run the focused test and verify it fails for the missing prompt guidance.**

Run:

```powershell
pytest tests/test_local_editor_hashtags_api.py::test_prompt_requests_balanced_hashtag_groups -q
```

Expected result: FAIL because the current prompt does not contain the `post-specific`, `niche-specific`, `broad`, `3 to 4`, or `in that order` instructions. The failure must be an assertion failure, not a collection or fixture error.

## Task 2: Update the AI prompt after impact analysis

**Files:**

- Modify: `app.py:1930-1950`

- [ ] **Step 1: Run GitNexus upstream impact analysis before editing the production symbol.**

Call the GitNexus impact tool with:

```json
{
  "repo": "openshorts",
  "target": "generate_local_editor_hashtags",
  "direction": "upstream",
  "maxDepth": 3,
  "minConfidence": 0.8
}
```

Review direct callers and affected processes. The expected change is low risk because this is one local-editor endpoint and the response contract remains unchanged. If GitNexus reports HIGH or CRITICAL risk, stop and report that warning before editing.

- [ ] **Step 2: Replace only the current prompt string.**

Keep the existing `title`, `caption`, `subtitle_text`, and `source_context` interpolations. Replace the opening instructions with the following exact guidance:

```python
    prompt = f"""Generate 9 to 12 highly relevant social-media hashtags for this short video.
Build the returned flat array from these three groups, in this exact order:
1. POST-SPECIFIC HASHTAGS: 3 to 4 tags that describe exactly what happens in this clip, using concrete subjects, actions, items, or events from the provided context.
2. NICHE-SPECIFIC HASHTAGS: 3 to 4 tags for the broader topic, audience, industry, or channel niche.
3. BROAD HASHTAGS: 3 to 4 general discovery tags that help identify this as a Short or reach relevant trending and For You feeds, such as #shorts, #viral, #trending, or #foryoupage when appropriate.
Return the groups as one flat array in that order. Use the same language as the source content for descriptive tags. Do not return group labels, explanations, prose, or duplicates.
Return JSON only with this exact shape: {{"hashtags": ["#tag1", "#tag2"]}}.

TITLE:
{title}

CAPTION:
{caption}

CURRENT EDITED SUBTITLE TRANSCRIPT:
{subtitle_text}

ORIGINAL SOURCE CONTEXT (grounded facts only; may be unavailable):
{json.dumps(source_context, ensure_ascii=False) if source_context else "No original source context was provided."}
Use source facts for relevant hashtags only. Do not invent identities, locations, dates, events, or entities.
"""
```

Do not change `normalize_generated_hashtags`, the `chat_json` arguments, the 12-tag cap, or the HTTP error paths.

- [ ] **Step 3: Run the focused API tests and verify they pass.**

Run:

```powershell
pytest tests/test_local_editor_hashtags_api.py -q
```

Expected result: all tests in the file PASS, including normalization/deduplication, empty-context validation, provider failure, and the new prompt-contract test.

## Task 3: Full verification and implementation handoff

**Files:**

- Verify: `app.py`
- Verify: `tests/test_local_editor_hashtags_api.py`

- [ ] **Step 1: Run the full Python test suite.**

Run:

```powershell
pytest -q
```

Expected result: all Python tests PASS. Existing unrelated warnings may be reported, but no test failures or collection errors are acceptable.

- [ ] **Step 2: Check formatting and the intended diff.**

Run:

```powershell
git diff --check
git diff -- app.py tests/test_local_editor_hashtags_api.py
git status --short
```

Confirm the implementation diff changes only the hashtag prompt and its focused test. Do not stage or modify unrelated existing worktree files.

- [ ] **Step 3: Run GitNexus change detection before committing.**

Call:

```json
{
  "repo": "openshorts",
  "scope": "unstaged"
}
```

Confirm the affected symbols and execution flows are limited to the local editor hashtag generation path. If unexpected symbols or high-risk flows appear, investigate before committing.

- [ ] **Step 4: Commit only the implementation files.**

Run:

```powershell
git add -- app.py tests/test_local_editor_hashtags_api.py
git commit -m "feat: balance editor hashtag generation"
```

The design spec commit already exists separately; this commit must not include it or unrelated worktree changes.

## Self-review checklist

- Spec coverage: the plan preserves the flat response, specifies 3–4 hashtags in each category, keeps grounding and error handling, and covers focused plus full-suite testing.
- Implementation details are concrete, complete, and executable.
- Type and contract consistency: the test and prompt both use `{"hashtags": [...]}`; all endpoint request fields and existing backend helper calls remain unchanged.
