import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";
import {
  EDITOR_PROJECT_DB_NAME,
  EDITOR_VIDEO_DB_NAME,
  createEmptyEditorHistory,
  createStoredProject,
  deleteStoredProject,
  getActiveProjectId,
  listStoredProjects,
  loadStoredProject,
  migrateLegacyProject,
  renameStoredProject,
  saveStoredVideo,
  setActiveProjectId,
} from "./localEditorPersistence";

const history = {
  past: [],
  present: {
    subtitleCues: [{ id: "cue-1", text: "Hello", start: 0, end: 1 }],
    subtitleStyle: {},
    subtitleLanguage: "en",
    hook: null,
  },
  future: [],
};

const makeVideoFile = (name = "demo.mp4") =>
  new File(["video"], name, { type: "video/mp4", lastModified: 123 });

const deleteDatabase = (name) =>
  new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve;
    request.onerror = resolve;
    request.onblocked = resolve;
  });

describe("local editor project persistence", () => {
  beforeEach(async () => {
    localStorage.clear();
    await deleteDatabase(EDITOR_PROJECT_DB_NAME);
    await deleteDatabase(EDITOR_VIDEO_DB_NAME);
  });

  it("creates an empty history from remembered settings without copying content", () => {
    const history = createEmptyEditorHistory({
      subtitleStyle: { position: "top", fontSize: 40 },
      subtitleLanguage: "fr",
      hookDefaults: { position: "center" },
    });

    expect(history.present.subtitleStyle).toMatchObject({
      position: "top",
      fontSize: 40,
    });
    expect(history.present.subtitleLanguage).toBe("fr");
    expect(history.present.subtitleCues).toEqual([]);
    expect(history.present.hook).toBeNull();
  });

  it("creates, lists, loads, renames, and deletes a stored project", async () => {
    const file = makeVideoFile();
    const project = await createStoredProject({
      name: "Demo Project",
      history,
      file,
      durationMs: 4200,
    });

    expect(project.name).toBe("Demo Project");
    expect(project.durationMs).toBe(4200);
    expect((await listStoredProjects()).map((item) => item.id)).toEqual([
      project.id,
    ]);
    expect((await loadStoredProject(project.id)).file.name).toBe("demo.mp4");

    await renameStoredProject(project.id, "Renamed Project");
    expect((await loadStoredProject(project.id)).project.name).toBe(
      "Renamed Project",
    );

    await setActiveProjectId(project.id);
    expect(await getActiveProjectId()).toBe(project.id);
    await deleteStoredProject(project.id);
    expect(await loadStoredProject(project.id)).toBeNull();
    expect(await getActiveProjectId()).toBeNull();
  });

  it("migrates the legacy single-project draft once", async () => {
    localStorage.setItem(
      "openshorts_local_editor_state_v1",
      JSON.stringify(history),
    );
    await saveStoredVideo(makeVideoFile("legacy.mp4"));

    const migrated = await migrateLegacyProject();
    expect(migrated?.project.name).toBe("legacy.mp4");
    expect(migrated?.file.name).toBe("legacy.mp4");
    expect((await listStoredProjects()).length).toBe(1);

    expect(await migrateLegacyProject()).toBeNull();
    expect((await listStoredProjects()).length).toBe(1);
  });
});
