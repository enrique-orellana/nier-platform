# Local Editor Saved Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browser-local multi-project persistence to the local editor, including explicit first save, debounced auto-save, project switching, rename/delete, and migration of the existing single draft.

**Architecture:** Add a versioned IndexedDB project store with separate metadata and video Blob stores. Keep storage access in `localEditorPersistence.js`, render project management through a presentational `LocalEditorProjects` modal, and let `LocalEditorTab` own the active project and debounced auto-save lifecycle. No backend or cluster data is involved.

**Tech Stack:** React 18, IndexedDB, localStorage migration, Vitest, Testing Library, `fake-indexeddb`, Vite.

---

### Task 1: Build and test the multi-project persistence layer

**Files:**
- Modify: `dashboard/package.json`
- Modify: `dashboard/package-lock.json`
- Modify: `dashboard/src/components/local-editor/localEditorPersistence.js`
- Create: `dashboard/src/components/local-editor/localEditorPersistence.test.js`

- [ ] **Step 1: Add the IndexedDB test dependency**

From `D:\workspace\openshorts\dashboard`, run:

```powershell
npm install --save-dev fake-indexeddb
```

Expected: `fake-indexeddb` is added to `devDependencies` and `package-lock.json`; no production dependency is added.

- [ ] **Step 2: Write the failing persistence tests**

Create `localEditorPersistence.test.js` with this setup and test contract:

```js
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    EDITOR_PROJECT_DB_NAME,
    createStoredProject,
    deleteStoredProject,
    getActiveProjectId,
    listStoredProjects,
    loadStoredProject,
    migrateLegacyProject,
    renameStoredProject,
    saveStoredVideo,
    setActiveProjectId,
} from './localEditorPersistence';

const history = {
    past: [],
    present: { subtitleCues: [], subtitleStyle: {}, subtitleLanguage: 'en', hook: null },
    future: [],
};

beforeEach(async () => {
    localStorage.clear();
    await Promise.all(['openshorts-local-editor-v1', EDITOR_PROJECT_DB_NAME].map((databaseName) => new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(databaseName);
        request.onsuccess = request.onerror = request.onblocked = resolve;
    })));
});

afterEach(() => localStorage.clear());

describe('local editor project persistence', () => {
    it('creates, lists, loads, renames, and deletes an independent project', async () => {
        const file = new File(['video'], 'demo.mp4', { type: 'video/mp4' });
        const project = await createStoredProject({ name: 'Demo', history, file, durationMs: 4200 });

        expect(project).toMatchObject({ name: 'Demo', videoName: 'demo.mp4', durationMs: 4200 });
        expect((await listStoredProjects()).map((item) => item.id)).toContain(project.id);
        expect((await loadStoredProject(project.id)).file).toBeInstanceOf(File);
        expect((await renameStoredProject(project.id, 'Renamed')).name).toBe('Renamed');
        await deleteStoredProject(project.id);
        expect(await loadStoredProject(project.id)).toBeNull();
    });

    it('tracks the active project independently from the project list', async () => {
        const project = await createStoredProject({ name: 'Active', history, file: new File(['v'], 'active.mp4', { type: 'video/mp4' }), durationMs: 1000 });
        await setActiveProjectId(project.id);
        expect(await getActiveProjectId()).toBe(project.id);
        await setActiveProjectId(null);
        expect(await getActiveProjectId()).toBeNull();
    });

    it('migrates the existing single draft once and does not duplicate it', async () => {
        localStorage.setItem('openshorts_local_editor_state_v1', JSON.stringify(history));
        await saveStoredVideo(new File(['legacy'], 'legacy.mp4', { type: 'video/mp4' }));
        const migrated = await migrateLegacyProject();
        expect(migrated).toMatchObject({ videoName: expect.any(String) });
        expect((await migrateLegacyProject())?.id).toBe(migrated.id);
        expect((await listStoredProjects()).filter((item) => item.id === migrated.id)).toHaveLength(1);
    });
});
```

The tests intentionally import new APIs before they exist.

- [ ] **Step 3: Run the persistence tests and verify RED**

```powershell
npm test -- --run src/components/local-editor/localEditorPersistence.test.js
```

Expected: the test file fails because the project CRUD and migration exports are not implemented yet.

- [ ] **Step 4: Implement project normalization and IndexedDB CRUD**

Extend `localEditorPersistence.js` with these public contracts:

