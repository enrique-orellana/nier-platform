import {
  DEFAULT_SUBTITLE_STYLE,
  normalizeSubtitleStyle,
} from "./localEditorStyles";
import { normalizeLayoutSegments } from "../../editor/layoutTimelineModel";

export const EDITOR_HISTORY_STORAGE_KEY = "openshorts_local_editor_state_v1";
export const EDITOR_VIDEO_DB_NAME = "openshorts-local-editor-v1";
export const EDITOR_VIDEO_STORE_NAME = "video";
export const EDITOR_VIDEO_KEY = "current";
export const EDITOR_HISTORY_LIMIT = 10;
export const EDITOR_PROJECT_DB_NAME = "openshorts-local-editor-v2";
export const EDITOR_PROJECT_STORE_NAME = "projects";
export const EDITOR_PROJECT_VIDEO_STORE_NAME = "videos";
export const EDITOR_ACTIVE_PROJECT_KEY =
  "openshorts_local_editor_active_project_v1";
export const EDITOR_PROJECT_MIGRATION_KEY =
  "openshorts_local_editor_projects_migrated_v1";

export const createEmptyEditorHistory = (preferences = {}) => ({
  past: [],
  present: {
    subtitleCues: [],
    subtitleStyle: normalizeSubtitleStyle(
      preferences?.subtitleStyle || DEFAULT_SUBTITLE_STYLE,
    ),
    subtitleLanguage: String(
      preferences?.subtitleLanguage || "en",
    ).toLowerCase(),
    hook: null,
    markers: [],
    layoutSegments: [],
  },
  future: [],
});

const snapshotDurationMs = (segments) =>
  segments.reduce(
    (duration, segment) => Math.max(duration, Number(segment?.endMs) || 0),
    0,
  );

const normalizeSnapshot = (snapshot) => {
  const rawLayoutSegments = snapshot?.layoutSegments;
  const layoutSegments = Array.isArray(rawLayoutSegments)
    ? normalizeLayoutSegments(
        rawLayoutSegments,
        Math.max(1, snapshotDurationMs(rawLayoutSegments)),
      )
    : [];
  return {
    subtitleCues: Array.isArray(snapshot?.subtitleCues)
      ? snapshot.subtitleCues
      : [],
    subtitleStyle: normalizeSubtitleStyle(snapshot?.subtitleStyle),
    subtitleLanguage: String(snapshot?.subtitleLanguage || "en").toLowerCase(),
    hook: snapshot?.hook || null,
    markers: Array.isArray(snapshot?.markers)
      ? snapshot.markers
          .map((marker, index) => ({
            id: String(marker?.id || `marker-${index}`),
            timeMs: Math.max(0, Number(marker?.timeMs) || 0),
            label: marker?.label ? String(marker.label) : "",
          }))
          .filter((marker) => Number.isFinite(marker.timeMs))
      : [],
    layoutSegments,
  };
};

export const normalizeEditorHistory = (history) => ({
  past: Array.isArray(history?.past)
    ? history.past.slice(-EDITOR_HISTORY_LIMIT).map(normalizeSnapshot)
    : [],
  present: normalizeSnapshot(history?.present),
  future: Array.isArray(history?.future)
    ? history.future.slice(0, EDITOR_HISTORY_LIMIT).map(normalizeSnapshot)
    : [],
});

export const readEditorHistory = () => {
  try {
    const stored = localStorage.getItem(EDITOR_HISTORY_STORAGE_KEY);
    return stored
      ? normalizeEditorHistory(JSON.parse(stored))
      : createEmptyEditorHistory();
  } catch {
    return createEmptyEditorHistory();
  }
};

export const saveEditorHistory = (history) => {
  try {
    localStorage.setItem(
      EDITOR_HISTORY_STORAGE_KEY,
      JSON.stringify(normalizeEditorHistory(history)),
    );
  } catch {
    // Browser storage can be unavailable or full; editing remains usable in memory.
  }
};

const openVideoDatabase = () =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const request = indexedDB.open(EDITOR_VIDEO_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(EDITOR_VIDEO_STORE_NAME))
        request.result.createObjectStore(EDITOR_VIDEO_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Could not open local video storage."));
  });

