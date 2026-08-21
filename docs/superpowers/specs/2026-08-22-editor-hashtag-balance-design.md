# Editor Hashtag Balance Design

Date: 2026-08-22

## Problem

The local editor currently asks the AI for a flat list of 8–12 relevant hashtags. The prompt does not explicitly balance hashtags between the clip’s exact subject, its broader niche, and general Shorts discovery, so results can over-index on generic or overly specific terms.

## Goal

Improve the AI-generated hashtag mix while preserving the existing flat hashtag response, editor UI, persistence behavior, normalization, and error handling.

## Design

Update the prompt used by `POST /api/local-editor/hashtags` in `app.py` to request 9–12 hashtags in this order:

1. 3–4 post-specific hashtags describing the actual clip.
2. 3–4 niche-specific hashtags identifying the broader topic or channel category.
3. 3–4 broad hashtags supporting Shorts discovery.

The prompt will continue to require the source language, grounded use of title/caption/subtitle/source context, no invented identities or events, no duplicates, no explanations, and the existing JSON shape:

```json
{"hashtags": ["#tag1", "#tag2"]}
```

The backend will continue to normalize, deduplicate, and cap the returned list at 12 tags. The ordered flat list is sufficient for the model to follow the requested balance without adding a client-facing category schema.

## Scope

In scope:

- The local editor hashtag-generation prompt.
- Focused backend coverage proving the category and count instructions are present.

Out of scope:

- Changes to the API response shape.
- Category labels or separate sections in the UI.
- Hashtag editing controls.
- Changes to other hashtag-generation flows.
- Changes to persistence, normalization, or provider configuration.

## Error handling

Existing behavior remains unchanged. Empty clip context returns HTTP 400, provider or malformed-response failures return HTTP 502, and an empty normalized result is treated as generation failure. Existing source-grounding safeguards remain in the prompt.

## Testing

- Add or extend an API test that captures the AI prompt and asserts the post-specific, niche-specific, and broad categories, the 3–4 count guidance, ordered output, and flat JSON contract.
- Preserve and run the existing normalization, validation, and provider-failure tests.
- Run the focused hashtag API tests and then the full Python test suite.
- Run GitNexus impact analysis before changing the generator and `detect_changes()` before committing implementation changes.

## Risk and rollout

This is a low-risk prompt-only change. The endpoint contract and all downstream consumers remain stable. If a provider ignores the requested balance, the existing normalization path still returns a valid flat list, subject to the current 12-tag cap.