```js
export const EDITOR_PROJECT_DB_NAME = 'openshorts-local-editor-v2';
export const EDITOR_PROJECT_STORE_NAME = 'projects';
export const EDITOR_PROJECT_VIDEO_STORE_NAME = 'videos';
export const EDITOR_ACTIVE_PROJECT_KEY = 'openshorts_local_editor_active_project_v1';

export const normalizeStoredProject = (project) => ({
    id: String(project?.id || crypto.randomUUID()),
    name: String(project?.name || project?.videoName || 'Untitled project').trim() || 'Untitled project',
    videoName: String(project?.videoName || 'local-video'),
    videoType: String(project?.videoType || 'video/mp4'),
    videoLastModified: Number(project?.videoLastModified || 0),
    durationMs: Math.max(1, Number(project?.durationMs || 30000)),
    history: normalizeEditorHistory(project?.history),
    createdAt: Number(project?.createdAt || Date.now()),
    updatedAt: Number(project?.updatedAt || Date.now()),
});

export const createStoredProject = async ({ name, history, file, durationMs }) => {
    const now = Date.now();
    const project = normalizeStoredProject({
        id: crypto.randomUUID(), name, history, durationMs, videoName: file?.name,
        videoType: file?.type, videoLastModified: file?.lastModified, createdAt: now, updatedAt: now,
    });
    await writeProjectAndVideo(project, file);
    await setActiveProjectId(project.id);
    return project;
};

// Export these functions with the following behavior:
// listStoredProjects(): normalized project records sorted by updatedAt descending.
// loadStoredProject(projectId): { project, file } with a reconstructed File, or null.
// saveStoredProject(project, file): update metadata/history and replace the video when provided.
// renameStoredProject(projectId, name): normalized renamed record with updatedAt refreshed.
// deleteStoredProject(projectId): delete metadata and video in one read/write transaction.
export const getActiveProjectId = async () => localStorage.getItem(EDITOR_ACTIVE_PROJECT_KEY) || null;
// setActiveProjectId(projectId) stores a non-empty ID or removes the active key for null/empty input.
```

Use one `onupgradeneeded` handler to create `projects` and `videos` object
stores. Keep the old v1 database helpers intact for migration. `loadStoredProject`
must rebuild a `File` from the stored Blob metadata, and all public reads must
normalize malformed records before returning them.

- [ ] **Step 5: Implement one-time legacy migration and error-safe fallbacks**

Implement `migrateLegacyProject()` as follows:

1. If `localStorage` contains a migration marker, return the active migrated
   project if it still exists.
2. Read the existing v1 history and `current` video using the current helpers.
3. If either legacy item exists, create one project named from the video file
   name or `Recovered local project`, preserving the history and duration
   default.
4. Set the migration marker and active project ID.
5. Catch IndexedDB/localStorage failures, return `null`, and leave the editor
   usable in memory.

`saveStoredProject` and `deleteStoredProject` must reject/report storage errors
without mutating the caller’s in-memory state.

- [ ] **Step 6: Run the persistence tests and verify GREEN**

```powershell
npm test -- --run src/components/local-editor/localEditorPersistence.test.js
```

Expected: all persistence CRUD, active-project, and migration tests pass.

### Task 2: Add the project management modal

**Files:**
- Create: `dashboard/src/components/local-editor/LocalEditorProjects.jsx`
- Create: `dashboard/src/components/local-editor/LocalEditorProjects.test.jsx`

- [ ] **Step 1: Write the failing modal tests**

Create tests that render the component with two project records and assert:

