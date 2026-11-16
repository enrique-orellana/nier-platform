## Frontend verification

- Whenever files under `dashboard/src/` are modified, run `npm run format`, `npm run format:check`, and `npm run lint` from `dashboard` before committing.

## Browser testing

- Use Brave for browser-based reproduction and end-to-end verification. Do not use Chrome or the in-app Chromium browser unless the user explicitly requests it.

## Live local app workflow

When a user asks for a code change to be applied to the running local app, use the
repository-managed workflow below. Work inline in the current checkout when the
user requests inline implementation; do not create a worktree unless the user
asks for one.

1. Make and verify the requested change.
2. Review `git status` and the diff. Preserve unrelated user changes and stage
   only the files belonging to the requested change.
3. Unless the user explicitly says not to commit, create the requested commit
   after the required checks pass. Update the local graph after code changes
   with `$env:GRAPHIFY_MAX_WORKERS = "2"; graphify update . --no-cluster`, then
   inspect the staged file list and diff before committing. For symbol-level
   changes, use `graphify affected "<symbol>"` when the graph has that symbol.
4. Rebuild and apply the committed code to the running app from the repository
   root:

   ```powershell
   .\scripts\manage-local.ps1 -Action Restart
   ```

   `Restart` stops the selected services, rebuilds them, and starts them again;
   Docker volumes are preserved. Use `-Component` when only one area changed:

   ```powershell
   .\scripts\manage-local.ps1 -Action Restart -Component frontend
   .\scripts\manage-local.ps1 -Action Restart -Component backend
   .\scripts\manage-local.ps1 -Action Restart -Component renderer
   ```

   Component mapping: dashboard changes use `frontend`; Go/Python API or worker
   changes use `backend`; `render-service` or Remotion changes use `renderer`.
   For cross-component changes, use the default all-component restart.

5. Run `.\scripts\manage-local.ps1 -Action Status` and the relevant health or
   focused smoke check, then report the commit and live-app update result.

`-Action Update` only rebuilds selected components; it does not restart the
running app. Do not claim that the live app was updated until `Restart` (or an
equivalent targeted restart) completes successfully. If the user explicitly
requests no commit, keep the change inline and still use `Restart` to apply it.

## graphify

This project has a local AST code graph at graphify-out/graph.json. It is built without an API call or hosted upload.

When the user types `/graphify`, read the installed graphify skill, then follow the local-code-only project rules below.

Rules:
- Use Graphify only to query or update this repository's local code graph. Do not target remote URLs or run semantic extraction over docs, images, or video, and do not upload this repository to Graphify Cloud.
- Keep `graphify-out/` local and ignored by Git and Docker. Never force-add generated graph output.
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `graphify section "<heading>"` prints that section's text, so the .md need not be opened. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `$env:GRAPHIFY_MAX_WORKERS = "2"; graphify update . --no-cluster` to keep the graph current using local AST extraction only.
