# Inspector UX refinement

## Goal

Make subtitle editing and whole-track translation easier to understand and use in the editor inspector without changing subtitle, translation, or render behavior.

## Design

- Present **Add subtitle cue** as a compact primary action with a cue icon and helper text explaining that the cue starts at the current playhead.
- Replace the oversized unselected-item panel with a compact “Nothing selected” state that explains how to select a timeline item.
- Group translation controls into a clear flow: source track context, selectable target language, and a full-width “Translate entire track” action.
- Keep original/translated track pills, but make the active track visually explicit and preserve the existing track-selection callbacks.
- Keep the inspector scrollable and avoid introducing nested scrolling or overflow bars.

## Behavior and accessibility

- Existing custom events and callbacks remain unchanged.
- Buttons retain disabled states and accessible labels.
- The translation action remains disabled when there is no source track, no cues, no version, or the target equals the source.
- Add focused component tests for the new labels, helper copy, and empty state.

## Scope

This is a presentation-only change to `InspectorPanel` and `SubtitleTranslationPanel`. No API, manifest, timing, or rendering behavior changes.
