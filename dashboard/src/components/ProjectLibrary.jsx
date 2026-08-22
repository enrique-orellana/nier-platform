import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Film,
  FolderOpen,
  HardDrive,
  Info,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiUrl } from "../config";
import { activeClipRenderJobs } from "../lib/clipRenderJobs";
import { toProxiedVideoUrl } from "../lib/videoUrls";
import { CLIP_WORKFLOW_STATUSES } from "./clipWorkflowStatuses";
import ResultCard from "./ResultCard";

const CLIP_RENDER_POLL_INTERVAL_MS = 2000;
const CLIP_RENDER_STATUS_TIMEOUT_MS = 15000;
const CLIP_RENDER_MAX_POLL_DURATION_MS = 30 * 60 * 1000;

function mergeAuthoritativeRenderStatuses(clips, statusClips) {
  if (!Array.isArray(statusClips)) return clips;

  return clips.map((clip, index) => {
    const clipIndex = Number.isInteger(clip.index) ? clip.index : index;
    const authoritative = statusClips.find((candidate, candidateIndex) => {
      const candidateClipIndex = Number.isInteger(candidate?.index)
        ? candidate.index
        : candidateIndex;
      return candidateClipIndex === clipIndex;
    });
    if (!authoritative || !authoritative.render_status) return clip;

    const renderedFields =
      authoritative.render_status === "ready"
        ? {
            ...(authoritative.video_url
              ? { video_url: authoritative.video_url }
              : {}),
            ...(authoritative.video_filename
              ? { video_filename: authoritative.video_filename }
              : {}),
            ...(authoritative.manifest_path
              ? { manifest_path: authoritative.manifest_path }
              : {}),
          }
        : {};

    return {
      ...clip,
      render_status: authoritative.render_status,
      render_job_id: authoritative.render_job_id || null,
      render_error: authoritative.render_error || null,
      ...renderedFields,
    };
  });
}

function areClipListsEqual(left, right) {
  if (left === right) return true;
  if (
    !Array.isArray(left) ||
    !Array.isArray(right) ||
    left.length !== right.length
  )
    return false;
  return left.every(
    (clip, index) => JSON.stringify(clip) === JSON.stringify(right[index]),
  );
}

function formatDate(value) {
  if (!value) return "Unknown";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatAuditBody(value) {
  if (!value) return "";
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(value);
  }
}

function formatDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return "";
  const rounded = Math.round(total);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const STATUS_FILTER_STORAGE_PREFIX =
  "openshorts.project-library.status-filters:";

function statusFilterStorageKey(projectId) {
  return `${STATUS_FILTER_STORAGE_PREFIX}${projectId}`;
}

function readPersistedStatusFilters(projectId) {
  if (!projectId || typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(
      statusFilterStorageKey(projectId),
    );
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    const validStatuses = new Set(
      CLIP_WORKFLOW_STATUSES.map(({ value }) => value),
    );
    return [...new Set(parsed.filter((value) => validStatuses.has(value)))];
  } catch {
    return [];
  }
}

function persistStatusFilters(projectId, filters) {
  if (!projectId || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      statusFilterStorageKey(projectId),
      JSON.stringify(filters),
    );
  } catch {
    // Ignore storage quota and privacy-mode errors; filtering still works in memory.
  }
}

function normalizeClipForResultCard(clip, index, fallbackJobId) {
  const renderedVideoUrl =
    clip.video_url ||
    clip.url ||
    (clip.render_status === "ready" && clip.video_filename && fallbackJobId
      ? `/videos/${encodeURIComponent(fallbackJobId)}/${encodeURIComponent(
          clip.video_filename,
        )}`
      : "");
  const videoUrl = renderedVideoUrl || clip.source_video_url || "";
  const title =
    clip.video_title_for_youtube_short || clip.title || `Clip ${index + 1}`;
  const descriptionTiktok =
    clip.video_description_for_tiktok ||
    clip.tiktok_desc ||
    clip.description ||
    "";
  const descriptionInstagram =
    clip.video_description_for_instagram ||
    clip.insta_desc ||
    clip.description ||
    descriptionTiktok;
  const start = safeNumber(clip.start, 0);
  const inferredEnd = safeNumber(clip.end, NaN);
  const inferredDuration = safeNumber(clip.duration, NaN);
  const end = Number.isFinite(inferredEnd)
    ? inferredEnd
    : Number.isFinite(inferredDuration)
      ? inferredDuration
      : 30;

  return {
    ...clip,
    video_url: toProxiedVideoUrl(videoUrl),
    source_preview: !renderedVideoUrl && Boolean(clip.source_video_url),
    video_title_for_youtube_short: title,
    video_description_for_tiktok: descriptionTiktok,
    video_description_for_instagram: descriptionInstagram,
    title,
    start,
    end,
    job_id: clip.job_id || fallbackJobId || "project",
    index: Number.isInteger(clip.index) ? clip.index : index,
  };
}