```jsx
it('lists projects and emits open, rename, delete, and new-project actions', () => {
    const actions = { onOpen: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onNewProject: vi.fn(), onClose: vi.fn() };
    render(<LocalEditorProjects open projects={[{ id: 'one', name: 'One', videoName: 'one.mp4', durationMs: 4200, updatedAt: Date.now() }, { id: 'two', name: 'Two', videoName: 'two.mp4', durationMs: 9000, updatedAt: Date.now() - 1000 }]} {...actions} />);

    expect(screen.getByRole('dialog', { name: /saved projects/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open One' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename One' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete One' }));
    fireEvent.click(screen.getByRole('button', { name: /new project/i }));
    expect(actions.onOpen).toHaveBeenCalledWith('one');
    expect(actions.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'one' }));
    expect(actions.onDelete).toHaveBeenCalledWith('one');
    expect(actions.onNewProject).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run the modal test and verify RED**

```powershell
npm test -- --run src/components/local-editor/LocalEditorProjects.test.jsx
```

Expected: Vitest cannot resolve `LocalEditorProjects` because the component is not implemented.

- [ ] **Step 3: Implement the presentational project modal**

Implement `LocalEditorProjects` with this prop contract:

```jsx
export default function LocalEditorProjects({
    open,
    projects,
    activeProjectId,
    onClose,
    onOpen,
    onRename,
    onDelete,
    onNewProject,
}) {
    if (!open) return null;
    return (
        <div role="dialog" aria-modal="true" aria-labelledby="saved-projects-title">
            <h2 id="saved-projects-title">Saved projects</h2>
            <button type="button" onClick={onNewProject}>New project</button>
            {projects.map((project) => (
                <article key={project.id} data-active={project.id === activeProjectId}>
                    <h3>{project.name}</h3>
                    <p>{project.videoName}</p>
                    <button type="button" onClick={() => onOpen(project.id)}>Open {project.name}</button>
                    <button type="button" onClick={() => onRename(project)}>Rename {project.name}</button>
                    <button type="button" onClick={() => onDelete(project.id)}>Delete {project.name}</button>
                </article>
            ))}
            <button type="button" onClick={onClose}>Close</button>
        </div>
    );
}
```

Render each project as a compact card showing the name, filename, formatted
duration, and relative updated time. Give controls the exact accessible names
`Open {name}`, `Rename {name}`, and `Delete {name}`. Keep delete confirmation in
the parent so the component only emits intent. Render an empty state with a
`New project` button when there are no saved projects.

- [ ] **Step 4: Run the modal tests and verify GREEN**

```powershell
npm test -- --run src/components/local-editor/LocalEditorProjects.test.jsx
```

Expected: the modal interaction tests pass.

### Task 3: Integrate project lifecycle and auto-save into the editor

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`

- [ ] **Step 1: Add failing local-editor project lifecycle tests**

Add tests using `fake-indexeddb/auto` and the real persistence helpers that cover:

```jsx
it('creates a named project and auto-saves later editor edits', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
    vi.spyOn(window, 'prompt').mockReturnValue('Demo project');
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Project' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save Project' }));
    fireEvent.click(screen.getByRole('button', { name: /add subtitle cue/i }));
    await waitFor(async () => expect((await listStoredProjects())[0].history.present.subtitleCues).toHaveLength(1));
});

it('opens another saved project and deletes it only after confirmation', async () => {
    const first = await createStoredProject({ name: 'First', history, file: new File(['first'], 'first.mp4', { type: 'video/mp4' }), durationMs: 4200 });
    const second = await createStoredProject({ name: 'Second', history, file: new File(['second'], 'second.mp4', { type: 'video/mp4' }), durationMs: 9000 });
    render(<LocalEditorTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(screen.getByRole('button', { name: `Open ${second.name}` }));
    await waitFor(() => expect(screen.getByText('second.mp4')).toBeInTheDocument());
    const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: `Delete ${second.name}` }));
    expect(await listStoredProjects()).toEqual(expect.arrayContaining([expect.objectContaining({ id: second.id })]));
    confirmMock.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: `Delete ${second.name}` }));
    await waitFor(async () => expect((await listStoredProjects()).map((project) => project.id)).not.toContain(second.id));
    expect((await listStoredProjects()).map((project) => project.id)).toContain(first.id);
});
```

The second test should use explicit assertions for both confirmation outcomes;
do not test deletion by directly calling the persistence helper.

- [ ] **Step 2: Run the local-editor lifecycle tests and verify RED**

```powershell
npm test -- --run src/components/local-editor/LocalEditorTab.test.jsx
```

Expected: the new tests fail because the header controls, project initialization,
project switching, and auto-save lifecycle do not exist.

- [ ] **Step 3: Add project state and header controls**

Import the project persistence API and `LocalEditorProjects`. Add state/refs:

```jsx
const [projects, setProjects] = useState([]);
const [activeProjectId, setActiveProjectIdState] = useState(null);
const [projectsOpen, setProjectsOpen] = useState(false);
const [projectStorageWarning, setProjectStorageWarning] = useState('');
const projectLoadRef = useRef(false);
const projectSaveTimerRef = useRef(null);
const activeProjectNameRef = useRef('');
```

The editing header must expose `Save Project` when a video is loaded and
`Projects` whenever the editor is rendered, including the upload state. Render
`LocalEditorProjects` near the root so it can open from either state.

- [ ] **Step 4: Implement project initialization, save, and switching**

On mount, call `migrateLegacyProject`, list projects, read the active project
ID, and load the active project if it has a video. When opening a project:

