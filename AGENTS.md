<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **nier-platform** (7181 symbols, 17335 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/nier-platform/context` | Codebase overview, check index freshness |
| `gitnexus://repo/nier-platform/clusters` | All functional areas |
| `gitnexus://repo/nier-platform/processes` | All execution flows |
| `gitnexus://repo/nier-platform/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

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
   after the required tests and checks pass. Run GitNexus `detect_changes()`
   before committing.
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
