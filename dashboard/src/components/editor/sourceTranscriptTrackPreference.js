const ACTIVE_TRACK_STORAGE_PREFIX =
  "openshorts_source_transcript_active_track_v1:";

const storageKeyForProject = (projectId) =>
  `${ACTIVE_TRACK_STORAGE_PREFIX}${encodeURIComponent(String(projectId || ""))}`;

export const readActiveSourceSubtitleTrackId = (projectId, tracks) => {
  const availableTracks = Array.isArray(tracks) ? tracks : [];
  try {
    const savedTrackId = localStorage.getItem(storageKeyForProject(projectId));
    if (availableTracks.some((track) => track?.id === savedTrackId))
      return savedTrackId;
  } catch {
    // Keep the editor usable when browser storage is unavailable.
  }
  return availableTracks.some((track) => track?.id === "original")
    ? "original"
    : availableTracks[0]?.id || "original";
};

export const saveActiveSourceSubtitleTrackId = (projectId, trackId) => {
  if (!projectId || !trackId) return;
  try {
    localStorage.setItem(storageKeyForProject(projectId), String(trackId));
  } catch {
    // Keep the current editor session usable when browser storage is unavailable.
  }
};
