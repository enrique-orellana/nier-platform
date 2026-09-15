# Viral Hook Box Style Design

## Overview

Add an optional visual treatment for viral-hook backgrounds that matches the reference “headline card” look while keeping every existing hook setting independently configurable.

The current rounded hook remains the default and remains fully compatible with existing saved hooks. The new option changes only the background-box treatment.

## User experience

The Viral Hook inspector will expose a `Box style` choice:

- `Rounded`: the existing rounded rectangle, shadow, and single-box behavior.
- `Headline cards`: rectangular cards with tighter padding and no rounded corners. Each explicit line break in the hook text renders as a separate card.

Selecting a box style changes only that setting. It must not overwrite or reset:

- hook text or its letter casing;
- font family, font size, or text color;
- background color;
- position and custom coordinates;
- timing;
- entrance animation; or
- Streamer Stack layout settings.

The user can reproduce the supplied reference look by choosing Headline cards and independently selecting a dark text color, white background, and preferred font.

The editor should provide a short hint that line breaks create separate cards. Empty lines should not create empty cards.

## Data contract

Add an optional hook field, named `boxStyle`, with values `rounded` and `headline_cards`.

When absent, consumers must treat the value as `rounded`. This preserves the appearance of existing hooks and makes older persisted/render payloads safe.

The field must be represented consistently in both Remotion hook types and schemas used by the dashboard preview and the standalone/render-service composition.

## Rendering contract

The shared hook visual helpers remain the source of truth for box treatment. Both Remotion composition copies, the local editor preview fallback, and browser canvas export must use the same box-style semantics.

For `rounded`, retain the existing output exactly.

For `headline_cards`:

- retain the configured text color, background color, font family, font size, size scale, and text alignment;
- use rectangular corners and tighter vertical/horizontal padding;
- render each non-empty explicit line as a separate card with a small vertical gap;
- preserve whitespace within each line and preserve emoji characters;
- retain the configured animation as one grouped hook overlay, so the cards animate together;
- retain the existing position anchor as the group anchor; and
- retain Streamer Stack positioning behavior.

The canvas export path must draw the same separate cards and must not fall back to a single rounded box for the new setting.

## Compatibility and failure behavior

- Unknown or missing `boxStyle` values fall back to `rounded`.
- Existing hooks with custom colors, fonts, sizes, positions, timings, and animations remain unchanged.
- A hook containing only whitespace must not crash rendering; it should render no cards, matching current empty-text tolerance.
- Existing line-break behavior for rounded hooks remains unchanged.

## Verification

Add or update tests for:

- defaulting/mapping missing and unknown box styles to rounded;
- headline card style properties in the shared visual helper;
- separate non-empty line rendering in both Remotion composition copies;
- inspector selection without mutating unrelated hook fields;
- render-prop preservation of `boxStyle`;
- browser canvas export drawing one card per explicit line; and
- regression coverage proving the existing rounded appearance remains unchanged.

Manual verification will use the running local app in Brave: select Headline cards, confirm multiple manually line-broken cards in the preview, change font/color/size/position/animation, and export or render a short sample to confirm the same treatment survives the output path.
