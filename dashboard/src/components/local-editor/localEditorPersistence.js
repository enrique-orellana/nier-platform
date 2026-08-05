import { DEFAULT_SUBTITLE_STYLE, normalizeSubtitleStyle } from './localEditorStyles';

export const EDITOR_HISTORY_STORAGE_KEY = 'openshorts_local_editor_state_v1';
export const EDITOR_VIDEO_DB_NAME = 'openshorts-local-editor-v1';
export const EDITOR_VIDEO_STORE_NAME = 'video';
export const EDITOR_VIDEO_KEY = 'current';
export const EDITOR_HISTORY_LIMIT = 10;

export const createEmptyEditorHistory = () => ({
    past: [],
    present: { subtitleCues: [], subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE }, subtitleLanguage: 'en', hook: null },
    future: [],
});

const normalizeSnapshot = (snapshot) => ({
    subtitleCues: Array.isArray(snapshot?.subtitleCues) ? snapshot.subtitleCues : [],
    subtitleStyle: normalizeSubtitleStyle(snapshot?.subtitleStyle),
    subtitleLanguage: String(snapshot?.subtitleLanguage || 'en').toLowerCase(),
    hook: snapshot?.hook || null,
});

export const normalizeEditorHistory = (history) => ({
    past: Array.isArray(history?.past) ? history.past.slice(-EDITOR_HISTORY_LIMIT).map(normalizeSnapshot) : [],
    present: normalizeSnapshot(history?.present),
    future: Array.isArray(history?.future) ? history.future.slice(0, EDITOR_HISTORY_LIMIT).map(normalizeSnapshot) : [],
});

export const readEditorHistory = () => {
    try {
        const stored = localStorage.getItem(EDITOR_HISTORY_STORAGE_KEY);
        return stored ? normalizeEditorHistory(JSON.parse(stored)) : createEmptyEditorHistory();
    } catch {
        return createEmptyEditorHistory();
    }
};

export const saveEditorHistory = (history) => {
    try {
        localStorage.setItem(EDITOR_HISTORY_STORAGE_KEY, JSON.stringify(normalizeEditorHistory(history)));
    } catch {
        // Browser storage can be unavailable or full; editing remains usable in memory.
    }
};

const openVideoDatabase = () => new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
    }
    const request = indexedDB.open(EDITOR_VIDEO_DB_NAME, 1);
    request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(EDITOR_VIDEO_STORE_NAME)) request.result.createObjectStore(EDITOR_VIDEO_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local video storage.'));
});

export const saveStoredVideo = async (file) => {
    if (!file || typeof indexedDB === 'undefined') return false;
    try {
        const database = await openVideoDatabase();
        if (!database) return false;
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(EDITOR_VIDEO_STORE_NAME, 'readwrite');
            transaction.objectStore(EDITOR_VIDEO_STORE_NAME).put({
                blob: file,
                name: file.name,
                type: file.type,
                lastModified: file.lastModified,
            }, EDITOR_VIDEO_KEY);
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error || new Error('Could not save local video.'));
            transaction.onabort = () => reject(transaction.error || new Error('Could not save local video.'));
        });
        database.close();
        return true;
    } catch {
        return false;
    }
};

export const loadStoredVideo = async () => {
    if (typeof indexedDB === 'undefined') return null;
    try {
        const database = await openVideoDatabase();
        if (!database) return null;
        const record = await new Promise((resolve, reject) => {
            const transaction = database.transaction(EDITOR_VIDEO_STORE_NAME, 'readonly');
            const request = transaction.objectStore(EDITOR_VIDEO_STORE_NAME).get(EDITOR_VIDEO_KEY);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error || new Error('Could not load local video.'));
        });
        database.close();
        if (!record?.blob) return null;
        const blob = record.blob instanceof Blob ? record.blob : new Blob([record.blob], { type: record.type || 'video/mp4' });
        return new File([blob], record.name || 'local-video', { type: record.type || blob.type || 'video/mp4', lastModified: record.lastModified || Date.now() });
    } catch {
        return null;
    }
};

export const clearStoredVideo = async () => {
    if (typeof indexedDB === 'undefined') return false;
    try {
        const database = await openVideoDatabase();
        if (!database) return false;
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(EDITOR_VIDEO_STORE_NAME, 'readwrite');
            transaction.objectStore(EDITOR_VIDEO_STORE_NAME).delete(EDITOR_VIDEO_KEY);
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error || new Error('Could not clear local video.'));
            transaction.onabort = () => reject(transaction.error || new Error('Could not clear local video.'));
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