const openProjectDatabase = () =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const request = indexedDB.open(EDITOR_PROJECT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (
        !request.result.objectStoreNames.contains(EDITOR_PROJECT_STORE_NAME)
      ) {
        request.result.createObjectStore(EDITOR_PROJECT_STORE_NAME, {
          keyPath: "id",
        });
      }
      if (
        !request.result.objectStoreNames.contains(
          EDITOR_PROJECT_VIDEO_STORE_NAME,
        )
      ) {
        request.result.createObjectStore(EDITOR_PROJECT_VIDEO_STORE_NAME, {
          keyPath: "projectId",
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error || new Error("Could not open local project storage."),
      );
  });

const randomProjectId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const normalizeStoredProject = (project = {}) => {
  const now = Date.now();
  return {
    id: String(project.id || randomProjectId()),
    name:
      String(project.name || project.videoName || "Untitled project").trim() ||
      "Untitled project",
    videoName: String(project.videoName || "local-video"),
    durationMs: Number.isFinite(Number(project.durationMs))
      ? Number(project.durationMs)
      : 0,
    createdAt: Number.isFinite(Number(project.createdAt))
      ? Number(project.createdAt)
      : now,
    updatedAt: Number.isFinite(Number(project.updatedAt))
      ? Number(project.updatedAt)
      : now,
    history: normalizeEditorHistory(project.history),
  };
};

const runProjectTransaction = async (mode, callback) => {
  const database = await openProjectDatabase();
  if (!database) return null;
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(
        [EDITOR_PROJECT_STORE_NAME, EDITOR_PROJECT_VIDEO_STORE_NAME],
        mode,
      );
      callback(transaction, resolve, reject);
      transaction.onerror = () =>
        reject(
          transaction.error ||
            new Error("Could not update local project storage."),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ||
            new Error("Could not update local project storage."),
        );
    });
  } finally {
    database.close();
  }
};

const fileFromRecord = (record) => {
  if (!record?.blob) return null;
  const blob =
    record.blob instanceof Blob
      ? record.blob
      : new Blob([record.blob], { type: record.type || "video/mp4" });
  return new File([blob], record.name || "local-video", {
    type: record.type || blob.type || "video/mp4",
    lastModified: record.lastModified || Date.now(),
  });
};

export const saveStoredProject = async (project, file = null) => {
  if (typeof indexedDB === "undefined") return null;
  const normalized = normalizeStoredProject({
    ...project,
    videoName: file?.name || project?.videoName,
  });
  normalized.updatedAt = Date.now();
  try {
    await runProjectTransaction("readwrite", (transaction, resolve) => {
      transaction.objectStore(EDITOR_PROJECT_STORE_NAME).put(normalized);
      if (file) {
        transaction.objectStore(EDITOR_PROJECT_VIDEO_STORE_NAME).put({
          projectId: normalized.id,
          blob: file,
          name: file.name,
          type: file.type,
          lastModified: file.lastModified,
        });
      }
      transaction.oncomplete = () => resolve(normalized);
    });
    return normalized;
  } catch {
    return null;
  }
};

