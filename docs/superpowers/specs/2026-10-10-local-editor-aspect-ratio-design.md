# Local Editor Aspect Ratio Selection

## Summary

Show the loaded clip's source aspect ratio in the local editor and let the user choose the output aspect ratio before export. The selected ratio controls both the editor preview frame and the exported video.

## User experience

- Turn the existing `9:16` player badge into an aspect-ratio menu.
- Offer `9:16`, `16:9`, `1:1`, `4:5`, and `Original`.
- Keep `9:16` as the default for existing and new editor projects.
- Show the source video's measured aspect ratio in the Details panel, separately from the selected output ratio.
- Update the preview frame as soon as the user selects a ratio. Keep the current Fit/Fill setting in charge of whether the video is contained with empty space or cropped to fill the frame.
- Use the same selected ratio for export. `Original` uses the loaded source dimensions and ratio.
- Save the selected ratio with the local editor project and history so it remains selected when the project is reopened and participates in undo/redo.

## Output dimensions

Use standard output dimensions for the four presets:

| Ratio | Output dimensions |
| --- | --- |
| 9:16 | 1080 × 1920 |
| 16:9 | 1920 × 1080 |
| 1:1 | 1080 × 1080 |
| 4:5 | 1080 × 1350 |

`Original` uses the source width and height rounded down to even integers, with a minimum of two pixels per side. When source metadata is unavailable, use the existing preview or clip dimensions; if those are also unavailable, use 1080 × 1920.

## Preview and placement behavior

- The player frame and Remotion composition use the dimensions for the active ratio, so the preview matches the export canvas.
- Native video continues to use the existing Fit/Fill behavior inside the selected frame.
- Subtitle and hook positions retain their relative location within the canvas when the aspect ratio changes. Coordinate fields continue to show pixels for the active output dimensions.
- Existing projects without a saved ratio normalize to `9:16`; existing subtitle styles and layout data remain valid.

## Data flow and boundaries

- Store the selected ratio as a normalized field in the local editor's existing history snapshot and project persistence format; no API route or database migration is needed.
- Derive the source ratio from loaded video dimensions, falling back to the Remotion preview dimensions and clip metadata.
- Use one ratio-to-dimensions resolver for the player preview and export request so both paths agree.
- Pass the active dimensions to the existing backend render request. Keep the current subtitle, hook, timing, layout, and video-fit behavior otherwise unchanged.

## Validation

- Manually verify the source ratio display and all five menu choices in the local editor.
- Confirm preview frame shape and displayed subtitle/hook placement update with each choice.
- Confirm the export request uses the selected dimensions, and `Original` uses the loaded source dimensions.
- Run the dashboard formatter, formatter check, linter, and the repository-required local app restart and status check.

## Out of scope

- Arbitrary custom width and height inputs.
- Changing source media or the clip's trim range.
- Separate aspect ratios per timeline segment.
- Adding new crop or fit modes.
