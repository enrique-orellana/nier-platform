# Local Editor CapCut-Style Layout

## Goal

Recompose the local editor into a CapCut-inspired desktop editing workbench while preserving the existing OpenShorts feature set and behavior. The new layout should make the video player and subtitle workspace persistent, while making the editor's feature groups discoverable through an interactive left rail.

## Scope

### In scope

- Reflow the local editor into a persistent top bar, feature navigation/workspace, player, context panel, and full-width subtitle workspace.
- Add an interactive left feature rail with four views:
  - Details
  - Subtitles
  - Viral Hook
  - Project
- Move the existing clip metadata, subtitle controls, viral hook controls, project action toolbar, and version history into those views without changing their behavior.
- Keep the center player mounted while switching rail views.
- Keep the subtitle workspace mounted below the editor shell, including Timeline/Cue table switching, Hook/Subtitles/Audio tracks, seeking, cue selection, dragging, and double-click editing.
- Preserve the existing header controls, exports, save/project behavior, fullscreen behavior, errors, notices, and parent-provided `sidePanel` contract.
- Provide a compact responsive rail on smaller screens.

### Out of scope

- Adding an asset-import/media-library workflow.
- Adding new editing capabilities or changing export/render behavior.
- Introducing a standalone Audio feature panel. Audio remains represented by the existing waveform timeline track.
- Reworking the subtitle or hook data models.
- Changing `FullScreenEditor` or `App` public behavior beyond consuming the unchanged `LocalEditorTab` contract.

## User experience

### Desktop shell

The editor uses a dark, CapCut-inspired workbench:

1. A persistent top bar contains the editor title/source context, Projects, export controls, Reset, Close, and any parent-provided header actions.
2. The main workspace is split into:
   - A narrow interactive feature rail.
   - A scrollable feature panel for the selected rail item.
   - A large central player with existing playback, fullscreen, fit, loop, and keyboard controls.
   - A compact right context area for the supplied project actions/version content where applicable.
3. The subtitle workspace spans the full width below the main workspace.

The feature panel defaults to Details. Switching rail items changes only the feature panel; the player, playhead, cue selection, timeline zoom, and timeline view remain mounted and retain state.

### Rail views

#### Details

Displays the existing `ClipMetadataPanel`, including clip title, duration/tags, hashtags, YouTube title, and caption metadata.

#### Subtitles

Displays the existing subtitle controls: add cue, import subtitles, generate subtitles, clean subtitle dots, translation controls, subtitle style controls, and remove-subtitles behavior. Existing disabled/loading states remain intact.

#### Viral Hook

Displays the existing add/reset hook controls and `HookInspector`. Selecting or double-clicking a hook cue continues to update the same editor state and player preview.

#### Project

Displays the parent-provided `sidePanel` content, including `EditorActionToolbar` and `VersionHistory` in `FullScreenEditor`. In the standalone local editor, the view remains available and shows whatever project-side content is supplied.

### Persistent timeline behavior

The bottom workspace remains visible for all rail views. It continues to support:

- Timeline/Cue table tab switching.
- Subtitle cue selection and double-click editing.
- Hook cue selection and editing.
- Horizontal timeline scrolling and zoom.
- Playhead seeking and automatic playhead visibility.
- Audio waveform rendering.

## Component design

### `LocalEditorFeatureRail`

Presentational component responsible for rendering the four feature buttons. It receives the active feature and an `onSelect` callback. Each button uses a native button element, visible label, tooltip/title, and `aria-current` or equivalent active-state semantics.

### `LocalEditorFeaturePanel`

Presentational layout component responsible for consistent panel sizing, scrolling, heading treatment, and active feature content. It receives the active feature and rendered content from `LocalEditorTab`.

### `LocalEditorTab`

Remains the owner of all editor state and handlers. It adds a local `activeFeature` state defaulting to `details`, renders the feature rail/panel shell, and keeps the player and subtitle workspace outside the feature panel's conditional content. Existing prop names and parent contracts remain unchanged.

## State and data flow

- `activeFeature` is view state only and is not written into the editor history or serialized project state.
- Existing editor state (`editHistory.present`), selection state, playback state, subtitle state, hook state, project state, busy state, and notices remain unchanged.
- Rail selection does not call persistence handlers or create undo entries.
- Existing feature handlers continue to be passed directly to their current controls.
- Parent-provided `sidePanel` is rendered only by the Project view, without cloning or modifying its elements.
- Existing modal layers (save project and subtitle cue editing) remain outside the feature panel so they are not clipped by panel scrolling.

## Accessibility and responsive behavior

- Rail controls are keyboard-focusable buttons with accessible names.
- The active rail button exposes its selected state.
- The selected feature content has a labelled region.
- Existing control labels, keyboard shortcuts, and dialog semantics remain unchanged.
- At smaller widths, the rail becomes a compact horizontal row while the feature panel remains scrollable and the player keeps its existing aspect ratio.

## Testing strategy

Add tests before implementation for:

1. The rail renders all four feature buttons and defaults to Details.
2. Clicking each rail button changes the selected feature panel.
3. The active feature exposes an accessible selected/current state.
4. Switching feature views does not unmount the player or subtitle workspace.
5. The Project view renders supplied `sidePanel` content.
6. Existing `LocalEditorTab` tests continue to cover playback, timeline, subtitle, hook, persistence, export, and keyboard behavior.

Run the dashboard formatting, formatting check, lint, focused tests, and full test suite after implementation.

## Acceptance criteria

- The local editor visually follows the approved CapCut-inspired shell.
- No media-library or asset-import panel is added.
- The left feature rail is interactive and switches between Details, Subtitles, Viral Hook, and Project.
- Player and subtitle workspace remain persistent during rail switching.
- Existing functionality and parent integrations remain intact.
- Dashboard formatting, lint, focused tests, and the full test suite pass.

## Risk and mitigation

GitNexus identified `LocalEditorTab` as a HIGH-risk UI hub with two direct callers (`App` and `FullScreenEditor`), three affected processes, and six impacted symbols across three modules. The implementation limits changes to the local editor shell, preserves the component's public props, keeps state ownership in `LocalEditorTab`, adds focused interaction tests, and verifies the direct callers and full dashboard checks before completion.