export const createStoredProject = async ({
  name,
  history,
  file,
  durationMs = 0,
}) =>
  saveStoredProject(
    {
      id: randomProjectId(),
      name,
      history,
      videoName: file?.name,
      durationMs,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    file,
  );

export const listStoredProjects = async () => {
  if (typeof indexedDB === "undefined") return [];
  try {
    const database = await openProjectDatabase();
    if (!database) return [];
    const projects = await new Promise((resolve, reject) => {
      const transaction = database.transaction(
        EDITOR_PROJECT_STORE_NAME,
        "readonly",
      );
      const request = transaction
        .objectStore(EDITOR_PROJECT_STORE_NAME)
        .getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () =>
        reject(request.error || new Error("Could not list local projects."));
    });
    database.close();
    return projects
      .map(normalizeStoredProject)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
};

export const loadStoredProject = async (projectId) => {
  if (!projectId || typeof indexedDB === "undefined") return null;
  try {
    const database = await openProjectDatabase();
    if (!database) return null;
    const result = await new Promise((resolve, reject) => {
      const transaction = database.transaction(
        [EDITOR_PROJECT_STORE_NAME, EDITOR_PROJECT_VIDEO_STORE_NAME],
        "readonly",
      );
      let project;
      let video;
      const projectRequest = transaction
        .objectStore(EDITOR_PROJECT_STORE_NAME)
        .get(projectId);
      const videoRequest = transaction
        .objectStore(EDITOR_PROJECT_VIDEO_STORE_NAME)
        .get(projectId);
      projectRequest.onsuccess = () => {
        project = projectRequest.result || null;
      };
      videoRequest.onsuccess = () => {
        video = videoRequest.result || null;
      };
      transaction.oncomplete = () =>
        resolve(
          project
            ? {
                project: normalizeStoredProject(project),
                file: fileFromRecord(video),
              }
            : null,
        );
      transaction.onerror = () =>
        reject(transaction.error || new Error("Could not load local project."));
    });
    database.close();
    return result;
  } catch {
    return null;
  }
};

export const renameStoredProject = async (projectId, name) => {
  const current = await loadStoredProject(projectId);
  if (!current) return null;
  return saveStoredProject({ ...current.project, name }, current.file);
};

export const deleteStoredProject = async (projectId) => {
  if (!projectId || typeof indexedDB === "undefined") return false;
  try {
    await runProjectTransaction("readwrite", (transaction, resolve) => {
      transaction.objectStore(EDITOR_PROJECT_STORE_NAME).delete(projectId);
      transaction
        .objectStore(EDITOR_PROJECT_VIDEO_STORE_NAME)
        .delete(projectId);
      transaction.oncomplete = resolve;
    });
    if ((await getActiveProjectId()) === projectId)
      await setActiveProjectId(null);
    return true;
  } catch {
    return false;
  }
};

export const getActiveProjectId = async () => {
  try {
    return localStorage.getItem(EDITOR_ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
};

export const setActiveProjectId = async (projectId) => {
  try {
    if (projectId) localStorage.setItem(EDITOR_ACTIVE_PROJECT_KEY, projectId);
    else localStorage.removeItem(EDITOR_ACTIVE_PROJECT_KEY);
    return true;
  } catch {
    return false;
  }
};

export const migrateLegacyProject = async ({
  hasLegacyHistory = null,
} = {}) => {
  try {
    if (localStorage.getItem(EDITOR_PROJECT_MIGRATION_KEY) === "done")
      return null;
  } catch {
    // Continue in memory when browser storage is unavailable.
  }

  const historyPresent =
    hasLegacyHistory === null
      ? (() => {
          try {
            return Boolean(localStorage.getItem(EDITOR_HISTORY_STORAGE_KEY));
          } catch {
            return false;
          }
        })()
      : hasLegacyHistory;
  const file = await loadStoredVideo();
  if (!historyPresent && !file) {
    try {
      localStorage.setItem(EDITOR_PROJECT_MIGRATION_KEY, "done");
    } catch {
      /* memory-only fallback */
    }
    return null;
  }

  const project = await createStoredProject({
    name: file?.name || "Recovered local project",
    history: readEditorHistory(),
    file,
    durationMs: 0,
  });
  if (!project) return null;
  await setActiveProjectId(project.id);
  try {
    localStorage.setItem(EDITOR_PROJECT_MIGRATION_KEY, "done");
  } catch {
    /* memory-only fallback */
  }
  return { project, file };
};

export const saveStoredVideo = async (file) => {
  if (!file || typeof indexedDB === "undefined") return false;
  try {
    const database = await openVideoDatabase();
    if (!database) return false;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(
        EDITOR_VIDEO_STORE_NAME,
        "readwrite",
      );
      transaction.objectStore(EDITOR_VIDEO_STORE_NAME).put(
        {
          blob: file,
          name: file.name,
          type: file.type,
          lastModified: file.lastModified,
        },
        EDITOR_VIDEO_KEY,
      );
      transaction.oncomplete = resolve;
      transaction.onerror = () =>
        reject(transaction.error || new Error("Could not save local video."));
      transaction.onabort = () =>
        reject(transaction.error || new Error("Could not save local video."));
    });
    database.close();
    return true;
  } catch {
    return false;
  }
};

export const loadStoredVideo = async () => {
  if (typeof indexedDB === "undefined") return null;
  try {
    const database = await openVideoDatabase();
    if (!database) return null;
    const record = await new Promise((resolve, reject) => {
      const transaction = database.transaction(
        EDITOR_VIDEO_STORE_NAME,
        "readonly",
      );
      const request = transaction
        .objectStore(EDITOR_VIDEO_STORE_NAME)
        .get(EDITOR_VIDEO_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () =>
        reject(request.error || new Error("Could not load local video."));
    });
    database.close();
    if (!record?.blob) return null;
    const blob =
      record.blob instanceof Blob
        ? record.blob
        : new Blob([record.blob], { type: record.type || "video/mp4" });
    return new File([blob], record.name || "local-video", {
      type: record.type || blob.type || "video/mp4",
      lastModified: record.lastModified || Date.now(),
    });
  } catch {
    return null;
  }
};

export const clearStoredVideo = async () => {
  if (typeof indexedDB === "undefined") return false;
  try {
    const database = await openVideoDatabase();
    if (!database) return false;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(
        EDITOR_VIDEO_STORE_NAME,
        "readwrite",
      );
      transaction.objectStore(EDITOR_VIDEO_STORE_NAME).delete(EDITOR_VIDEO_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () =>
        reject(transaction.error || new Error("Could not clear local video."));
      transaction.onabort = () =>
        reject(transaction.error || new Error("Could not clear local video."));
    });
    database.close();
    return true;
  } catch {
    return false;
  }
};

export const clearEditorPersistence = async () => {
  try {
    localStorage.removeItem(EDITOR_HISTORY_STORAGE_KEY);
  } catch {
    // Ignore unavailable browser storage.
  }
  await clearStoredVideo();
};