```jsx
const openProject = async (projectId) => {
    projectLoadRef.current = true;
    try {
        const loaded = await loadStoredProject(projectId);
        if (!loaded?.file) throw new Error('Saved project video is unavailable.');
        setEditHistory(loaded.project.history);
        loadVideo(loaded.file, { persist: false, projectId: loaded.project.id });
        setActiveProjectIdState(loaded.project.id);
        await setActiveProjectId(loaded.project.id);
        setProjectsOpen(false);
    } catch (loadError) {
        setError(loadError.message || 'Could not open saved project.');
    } finally {
        projectLoadRef.current = false;
    }
};
```

The first `Save Project` uses `window.prompt('Project name', videoFile.name)`;
cancel leaves the editor untouched. A valid name calls `createStoredProject`,
sets the active ID, and refreshes the list. Saving an already active project
calls `saveStoredProject` immediately. Uploading a different video clears the
active project ID without deleting the previous project, making the next save
create a new project.

- [ ] **Step 5: Add debounced auto-save and failure handling**

After an explicit project exists, debounce saves from `editHistory`,
`videoFile`, and `durationMs`:

```jsx
useEffect(() => {
    if (!activeProjectId || !videoFile || projectLoadRef.current || !persistHistory) return undefined;
    clearTimeout(projectSaveTimerRef.current);
    projectSaveTimerRef.current = setTimeout(() => {
        saveStoredProject({
            id: activeProjectId,
            name: activeProjectNameRef.current,
            history: editHistoryRef.current,
            videoName: videoFile.name,
            videoType: videoFile.type,
            videoLastModified: videoFile.lastModified,
            durationMs,
        }, videoFile).catch(() => setProjectStorageWarning('Changes are kept in memory but could not be saved.'));
    }, 350);
    return () => clearTimeout(projectSaveTimerRef.current);
}, [activeProjectId, durationMs, editHistory, persistHistory, videoFile]);
```

Keep the existing single-draft persistence effect for backward compatibility
only while `activeProjectId` is null; once a project is saved, the project store
is the source of truth. Reset must clear only the active editor state and active
project selection; it must not call `deleteStoredProject`.

- [ ] **Step 6: Wire modal actions and verify the lifecycle tests GREEN**

Pass the project list and handlers to `LocalEditorProjects`:

```jsx
<LocalEditorProjects
    open={projectsOpen}
    projects={projects}
    activeProjectId={activeProjectId}
    onClose={() => setProjectsOpen(false)}
    onOpen={openProject}
    onRename={renameProject}
    onDelete={deleteProject}
    onNewProject={startNewProject}
/>
```

`renameProject` prompts for a non-empty name and calls `renameStoredProject`;
`deleteProject` requires `window.confirm`, removes the selected project, and
clears the active selection only when deleting the active project. Refresh the
list after every mutation and surface storage errors in the existing editor
error/warning area.

Run:

```powershell
npm test -- --run src/components/local-editor/LocalEditorTab.test.jsx src/components/local-editor/LocalEditorProjects.test.jsx src/components/local-editor/localEditorPersistence.test.js
```

Expected: all project modal, persistence, migration, save, switch, and delete
tests pass.

### Task 4: Full verification and implementation commit

**Files:**
- Review: `dashboard/src/components/local-editor/localEditorPersistence.js`
- Review: `dashboard/src/components/local-editor/localEditorPersistence.test.js`
- Review: `dashboard/src/components/local-editor/LocalEditorProjects.jsx`
- Review: `dashboard/src/components/local-editor/LocalEditorProjects.test.jsx`
- Review: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Review: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`
- Review: `dashboard/package.json`
- Review: `dashboard/package-lock.json`

- [ ] **Step 1: Run the complete dashboard test suite**

```powershell
cd D:\workspace\openshorts\dashboard
npm test
```

Expected: exit code 0 with all existing and new tests passing.

- [ ] **Step 2: Run the production build**

```powershell
npm run build
```

Expected: exit code 0 and a successful Vite production build.

- [ ] **Step 3: Review the diff and working tree**

```powershell
cd D:\workspace\openshorts
git diff --check
git status --short
git diff -- dashboard/src/components/local-editor dashboard/package.json dashboard/package-lock.json
```

Expected: only the project persistence, modal, local-editor integration, tests,
and the `fake-indexeddb` development dependency are changed.

- [ ] **Step 4: Commit the implementation**

```powershell
git add -- dashboard/package.json dashboard/package-lock.json dashboard/src/components/local-editor/localEditorPersistence.js dashboard/src/components/local-editor/localEditorPersistence.test.js dashboard/src/components/local-editor/LocalEditorProjects.jsx dashboard/src/components/local-editor/LocalEditorProjects.test.jsx dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/components/local-editor/LocalEditorTab.test.jsx
git commit -m "feat: persist multiple local editor projects"
```

Expected: a new implementation commit is created and the working tree is clean.