export default function ProjectLibrary({
  aiProvider = "gemini",
  aiApiKey,
  getAiHeaders,
  projectId = null,
  editorClipIndex = null,
  editorOpen = false,
  versionId = null,
  onOpenProject,
  onBackToProjects,
  onOpenEditor,
  onCloseEditor,
  onVersionChange,
}) {
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectClips, setProjectClips] = useState([]);
  const [isLoadingClips, setIsLoadingClips] = useState(false);
  const [clipStatuses, setClipStatuses] = useState({});
  const [clipRenderJobs, setClipRenderJobs] = useState({});
  const [statusError, setStatusError] = useState("");
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [auditEvents, setAuditEvents] = useState([]);
  const [auditPolicy, setAuditPolicy] = useState(null);
  const [auditError, setAuditError] = useState("");
  const [savingStatusIndex, setSavingStatusIndex] = useState(null);
  const [webcamRegionSavingIndex, setWebcamRegionSavingIndex] = useState(null);
  const [webcamRegionErrors, setWebcamRegionErrors] = useState({});
  const [gameplayRegionSavingIndex, setGameplayRegionSavingIndex] =
    useState(null);
  const [gameplayRegionErrors, setGameplayRegionErrors] = useState({});
  const [gameplayZoomSavingIndex, setGameplayZoomSavingIndex] = useState(null);
  const [gameplayZoomErrors, setGameplayZoomErrors] = useState({});
  const [trackingSavingIndex, setTrackingSavingIndex] = useState(null);
  const [trackingErrors, setTrackingErrors] = useState({});
  const [statusFilters, setStatusFilters] = useState(() =>
    readPersistedStatusFilters(projectId),
  );
  const projectsRequestRef = useRef(null);

  const loadProjects = useCallback(() => {
    if (projectsRequestRef.current) return projectsRequestRef.current;

    const request = (async () => {
      setIsLoading(true);
      setError("");
      try {
        const res = await fetch(
          getApiUrl("/api/projects/history?limit=48&refresh=true"),
        );
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = await res.json();
        setProjects(Array.isArray(data.projects) ? data.projects : []);
      } catch (e) {
        setProjects([]);
        setError(e.message || "Failed to load projects");
      } finally {
        setIsLoading(false);
      }
    })();

    projectsRequestRef.current = request;
    request.then(
      () => {
        if (projectsRequestRef.current === request) {
          projectsRequestRef.current = null;
        }
      },
      () => {
        if (projectsRequestRef.current === request) {
          projectsRequestRef.current = null;
        }
      },
    );
    return request;
  }, []);

  useEffect(() => {
    loadProjects().catch(() => {});
  }, [loadProjects]);

  const loadProjectClips = useCallback(
    async (project, { showLoading = true } = {}) => {
      const jobId = project?.job_id || project?.session_id || project?.id;
      if (!jobId) {
        setProjectClips([]);
        return;
      }

      if (showLoading) setIsLoadingClips(true);
      try {
        const [clipsResult, statusResult] = await Promise.allSettled([
          fetch(
            getApiUrl(
              `/api/projects/clips/${encodeURIComponent(jobId)}?refresh=true`,
            ),
          ),
          fetch(getApiUrl(`/api/status/${encodeURIComponent(jobId)}`)),
        ]);
        if (clipsResult.status === "rejected") throw clipsResult.reason;
        const res = clipsResult.value;
        const statusRes =
          statusResult.status === "fulfilled" ? statusResult.value : null;
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = await res.json();
        let clips =
          Array.isArray(data.clips) &&
          (data.clips.length > 0 || !project.clips?.length)
            ? data.clips
            : Array.isArray(project.clips)
              ? project.clips
              : [];
        if (statusRes?.ok) {
          const statusPayload = await statusRes.json();
          setClipRenderJobs(activeClipRenderJobs(statusPayload?.clip_renders));
          clips = mergeAuthoritativeRenderStatuses(
            clips,
            statusPayload?.result?.clips,
          );
        }
        setProjectClips((current) =>
          areClipListsEqual(current, clips) ? current : clips,
        );
      } catch (e) {
        console.error("Error loading project clips:", e);
        if (showLoading) setProjectClips([]);
      } finally {
        if (showLoading) setIsLoadingClips(false);
      }
    },
    [],
  );

  const loadProjectStatuses = useCallback(async (project) => {
    const jobId = project?.job_id || project?.session_id || project?.id;
    if (!jobId) {
      setClipStatuses({});
      return;
    }

    setStatusError("");
    try {
      const res = await fetch(
        getApiUrl(`/api/projects/${encodeURIComponent(jobId)}/statuses`),
      );
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const payload = await res.json();
      setClipStatuses(
        payload.clips && typeof payload.clips === "object" ? payload.clips : {},
      );
    } catch (e) {
      console.error("Error loading project clip statuses:", e);
      setClipStatuses({});
      setStatusError(e.message || "Could not load clip statuses.");
    }
  }, []);

  const loadProjectAudit = useCallback(async (project) => {
    const jobId = project?.job_id || project?.session_id || project?.id;
    if (!jobId) {
      setAuditEvents([]);
      setAuditPolicy(null);
      return;
    }

    setIsLoadingAudit(true);
    setAuditError("");
    try {
      const res = await fetch(
        getApiUrl(`/api/projects/${encodeURIComponent(jobId)}/audit`),
      );
      if (!res.ok) throw new Error(await res.text());
      const payload = await res.json();
      setAuditEvents(Array.isArray(payload.events) ? payload.events : []);
      setAuditPolicy(payload.policy || null);
    } catch (e) {
      console.error("Error loading project audit timeline:", e);
      setAuditEvents([]);
      setAuditPolicy(null);
      setAuditError(e.message || "Could not load the processing timeline.");
    } finally {
      setIsLoadingAudit(false);
    }
  }, []);

  useEffect(() => {
    if (!projectId) {
      setSelectedProject(null);
      setProjectClips([]);
      setClipStatuses({});
      setStatusFilters([]);
      setClipRenderJobs({});
      setStatusError("");
      setIsAuditOpen(false);
      setAuditEvents([]);
      setAuditPolicy(null);
      setAuditError("");
      setWebcamRegionSavingIndex(null);
      setWebcamRegionErrors({});
      setGameplayRegionSavingIndex(null);
      setGameplayRegionErrors({});
      setGameplayZoomSavingIndex(null);
      setGameplayZoomErrors({});
      setTrackingSavingIndex(null);
      setTrackingErrors({});
      return;
    }

    const matchingProject = projects.find(
      (project) =>
        (project.job_id || project.session_id || project.id) === projectId,
    );
    if (!matchingProject) return;

    setSelectedProject(matchingProject);
    setProjectClips(
      Array.isArray(matchingProject.clips) ? matchingProject.clips : [],
    );
    setClipStatuses({});
    setStatusFilters(readPersistedStatusFilters(projectId));
    setClipRenderJobs({});
    setStatusError("");
    setIsAuditOpen(false);
    setAuditEvents([]);
    setAuditPolicy(null);
    setAuditError("");
    setWebcamRegionSavingIndex(null);
    setWebcamRegionErrors({});
    setGameplayRegionSavingIndex(null);
    setGameplayRegionErrors({});
    setGameplayZoomSavingIndex(null);
    setGameplayZoomErrors({});
    setTrackingSavingIndex(null);
    setTrackingErrors({});
    loadProjectClips(matchingProject);
  }, [loadProjectClips, projectId, projects]);

  const selectedProjectId =
    selectedProject?.job_id ||
    selectedProject?.session_id ||
    selectedProject?.id;

  useEffect(() => {
    persistStatusFilters(selectedProjectId, statusFilters);
  }, [selectedProjectId, statusFilters]);

  useEffect(() => {
    if (!selectedProject) {
      setClipStatuses({});
      return;
    }
    loadProjectStatuses(selectedProject).catch(() => {});
  }, [loadProjectStatuses, selectedProject]);

  const handleViewProject = (project) => {
    const id = project?.job_id || project?.session_id || project?.id;
    onOpenProject?.(id);
    setSelectedProject(project);
    setProjectClips(Array.isArray(project?.clips) ? project.clips : []);
    setClipStatuses({});
    setStatusFilters(readPersistedStatusFilters(id));
    setClipRenderJobs({});
    setStatusError("");
    setIsAuditOpen(false);
    setAuditEvents([]);
    setAuditPolicy(null);
    setAuditError("");
    setWebcamRegionSavingIndex(null);
    setWebcamRegionErrors({});
    setGameplayRegionSavingIndex(null);
    setGameplayRegionErrors({});
    setGameplayZoomSavingIndex(null);
    setGameplayZoomErrors({});
    setTrackingSavingIndex(null);
    setTrackingErrors({});
    loadProjectClips(project);
  };

  const handleOpenAudit = () => {
    setIsAuditOpen(true);
    loadProjectAudit(selectedProject).catch(() => {});
  };

  const handleProjectCardKeyDown = (event, project) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleViewProject(project);
    }
  };

  const handleDeleteProject = async (e, project) => {
    e.stopPropagation();
    if (
      !window.confirm(
        `Are you sure you want to delete project "${project.title || project.job_id}"?`,
      )
    ) {
      return;
    }

    try {
      const res = await fetch(
        getApiUrl(`/api/projects/${encodeURIComponent(project.job_id)}`),
        {
          method: "DELETE",
        },
      );
      if (!res.ok) {
        throw new Error(await res.text());
      }
      setProjects((prev) => prev.filter((p) => p.job_id !== project.job_id));
      if (selectedProject?.job_id === project.job_id) {
        setSelectedProject(null);
        onBackToProjects?.();
      }
    } catch (err) {
      console.error("Delete error:", err);
      alert("Failed to delete project: " + err.message);
    }
  };

  const normalizedProjectClips = projectClips.map((clip, index) =>
    normalizeClipForResultCard(
      clip,
      index,
      selectedProject?.job_id ||
        selectedProject?.session_id ||
        selectedProject?.id,
    ),
  );

  const statusForClip = (clip, index) => {
    const clipIndex = clip.index ?? index;
    return clipStatuses[String(clipIndex)]?.status || "not_reviewed";
  };

  const handleClipStatusChange = async (clipIndex, nextStatus) => {
    const key = String(clipIndex);
    const previous = clipStatuses[key];
    const jobId =
      selectedProject?.job_id ||
      selectedProject?.session_id ||
      selectedProject?.id;
    if (!jobId) return;

    setStatusError("");
    setClipStatuses((current) => ({
      ...current,
      [key]: { ...(current[key] || {}), status: nextStatus },
    }));
    setSavingStatusIndex(key);

    try {
      const response = await fetch(
        getApiUrl(
          `/api/projects/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipIndex)}/status`,
        ),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      setClipStatuses((current) => ({
        ...current,
        [key]: { status: payload.status, updated_at: payload.updated_at },
      }));
    } catch (error) {
      setClipStatuses((current) => {
        const restored = { ...current };
        if (previous) restored[key] = previous;
        else delete restored[key];
        return restored;
      });
      setStatusError(error.message || "Could not save clip status.");
    } finally {
      setSavingStatusIndex(null);
    }
  };

  const handleRenderClip = async (clipIndex) => {
    const jobId =
      selectedProject?.job_id ||
      selectedProject?.session_id ||
      selectedProject?.id;
    if (!jobId) return;

    try {
      const response = await fetch(
        getApiUrl(
          `/api/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipIndex)}/render`,
        ),
        {
          method: "POST",
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.detail || "Could not queue clip render");

      setClipRenderJobs((current) => ({
        ...current,
        [String(clipIndex)]: payload.job_id,
      }));
      setProjectClips((current) =>
        current.map((clip, index) => {
          const currentIndex = Number.isInteger(clip.index)
            ? clip.index
            : index;
          return currentIndex === clipIndex
            ? {
                ...clip,
                render_status: "queued",
                render_job_id: payload.job_id,
              }
            : clip;
        }),
      );
    } catch (error) {
      setProjectClips((current) =>
        current.map((clip, index) => {
          const currentIndex = Number.isInteger(clip.index)
            ? clip.index
            : index;
          return currentIndex === clipIndex
            ? { ...clip, render_status: "failed", render_error: error.message }
            : clip;
        }),
      );
    }
  };

  const handleSaveClipRange = async (clipIndex, range) => {
    const jobId =
      selectedProject?.job_id ||
      selectedProject?.session_id ||
      selectedProject?.id;
    if (!jobId) return false;
    try {
      const response = await fetch(
        getApiUrl(
          `/api/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipIndex)}/source-range`,
        ),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(range),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.detail || "Could not save clip range");
      const savedRange = {
        start: Number(payload.start),
        end: Number(payload.end),
      };
      const savedSubtitleFields = {};
      if (Array.isArray(payload.subtitle_tracks)) {
        savedSubtitleFields.subtitle_tracks = payload.subtitle_tracks;
      }
      if (Object.prototype.hasOwnProperty.call(payload, "subtitles")) {
        savedSubtitleFields.subtitles = payload.subtitles;
      }
      if (payload.layers && typeof payload.layers === "object") {
        savedSubtitleFields.layers = payload.layers;
      }
      setProjectClips((current) =>
        current.map((clip, index) => {
          const currentIndex = Number.isInteger(clip.index)
            ? clip.index
            : index;
          return currentIndex === clipIndex
            ? { ...clip, ...savedRange, ...savedSubtitleFields }
            : clip;
        }),
      );
      return savedRange;
    } catch (error) {
      return false;
    }
  };

  const handleSaveWebcamRegion = async (
    clipIndex,
    webcamRegion,
    facecamSize = "medium",
  ) => {
    const jobId =
      selectedProject?.job_id ||
      selectedProject?.session_id ||
      selectedProject?.id;
    if (!jobId) return false;
    const key = String(clipIndex);
    setWebcamRegionSavingIndex(key);
    setWebcamRegionErrors((current) => ({ ...current, [key]: "" }));
    try {
      const response = await fetch(
        getApiUrl(
          `/api/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipIndex)}/webcam-region`,
        ),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            webcam_region: webcamRegion,
            facecam_size: facecamSize,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.detail || "Could not save webcam area");
      const savedRegion = payload.webcam_region || webcamRegion;
      const savedFacecamSize = payload.facecam_size || facecamSize || "medium";
      setProjectClips((current) =>
        current.map((clip, index) => {
          const currentIndex = Number.isInteger(clip.index)
            ? clip.index
            : index;
          return currentIndex === clipIndex
            ? {
                ...clip,
                webcam_region: savedRegion,
                facecam_size: savedFacecamSize,
              }
            : clip;
        }),
      );
      return { webcam_region: savedRegion, facecam_size: savedFacecamSize };
    } catch (error) {
      setWebcamRegionErrors((current) => ({
        ...current,
        [key]: error.message || "Could not save webcam area.",
      }));
      return false;
    } finally {
      setWebcamRegionSavingIndex(null);
    }
  };

  const handleSaveGameplayRegion = async (clipIndex, gameplayRegion) => {
    const jobId =
      selectedProject?.job_id ||
      selectedProject?.session_id ||
      selectedProject?.id;
    if (!jobId) return false;
    const key = String(clipIndex);
    setGameplayRegionSavingIndex(key);
    setGameplayRegionErrors((current) => ({ ...current, [key]: "" }));
    try {
      const response = await fetch(
        getApiUrl(
          `/api/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipIndex)}/gameplay-region`,
        ),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameplay_region: gameplayRegion }),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.detail || "Could not save gameplay area");
      const savedRegion = payload.gameplay_region || gameplayRegion;
      setProjectClips((current) =>
        current.map((clip, index) => {
          const currentIndex = Number.isInteger(clip.index)
            ? clip.index
            : index;
          return currentIndex === clipIndex
            ? { ...clip, gameplay_region: savedRegion }
            : clip;
        }),
      );
      return savedRegion;
    } catch (error) {
      setGameplayRegionErrors((current) => ({
        ...current,
        [key]: error.message || "Could not save gameplay area.",
      }));
      return false;
    } finally {
      setGameplayRegionSavingIndex(null);
    }
  };

  const handleStreamerTrackingChange = async (clipIndex, enabled) => {
    const jobId =
      selectedProject?.job_id ||
      selectedProject?.session_id ||
      selectedProject?.id;
    if (!jobId) return false;
    const key = String(clipIndex);
    const previous =
      projectClips.find(
        (clip, index) =>
          (Number.isInteger(clip.index) ? clip.index : index) === clipIndex,
      )?.streamer_tracking_enabled === true;
    setTrackingSavingIndex(key);
    setTrackingErrors((current) => ({ ...current, [key]: "" }));
    setProjectClips((current) =>
      current.map((clip, index) => {
        const currentIndex = Number.isInteger(clip.index) ? clip.index : index;
        return currentIndex === clipIndex
          ? { ...clip, streamer_tracking_enabled: enabled === true }
          : clip;
      }),
    );
    try {
      const response = await fetch(
        getApiUrl(
          `/api/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipIndex)}/streamer-tracking`,
        ),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ streamer_tracking_enabled: enabled === true }),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.detail || "Could not save tracking setting");
      const savedValue = payload.streamer_tracking_enabled === true;
      setProjectClips((current) =>
        current.map((clip, index) => {
          const currentIndex = Number.isInteger(clip.index)
            ? clip.index
            : index;
          return currentIndex === clipIndex
            ? { ...clip, streamer_tracking_enabled: savedValue }
            : clip;
        }),
      );
      return savedValue;
    } catch (error) {
      setProjectClips((current) =>
        current.map((clip, index) => {
          const currentIndex = Number.isInteger(clip.index)
            ? clip.index
            : index;
          return currentIndex === clipIndex
            ? { ...clip, streamer_tracking_enabled: previous }
            : clip;
        }),
      );
      setTrackingErrors((current) => ({
        ...current,
        [key]: error.message || "Could not save tracking setting.",
      }));
      return false;
    } finally {
      setTrackingSavingIndex(null);
    }
  };

  const handleSaveGameplayZoom = async (clipIndex, gameplayZoom) => {
    const jobId =
      selectedProject?.job_id ||
      selectedProject?.session_id ||
      selectedProject?.id;
    if (!jobId) return false;
    const key = String(clipIndex);
    setGameplayZoomSavingIndex(key);
    setGameplayZoomErrors((current) => ({ ...current, [key]: "" }));
    try {
      const response = await fetch(
        getApiUrl(
          `/api/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipIndex)}/gameplay-zoom`,
        ),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameplay_zoom: gameplayZoom }),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.detail || "Could not save gameplay zoom");
      const savedZoom = Number.isFinite(Number(payload.gameplay_zoom))
        ? Number(payload.gameplay_zoom)
        : gameplayZoom;
      setProjectClips((current) =>
        current.map((clip, index) => {
          const currentIndex = Number.isInteger(clip.index)
            ? clip.index
            : index;
          return currentIndex === clipIndex
            ? { ...clip, gameplay_zoom: savedZoom }
            : clip;
        }),
      );
      return savedZoom;
    } catch (error) {
      setGameplayZoomErrors((current) => ({
        ...current,
        [key]: error.message || "Could not save gameplay zoom.",
      }));
      return false;
    } finally {
      setGameplayZoomSavingIndex(null);
    }
  };

  useEffect(() => {
    const entries = Object.entries(clipRenderJobs);
    if (!selectedProject || entries.length === 0) return undefined;

    let cancelled = false;
    let timer;
    const startedAt = Date.now();

    const finishClipRenders = async (finished) => {
      if (cancelled || finished.length === 0) return;

      const hasCompletedRender = finished.some(
        ({ payload }) => payload.status === "completed",
      );
      if (hasCompletedRender) {
        let refreshTimer;
        try {
          await Promise.race([
            loadProjectClips(selectedProject, { showLoading: false }),
            new Promise((resolve) => {
              refreshTimer = setTimeout(resolve, CLIP_RENDER_STATUS_TIMEOUT_MS);
            }),
          ]);
        } catch (error) {
          console.error("Project clip refresh after render failed:", error);
        }
        clearTimeout(refreshTimer);
      }
      if (cancelled) return;

      const failed = finished.filter(
        ({ payload }) => payload.status === "failed",
      );
      if (failed.length > 0) {
        setProjectClips((current) =>
          current.map((clip, index) => {
            const currentIndex = Number.isInteger(clip.index)
              ? clip.index
              : index;
            const failedRender = failed.find(
              ({ clipIndex }) => Number(clipIndex) === currentIndex,
            );
            return failedRender
              ? {
                  ...clip,
                  render_status: "failed",
                  render_error:
                    failedRender.payload.error || "Clip render failed",
                }
              : clip;
          }),
        );
      }
      setClipRenderJobs((current) => {
        const next = { ...current };
        finished.forEach(({ clipIndex }) => delete next[clipIndex]);
        return next;
      });
    };

    const pollClipRenders = async () => {
      if (Date.now() - startedAt >= CLIP_RENDER_MAX_POLL_DURATION_MS) {
        await finishClipRenders(
          entries.map(([clipIndex]) => ({
            clipIndex,
            payload: {
              status: "failed",
              error: "Render status polling timed out.",
            },
          })),
        );
        return;
      }

      const finished = [];
      await Promise.all(
        entries.map(async ([clipIndex, renderJobId]) => {
          const controller =
            typeof AbortController === "function"
              ? new AbortController()
              : null;
          let timeoutId;
          try {
            const statusRequest = (async () => {
              const response = await fetch(
                getApiUrl(`/api/status/${encodeURIComponent(renderJobId)}`),
                controller ? { signal: controller.signal } : undefined,
              );
              const payload = response.ok ? await response.json() : null;
              return { response, payload };
            })();
            const { response, payload } = await Promise.race([
              statusRequest,
              new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                  controller?.abort();
                  reject(new Error("Render status request timed out."));
                }, CLIP_RENDER_STATUS_TIMEOUT_MS);
              }),
            ]);
            if (!response.ok) {
              if (response.status === 404) {
                finished.push({
                  clipIndex,
                  payload: {
                    status: "failed",
                    error: "Render job no longer exists.",
                  },
                });
              }
              return;
            }
            if (payload.status === "completed" || payload.status === "failed") {
              finished.push({ clipIndex, payload });
            }
          } catch (error) {
            if (error?.name !== "AbortError") {
              console.error("Render status request failed; retrying:", error);
            }
          } finally {
            clearTimeout(timeoutId);
          }
        }),
      );

      if (cancelled) return;
      if (finished.length > 0) {
        await finishClipRenders(finished);
        return;
      }

      timer = setTimeout(
        () => pollClipRenders().catch(() => {}),
        CLIP_RENDER_POLL_INTERVAL_MS,
      );
    };

    pollClipRenders().catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [clipRenderJobs, loadProjectClips, selectedProject]);

  const statusSummary = CLIP_WORKFLOW_STATUSES.map(({ value, label }) => {
    const count = normalizedProjectClips.filter(
      (clip, index) => statusForClip(clip, index) === value,
    ).length;
    return count ? `${count} ${label.toLowerCase()}` : null;
  })
    .filter(Boolean)
    .join(" · ");

  const filteredProjectClips = normalizedProjectClips.filter((clip, index) => {
    if (statusFilters.length === 0) return true;
    return statusFilters.includes(statusForClip(clip, index));
  });

  const filteredProjects = projects.filter((project) => {
    const haystack = [
      project.job_id,
      project.title,
      project.description,
      project.created_at,
      String(project.clip_count || ""),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  if (selectedProject) {
    return (
      <div className="h-full min-h-0 overflow-y-auto custom-scrollbar">
        <div className="max-w-[1680px] mx-auto p-4 sm:p-5 pb-8 space-y-4">
          {/* Header Navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => onBackToProjects?.()}
              className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors group text-sm"
            >
              <ChevronLeft
                size={16}
                className="group-hover:-translate-x-1 transition-transform"
              />
              Back to Projects
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenAudit}
                aria-label="Open processing timeline"
                title="Open processing timeline"
                className="p-1.5 rounded-lg border border-amber-400/20 bg-amber-400/5 hover:bg-amber-400/15 text-amber-300 transition-colors"
              >
                <Clock size={15} />
              </button>
              <button
                onClick={loadProjects}
                className="px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-zinc-300 flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw
                  size={13}
                  className={isLoading ? "animate-spin" : ""}
                />
                Refresh
              </button>
              <button
                onClick={(e) => handleDeleteProject(e, selectedProject)}
                className="px-2.5 py-1.5 rounded-lg border border-red-500/20 bg-red-500/5 hover:bg-red-500/20 text-xs text-red-400 flex items-center gap-1.5 transition-colors"
              >
                <Trash2 size={13} />
                Delete
              </button>
            </div>
          </div>

          {/* Project Header Card */}
          <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-white/[0.08] bg-gradient-to-br from-white/[0.03] via-zinc-900/60 to-black/80 backdrop-blur-xl relative overflow-hidden shadow-xl space-y-3">
            {/* Ambient background glow */}
            <div className="absolute top-0 right-0 -mt-10 -mr-10 w-64 h-64 bg-cyan-500/[0.05] rounded-full blur-3xl pointer-events-none" />

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 relative z-10">
              {/* Title and ID */}
              <div className="min-w-0 flex-1 flex items-center gap-2.5 flex-wrap">
                <h1
                  className="text-lg sm:text-xl font-bold text-white tracking-tight leading-snug line-clamp-1"
                  title={selectedProject.title || "Untitled Project"}
                >
                  {selectedProject.title || "Untitled Project"}
                </h1>
                <span className="font-mono text-[11px] text-zinc-400 bg-black/50 border border-white/10 px-2 py-0.5 rounded-md select-all shrink-0">
                  {selectedProject.job_id}
                </span>
              </div>

              {/* Metadata Badges Strip */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] shadow-sm">
                  <Film size={14} className="text-cyan-400 shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold leading-none mb-0.5">
                      Clips
                    </span>
                    <span className="text-xs font-bold text-white leading-none">
                      {projectClips.length}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] shadow-sm">
                  <Calendar size={14} className="text-purple-400 shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold leading-none mb-0.5">
                      Created
                    </span>
                    <span className="text-xs font-bold text-white leading-none">
                      {formatDate(selectedProject.created_at).split(",")[0]}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] shadow-sm">
                  <Clock size={14} className="text-amber-400 shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold leading-none mb-0.5">
                      Duration
                    </span>
                    <span className="text-xs font-bold text-white leading-none">
                      {formatDuration(
                        selectedProject.source_duration_seconds ||
                          selectedProject.total_duration,
                      ) || "N/A"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] shadow-sm">
                  <HardDrive size={14} className="text-blue-400 shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold leading-none mb-0.5">
                      Source
                    </span>
                    <span className="text-xs font-bold text-white leading-none">
                      S3 History
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Workflow Pipeline Status Strip */}
            <div className="flex items-center gap-1.5 pt-2.5 border-t border-white/[0.06] flex-wrap text-xs relative z-10">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mr-1">
                Pipeline:
              </span>
              {CLIP_WORKFLOW_STATUSES.map(({ value, label, className }) => {
                const count = normalizedProjectClips.filter(
                  (clip, index) => statusForClip(clip, index) === value,
                ).length;
                if (!count) return null;
                return (
                  <span
                    key={value}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${className}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                    <strong>{count}</strong>
                    <span>{label}</span>
                  </span>
                );
              })}
              <span className="sr-only">{statusSummary || "No clips yet"}</span>
            </div>

            {selectedProject.description && (
              <div className="p-2.5 rounded-lg bg-black/30 border border-white/5 text-xs text-zinc-400 leading-relaxed italic max-w-3xl">
                "{selectedProject.description}"
              </div>
            )}

            {statusError && (
              <div
                role="alert"
                className="rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 text-xs text-red-200"
              >
                {statusError}
              </div>
            )}
          </div>

          {/* Clips Gallery */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">Generated Clips</h3>
              <span className="text-sm text-zinc-500 font-medium px-3 py-1 rounded-full bg-white/5 border border-white/5">
                {projectClips.length} results
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 bg-white/[0.02] border border-white/5 p-3 rounded-2xl">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setStatusFilters([])}
                  aria-pressed={statusFilters.length === 0}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    statusFilters.length === 0
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm"
                      : "bg-white/5 text-zinc-400 hover:text-white border border-transparent hover:border-white/10"
                  }`}
                >
                  All ({normalizedProjectClips.length})
                </button>
                {CLIP_WORKFLOW_STATUSES.map(({ value, label }) => {
                  const count = normalizedProjectClips.filter(
                    (clip, idx) => statusForClip(clip, idx) === value,
                  ).length;
                  return (
                    <button
                      key={value}
                      onClick={() =>
                        setStatusFilters((current) =>
                          current.includes(value)
                            ? current.filter((selected) => selected !== value)
                            : [...current, value],
                        )
                      }
                      aria-pressed={statusFilters.includes(value)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        statusFilters.includes(value)
                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm"
                          : "bg-white/5 text-zinc-400 hover:text-white border border-transparent hover:border-white/10"
                      }`}
                    >
                      {label} ({count})
                    </button>
                  );
                })}
              </div>
              <span className="text-xs text-zinc-500 font-medium">
                {filteredProjectClips.length}{" "}
                {filteredProjectClips.length === 1 ? "clip" : "clips"}
              </span>
            </div>

            {isLoadingClips ? (
              <div className="glass-panel py-24 flex flex-col items-center justify-center text-zinc-500">
                <Loader2
                  size={40}
                  className="animate-spin text-cyan-500 mb-4"
                />
                <p className="text-lg font-medium">Loading project clips...</p>
              </div>
            ) : filteredProjectClips.length === 0 ? (
              <div className="glass-panel py-20 flex flex-col items-center justify-center border-2 border-dashed border-white/5 text-zinc-600 rounded-2xl">
                <Play size={40} className="mb-3 opacity-20" />
                <p className="text-sm font-medium">
                  No clips found matching this filter
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredProjectClips.map((clip, index) => (
                  <ResultCard
                    key={
                      clip.video_id ||
                      `${clip.job_id || "clip"}-${clip.index ?? index}`
                    }
                    clip={clip}
                    index={clip.index ?? index}
                    jobId={clip.job_id}
                    aiProvider={aiProvider}
                    aiApiKey={aiApiKey}
                    getAiHeaders={getAiHeaders}
                    onPlay={() => {}}
                    workflowStatus={statusForClip(clip, index)}
                    workflowStatusSaving={
                      savingStatusIndex === String(clip.index ?? index)
                    }
                    onWorkflowStatusChange={(nextStatus) =>
                      handleClipStatusChange(clip.index ?? index, nextStatus)
                    }
                    editorOpen={
                      editorOpen && (clip.index ?? index) === editorClipIndex
                    }
                    editorVersionId={versionId}
                    onEditorOpen={() =>
                      onOpenEditor?.(
                        selectedProject.job_id ||
                          selectedProject.session_id ||
                          selectedProject.id,
                        clip.index ?? index,
                        versionId,
                      )
                    }
                    onEditorClose={onCloseEditor}
                    onEditorVersionChange={onVersionChange}
                    onRenderClip={handleRenderClip}
                    onSaveClipRange={handleSaveClipRange}
                    renderStatus={clip.render_status}
                    renderError={clip.render_error}
                    onSaveWebcamRegion={handleSaveWebcamRegion}
                    webcamRegionSaving={
                      webcamRegionSavingIndex === String(clip.index ?? index)
                    }
                    webcamRegionError={
                      webcamRegionErrors[String(clip.index ?? index)]
                    }
                    onSaveGameplayRegion={handleSaveGameplayRegion}
                    gameplayRegionSaving={
                      gameplayRegionSavingIndex === String(clip.index ?? index)
                    }
                    gameplayRegionError={
                      gameplayRegionErrors[String(clip.index ?? index)]
                    }
                    onSaveGameplayZoom={handleSaveGameplayZoom}
                    gameplayZoomSaving={
                      gameplayZoomSavingIndex === String(clip.index ?? index)
                    }
                    gameplayZoomError={
                      gameplayZoomErrors[String(clip.index ?? index)]
                    }
                    onStreamerTrackingChange={handleStreamerTrackingChange}
                    trackingSaving={
                      trackingSavingIndex === String(clip.index ?? index)
                    }
                    trackingError={trackingErrors[String(clip.index ?? index)]}
                    masterDuration={
                      selectedProject?.source_duration_seconds ||
                      clip.master_duration ||
                      clip.source_duration_seconds
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        {isAuditOpen && (
          <div className="fixed inset-0 z-50" role="presentation">
            <button
              aria-label="Close processing timeline"
              className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
              onClick={() => setIsAuditOpen(false)}
            />
            <aside
              className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-white/10 bg-[#101216] shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="processing-timeline-title"
            >
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 bg-[#101216] p-5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
                    Run auditor
                  </p>
                  <h2
                    id="processing-timeline-title"
                    className="mt-1 text-xl font-bold text-white"
                  >
                    Processing timeline
                  </h2>
                  <p className="mt-1 max-w-sm truncate font-mono text-[11px] text-zinc-500">
                    {selectedProjectId}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => loadProjectAudit(selectedProject)}
                    aria-label="Refresh processing timeline"
                    title="Refresh timeline"
                    className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <RefreshCw
                      size={16}
                      className={isLoadingAudit ? "animate-spin" : ""}
                    />
                  </button>
                  <button
                    onClick={() => setIsAuditOpen(false)}
                    aria-label="Close processing timeline"
                    className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div
                data-testid="audit-scroll-region"
                className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5"
              >
                {auditPolicy && (
                  <div className="rounded-xl border border-amber-300/15 bg-amber-300/5 p-3 text-xs text-zinc-400">
                    <p className="font-semibold text-amber-200">
                      Body capture policy
                    </p>
                    <p className="mt-1 leading-5">
                      Full redacted bodies are retained for allowlisted hosts;
                      binary and other hosts remain metadata-only. No body
                      truncation is applied.
                    </p>
                    <p className="mt-2 break-words font-mono text-[10px] text-zinc-500">
                      Hosts: {auditPolicy.body_allowlist?.join(", ") || "none"}
                    </p>
                  </div>
                )}

                {isLoadingAudit ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-20 text-zinc-500">
                    <Loader2
                      size={28}
                      className="animate-spin text-amber-300"
                    />
                    <p className="text-sm">Loading audit events...</p>
                  </div>
                ) : auditError ? (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200"
                  >
                    {auditError}
                  </div>
                ) : auditEvents.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">
                    No audit events captured yet. New processing runs will
                    appear here.
                  </div>
                ) : (
                  <div className="relative space-y-3">
                    <div className="absolute bottom-3 left-[15px] top-3 w-px bg-white/10" />
                    {auditEvents.map((event) => {
                      const StatusIcon =
                        event.status === "failed" ? AlertCircle : CheckCircle2;
                      const hasDetails =
                        Boolean(event.request_body) ||
                        Boolean(event.response_body) ||
                        (event.metadata &&
                          Object.keys(event.metadata).length > 0);
                      return (
                        <div
                          key={event.id || `${event.sequence}-${event.name}`}
                          className="relative rounded-xl border border-white/10 bg-white/[0.03] p-3 pl-10"
                        >
                          <StatusIcon
                            size={18}
                            className={`absolute left-1.5 top-3.5 z-10 bg-[#101216] ${
                              event.status === "failed"
                                ? "text-red-300"
                                : "text-emerald-300"
                            }`}
                          />
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="break-words text-sm font-semibold text-white">
                                {event.name || "Unnamed step"}
                              </p>
                              <p className="mt-1 text-[11px] text-zinc-500">
                                {event.category || "processing"}
                                {event.provider ? ` · ${event.provider}` : ""}
                                {event.started_at
                                  ? ` · ${formatDate(event.started_at)}`
                                  : ""}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                                event.status === "failed"
                                  ? "bg-red-400/10 text-red-200"
                                  : "bg-emerald-400/10 text-emerald-200"
                              }`}
                            >
                              {event.status || "unknown"}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                            {event.host && (
                              <span className="font-mono">
                                {event.method || ""} {event.host}
                                {event.path || ""}
                              </span>
                            )}
                            {event.duration_ms > 0 && (
                              <span>{event.duration_ms} ms</span>
                            )}
                            {event.http_status > 0 && (
                              <span>HTTP {event.http_status}</span>
                            )}
                            {(event.request_bytes > 0 ||
                              event.response_bytes > 0) && (
                              <span>
                                {event.request_bytes || 0} B in ·{" "}
                                {event.response_bytes || 0} B out
                              </span>
                            )}
                          </div>
                          {event.error && (
                            <p className="mt-2 break-words text-xs text-red-200">
                              {event.error}
                            </p>
                          )}
                          {hasDetails && (
                            <details className="mt-3 border-t border-white/5 pt-2">
                              <summary className="cursor-pointer text-xs font-semibold text-zinc-300 hover:text-white">
                                Inspect captured details
                              </summary>
                              <div className="mt-3 space-y-3">
                                {event.request_body && (
                                  <div>
                                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                                      Request body
                                    </p>
                                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-3 font-mono text-[11px] leading-5 text-zinc-300">
                                      {formatAuditBody(event.request_body)}
                                    </pre>
                                  </div>
                                )}
                                {event.response_body && (
                                  <div>
                                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                                      Response body
                                    </p>
                                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-3 font-mono text-[11px] leading-5 text-zinc-300">
                                      {formatAuditBody(event.response_body)}
                                    </pre>
                                  </div>
                                )}
                                {event.metadata &&
                                  Object.keys(event.metadata).length > 0 && (
                                    <div>
                                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                                        Metadata
                                      </p>
                                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-3 font-mono text-[11px] leading-5 text-zinc-300">
                                        {JSON.stringify(
                                          event.metadata,
                                          null,
                                          2,
                                        )}
                                      </pre>
                                    </div>
                                  )}
                              </div>
                            </details>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto custom-scrollbar">
      <div className="max-w-7xl mx-auto p-6 pb-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <FolderOpen size={20} className="text-cyan-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  Projects
                </h1>
                <p className="text-sm text-zinc-500">
                  Historical clip-generation jobs rendered the same way as the
                  clip generator.
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={loadProjects}
            className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm text-zinc-300 flex items-center gap-2 transition-colors"
          >
            <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        <div className="glass-panel p-4 flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-2 text-zinc-500">
            <Search size={14} />
            <span className="text-xs uppercase tracking-widest">Search</span>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="input-field flex-1 text-sm"
          />
        </div>

        {error && (
          <div className="glass-panel p-4 border border-red-500/20 bg-red-500/5 text-red-200 text-sm">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="glass-panel p-20 flex flex-col items-center justify-center gap-4 text-zinc-500">
            <Loader2 size={32} className="animate-spin text-cyan-400" />
            <p>Loading your projects...</p>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="glass-panel p-20 text-center text-zinc-500 border-2 border-dashed border-white/5">
            <FolderOpen size={48} className="mx-auto mb-4 opacity-10" />
            <p>No projects found matching your search.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredProjects.map((project) => {
              const previewVideoUrl = toProxiedVideoUrl(
                project.clips?.[0]?.url ||
                  project.clips?.[0]?.video_url ||
                  project.clips?.[0]?.source_video_url ||
                  "",
              );

              return (
                <div
                  key={project.job_id}
                  onClick={() => handleViewProject(project)}
                  onKeyDown={(event) =>
                    handleProjectCardKeyDown(event, project)
                  }
                  role="button"
                  tabIndex={0}
                  className="group glass-panel p-3 cursor-pointer hover:border-cyan-500/30 transition-all active:scale-[0.98] text-left"
                >
                  <div className="aspect-[9/16] rounded-lg overflow-hidden bg-white/5 mb-3 border border-white/5 relative">
                    {previewVideoUrl ? (
                      <video
                        src={previewVideoUrl}
                        muted
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-700">
                        <FolderOpen size={32} />
                      </div>
                    )}
                    <button
                      onClick={(e) => handleDeleteProject(e, project)}
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-zinc-400 hover:bg-red-500 hover:text-white flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 z-10"
                      title="Delete Project"
                    >
                      <Trash2 size={14} />
                    </button>
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-xs font-bold text-white bg-cyan-500 px-3 py-1.5 rounded-full shadow-xl">
                        VIEW CLIPS
                      </span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-white truncate group-hover:text-cyan-400 transition-colors">
                      {project.title || "Untitled Project"}
                    </h3>
                    <div className="flex items-center justify-between mt-1 gap-2">
                      <span className="text-[10px] text-zinc-500 truncate">
                        {formatDate(project.created_at)}
                      </span>
                      <span className="text-[10px] text-zinc-400 font-medium px-2 py-0.5 rounded bg-white/5 border border-white/5 whitespace-nowrap">
                        {project.clip_count || project.clips?.length || 0} CLIPS
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-2 truncate">
                      {project.job_id}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
