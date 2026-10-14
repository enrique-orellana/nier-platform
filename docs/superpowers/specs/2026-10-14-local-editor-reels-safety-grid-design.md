# Local Editor Reels Safety Grid

## Summary

Add a toggle in the local editor's Reels player controls to show the supplied Instagram safety-grid guide over the preview. The guide helps position content within the Reels safe areas without changing the source video or rendered export.

## User experience

- Add a compact, labeled `Grid` toggle to the local editor's playback toolbar, beside the existing fit and fullscreen controls.
- Start with the grid off whenever the editor is opened. Keep the setting in component state only; do not persist it with projects or across sessions.
- Show the grid only when the output preview frame is 9:16. This includes an `Original` output if its resolved dimensions are 9:16.
- When enabled, align the guide to the full preview frame. Keep it visible in fullscreen because fullscreen uses the same player stage.
- Expose the toggle state accessibly (for example, with `aria-pressed`) and make the overlay ignore pointer events so it cannot interfere with player interactions.

## Rendering and boundaries

- Reuse `dashboard/public/ig-safety-grid.png` at the dashboard public URL `/ig-safety-grid.png`; do not redraw, resize, or modify the supplied asset.
- Render the image as a UI overlay above the player preview frame and below the player controls. It must remain outside the Remotion composition and export/render request, so it is never baked into video output.
- Keep this behavior scoped to `LocalEditorTab`. Do not add the grid to shared `RemotionPreview` consumers such as the clip editor or subtitle modals.
- Do not change preview fitting, aspect-ratio selection, subtitles, hooks, playback, project persistence, or export behavior.

## Alternatives considered

- Put the toggle inside the preview frame: easy to discover, but it obscures the video and competes with the content being evaluated.
- Recreate the guide using CSS or SVG: avoids loading an image, but diverges from the supplied reference asset and can make its zones harder to match exactly.
- Add a toolbar toggle that uses the supplied image: the playback control toggles the exact asset over the preview. This is selected because it keeps the preview clean when disabled and keeps the guide outside the exported composition.

## Validation

- Add focused local-editor tests proving the toggle starts off, toggles the image, and exposes its pressed state.
- Verify the overlay is available for a 9:16 frame and absent for other output ratios, including the resolved `Original` case.
- Verify the image is positioned over the preview frame, not rendered as part of the Remotion composition or export request.
- Manually confirm the guide aligns with the 9:16 Reels frame, remains usable in fullscreen, and does not block preview interactions.
- Run `npm run format`, `npm run format:check`, and `npm run lint` from `dashboard`, then restart and smoke-check the local frontend after implementation.
