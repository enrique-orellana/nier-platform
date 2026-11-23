import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  Clock,
  ExternalLink,
  Filter,
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
import { useRenewableMediaUrl } from "../lib/videoUrls";
import { CLIP_WORKFLOW_STATUSES } from "./clipWorkflowStatuses";
import ResultCard from "./ResultCard";
import SourceTranscriptEditor from "./editor/SourceTranscriptEditor";
import {
  Button,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  Separator,
} from "./ui";

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

function formatSourceUploadDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`;
  }
  return raw || "Unknown";
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

function EditorLoadingScreen() {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/95 text-foreground"
      role="status"
      aria-label="Loading editor"
      aria-live="polite"
    >
      <Card className="w-[calc(100%-2rem)] max-w-sm">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-muted-foreground">
          <Loader2
            className="size-8 animate-spin text-primary"
            aria-hidden="true"
          />
          <span className="text-sm">Loading editor...</span>
        </CardContent>
      </Card>
    </div>
  );
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
    video_url: videoUrl,
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

function ProjectPreviewVideo({ src }) {
  const { url, refresh } = useRenewableMediaUrl(src);
  return (
    <video
      src={url}
      muted
      playsInline
      preload="metadata"
      onError={() => void refresh()}
      className="w-full h-full object-cover"
    />
  );
}

export default function ProjectLibrary({
  aiProvider = "gemini",
  aiApiKey,
  getAiHeaders,
  projectId = null,
  editorClipIndex = null,
  editorOpen = false,
  fullVideoEditorOpen = false,
  versionId = null,
  onOpenProject,
  onBackToProjects,
  onOpenEditor,
  onCloseEditor,
  onOpenFullVideoEditor,
  onCloseFullVideoEditor,
  onVersionChange,
}) {
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectClips, setProjectClips] = useState([]);
  const [localSourceEditorOpen, setLocalSourceEditorOpen] = useState(false);
  const [isLoadingClips, setIsLoadingClips] = useState(false);
  const [clipStatuses, setClipStatuses] = useState({});
  const [clipRenderJobs, setClipRenderJobs] = useState({});
  const [statusError, setStatusError] = useState("");
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [isSourceMetadataOpen, setIsSourceMetadataOpen] = useState(false);
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
  const sourceEditorOpen = fullVideoEditorOpen || localSourceEditorOpen;

  const openFullVideoEditor = () => {
    if (onOpenFullVideoEditor) onOpenFullVideoEditor(selectedProjectId);
    else setLocalSourceEditorOpen(true);
  };

  const closeFullVideoEditor = () => {
    setLocalSourceEditorOpen(false);
    onCloseFullVideoEditor?.();
  };

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
      setLocalSourceEditorOpen(false);
      setClipStatuses({});
      setStatusFilters([]);
      setClipRenderJobs({});
      setStatusError("");
      setIsAuditOpen(false);
      setIsSourceMetadataOpen(false);
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
    setLocalSourceEditorOpen(false);
    setProjectClips(
      Array.isArray(matchingProject.clips) ? matchingProject.clips : [],
    );
    setClipStatuses({});
    setStatusFilters(readPersistedStatusFilters(projectId));
    setClipRenderJobs({});
    setStatusError("");
    setIsAuditOpen(false);
    setIsSourceMetadataOpen(false);
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
  const hasFullSourceVideo = projectClips.some((clip) =>
    Boolean(clip.source_video_url),
  );
  const fullSourceDuration = Number(
    selectedProject?.source_duration_seconds ||
      projectClips.find((clip) => Number(clip.master_duration) > 0)
        ?.master_duration ||
      0,
  );
  const canEditFullVideo =
    Boolean(selectedProjectId) && hasFullSourceVideo && fullSourceDuration > 0;

  const sourceMetadata =
    selectedProject?.source_metadata &&
    typeof selectedProject.source_metadata === "object"
      ? selectedProject.source_metadata
      : null;
  const hasSourceMetadata =
    sourceMetadata && Object.keys(sourceMetadata).length > 0;

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
    setLocalSourceEditorOpen(false);
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

  const editorClipReady = normalizedProjectClips.some(
    (clip, index) => (clip.index ?? index) === editorClipIndex,
  );
  const isDirectEditorLoading =
    editorOpen && (isLoading || !selectedProject || !editorClipReady);

  if (isDirectEditorLoading) return <EditorLoadingScreen />;

  if (selectedProject) {
    return (
      <div className="h-full min-h-0 overflow-y-auto custom-scrollbar">
        {sourceEditorOpen && selectedProjectId && (
          <SourceTranscriptEditor
            projectId={selectedProjectId}
            onClose={closeFullVideoEditor}
          />
        )}
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-8 md:px-8 md:py-10 xl:px-10">
          {/* Header Navigation */}
          <header className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="ghost"
              type="button"
              onClick={() => onBackToProjects?.()}
              className="-ml-3 text-muted-foreground"
            >
              <ChevronLeft className="size-4" />
              Back to Projects
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                type="button"
                onClick={handleOpenAudit}
                aria-label="Open processing timeline"
                title="Open processing timeline"
              >
                <Clock className="size-4" />
              </Button>
              {hasSourceMetadata && (
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={() => setIsSourceMetadataOpen(true)}
                  aria-label="View source details"
                  title="View all source metadata"
                >
                  <Info className="size-4" />
                </Button>
              )}
              <Button variant="outline" type="button" onClick={loadProjects}>
                <RefreshCw
                  className={`size-4 ${isLoading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
              <Button
                variant="destructive"
                type="button"
                onClick={(e) => handleDeleteProject(e, selectedProject)}
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            </div>
          </header>

          {/* Project Header Card */}
          <Card>
            <CardHeader className="space-y-3 p-5 sm:p-6">
              <div className="min-w-0 space-y-2">
                <h1
                  className="break-words text-2xl font-semibold tracking-tight"
                  title={selectedProject.title || "Untitled Project"}
                >
                  {selectedProject.title || "Untitled Project"}
                </h1>
                <Badge
                  variant="outline"
                  className="max-w-full break-all font-mono"
                >
                  {selectedProject.job_id}
                </Badge>
              </div>
              {selectedProject.description && (
                <CardDescription className="max-w-3xl leading-relaxed">
                  {selectedProject.description}
                </CardDescription>
              )}
            </CardHeader>

            <CardContent className="space-y-5 px-5 pb-5 sm:px-6 sm:pb-6">
              <Separator />

              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                <div className="space-y-1">
                  <dt className="text-sm text-muted-foreground">Clips</dt>
                  <dd className="flex items-center gap-2 text-sm font-medium">
                    <Film className="size-4 text-muted-foreground" />
                    {projectClips.length}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-sm text-muted-foreground">Created</dt>
                  <dd className="flex items-center gap-2 text-sm font-medium">
                    <Calendar className="size-4 text-muted-foreground" />
                    {formatDate(selectedProject.created_at).split(",")[0]}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-sm text-muted-foreground">
                    Source duration
                  </dt>
                  <dd className="flex items-center gap-2 text-sm font-medium">
                    <Clock className="size-4 text-muted-foreground" />
                    {formatDuration(
                      selectedProject.source_duration_seconds ||
                        selectedProject.total_duration,
                    ) || "N/A"}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-sm text-muted-foreground">Storage</dt>
                  <dd className="flex items-center gap-2 text-sm font-medium">
                    <HardDrive className="size-4 text-muted-foreground" />
                    S3 History
                  </dd>
                </div>
              </dl>

              <Separator />

              <section
                aria-labelledby="project-processing-status"
                className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <p
                  id="project-processing-status"
                  className="text-sm font-medium"
                >
                  Processing status
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {CLIP_WORKFLOW_STATUSES.map(({ value, label }) => {
                    const count = normalizedProjectClips.filter(
                      (clip, index) => statusForClip(clip, index) === value,
                    ).length;
                    if (!count) return null;
                    return (
                      <Badge
                        key={value}
                        variant="secondary"
                        className="gap-1.5"
                      >
                        <span className="size-1.5 rounded-full bg-primary" />
                        <strong className="font-semibold">{count}</strong>
                        <span>{label}</span>
                      </Badge>
                    );
                  })}
                </div>
                <span className="sr-only">
                  {statusSummary || "No clips yet"}
                </span>
              </section>

              {statusError && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  {statusError}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Clips Gallery */}
          <section
            aria-labelledby="generated-clips-heading"
            className="space-y-4"
          >
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle id="generated-clips-heading" className="text-xl">
                  Generated Clips
                </CardTitle>
                <CardDescription>
                  Review status and edit the clips from this project.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={openFullVideoEditor}
                  disabled={!canEditFullVideo}
                  title={
                    canEditFullVideo
                      ? "Open the full source video and transcript"
                      : "The full source video or its duration is unavailable for this project."
                  }
                >
                  <Film className="size-4" />
                  Edit full video
                </Button>
                {!canEditFullVideo && (
                  <span className="max-w-40 text-xs text-muted-foreground">
                    Full source video or duration unavailable
                  </span>
                )}
              </div>
            </header>

            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <p className="text-sm font-medium">Clip status</p>
                <div className="flex flex-wrap items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        aria-label="Filter clips by status"
                      >
                        <Filter className="size-4" />
                        Filter status
                        {statusFilters.length > 0 && (
                          <Badge variant="secondary">
                            {statusFilters.length}
                          </Badge>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
                      <DropdownMenuCheckboxItem
                        checked={statusFilters.length === 0}
                        onCheckedChange={() => setStatusFilters([])}
                      >
                        All statuses ({normalizedProjectClips.length})
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuSeparator />
                      {CLIP_WORKFLOW_STATUSES.map(({ value, label }) => {
                        const count = normalizedProjectClips.filter(
                          (clip, idx) => statusForClip(clip, idx) === value,
                        ).length;
                        const isSelected = statusFilters.includes(value);

                        return (
                          <DropdownMenuCheckboxItem
                            key={value}
                            checked={isSelected}
                            disabled={count === 0 && !isSelected}
                            onCheckedChange={(checked) =>
                              setStatusFilters((current) =>
                                checked
                                  ? [...current, value]
                                  : current.filter(
                                      (selected) => selected !== value,
                                    ),
                              )
                            }
                          >
                            {label} ({count})
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Badge variant="outline">
                    {filteredProjectClips.length}{" "}
                    {filteredProjectClips.length === 1 ? "clip" : "clips"}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {isLoadingClips ? (
              <Card>
                <CardContent
                  className="flex min-h-64 flex-col items-center justify-center gap-4 text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2 className="size-8 animate-spin text-primary" />
                  <p>Loading project clips...</p>
                </CardContent>
              </Card>
            ) : filteredProjectClips.length === 0 ? (
              <Card className="border-dashed shadow-none">
                <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
                  <Play className="size-8 text-muted-foreground" />
                  <CardDescription>
                    No clips found matching this filter
                  </CardDescription>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredProjectClips.map((clip, index) => (
                  <ResultCard
                    key={
                      clip.video_id ||
                      `${clip.job_id || "clip"}-${clip.index ?? index}`
                    }
                    clip={clip}
                    layout={
                      filteredProjectClips.length === 1 ? "single" : "grid"
                    }
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
          </section>
        </main>
        {isSourceMetadataOpen && sourceMetadata && (
          <Dialog
            open={isSourceMetadataOpen}
            onOpenChange={(open) => !open && setIsSourceMetadataOpen(false)}
          >
            <DialogContent
              showClose={false}
              closeOnEscape={false}
              className="flex max-h-[min(90vh,900px)] w-[calc(100%-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0"
            >
              <DialogHeader className="flex shrink-0 flex-row items-start justify-between gap-4 border-b p-6 text-left sm:text-left">
                <div className="min-w-0">
                  <Badge variant="outline">Source metadata</Badge>
                  <DialogTitle className="mt-3 truncate text-xl">
                    Source details
                  </DialogTitle>
                  <DialogDescription className="mt-2">
                    Complete information from the original source.
                  </DialogDescription>
                </div>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setIsSourceMetadataOpen(false)}
                  aria-label="Close source details"
                >
                  <X className="size-4" />
                </Button>
              </DialogHeader>

              <div className="min-h-0 space-y-5 overflow-y-auto p-6">
                <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                  <Card className="overflow-hidden shadow-none">
                    {sourceMetadata.thumbnail ? (
                      <img
                        src={String(sourceMetadata.thumbnail)}
                        alt={String(sourceMetadata.title || "Source thumbnail")}
                        className="aspect-video h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-video items-center justify-center text-muted-foreground">
                        <FolderOpen className="size-7" />
                      </div>
                    )}
                  </Card>
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {sourceMetadata.platform && (
                        <Badge variant="secondary">
                          {String(sourceMetadata.platform)}
                        </Badge>
                      )}
                      {sourceMetadata.channel && (
                        <CardDescription>
                          {String(sourceMetadata.channel)}
                        </CardDescription>
                      )}
                    </div>
                    <CardTitle className="text-lg leading-snug">
                      {String(sourceMetadata.title || "Untitled source")}
                    </CardTitle>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {String(
                        sourceMetadata.description ||
                          "No description available.",
                      )}
                    </p>
                    {sourceMetadata.webpage_url && (
                      <a
                        href={String(sourceMetadata.webpage_url)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
                      >
                        Open source page
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  {[
                    [
                      "Views",
                      Number(sourceMetadata.view_count || 0).toLocaleString(),
                    ],
                    [
                      "Duration",
                      formatDuration(sourceMetadata.duration) || "Unknown",
                    ],
                    [
                      "Upload date",
                      formatSourceUploadDate(sourceMetadata.upload_date),
                    ],
                  ].map(([label, value]) => (
                    <Card key={label} className="shadow-none">
                      <CardHeader className="space-y-1 p-4">
                        <CardDescription>{label}</CardDescription>
                        <CardTitle className="text-base">{value}</CardTitle>
                      </CardHeader>
                    </Card>
                  ))}
                </div>

                <Separator />
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <CardTitle className="text-sm">Categories</CardTitle>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(Array.isArray(sourceMetadata.categories)
                        ? sourceMetadata.categories
                        : []
                      ).map((category) => (
                        <Badge key={category} variant="secondary">
                          {String(category)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <CardTitle className="text-sm">Tags</CardTitle>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(Array.isArray(sourceMetadata.tags)
                        ? sourceMetadata.tags
                        : []
                      ).map((tag) => (
                        <Badge key={tag} variant="outline">
                          {String(tag)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <Separator />
                <div className="grid gap-x-5 gap-y-4 text-sm md:grid-cols-2">
                  {[
                    ["Source ID", sourceMetadata.id],
                    ["Platform", sourceMetadata.platform],
                    ["Source URL", sourceMetadata.source_url],
                    ["Webpage URL", sourceMetadata.webpage_url],
                    ["Thumbnail URL", sourceMetadata.thumbnail],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <CardDescription>{label}</CardDescription>
                      {String(value || "").startsWith("http") ? (
                        <a
                          href={String(value)}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block truncate text-primary underline-offset-4 hover:underline"
                        >
                          {String(value)}
                        </a>
                      ) : (
                        <p className="mt-1 break-words">
                          {String(value || "Unknown")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
        {isAuditOpen && (
          <Dialog
            open={isAuditOpen}
            onOpenChange={(open) => !open && setIsAuditOpen(false)}
          >
            <DialogContent
              showClose={false}
              closeOnEscape={false}
              className="fixed left-auto right-0 top-0 flex h-dvh w-full max-w-xl translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-l bg-background p-0 shadow-xl"
            >
              <DialogHeader className="flex shrink-0 flex-row items-start justify-between gap-4 border-b p-6 text-left sm:text-left">
                <div>
                  <Badge variant="outline">Run audit</Badge>
                  <DialogTitle className="mt-3 text-xl">
                    Processing timeline
                  </DialogTitle>
                  <DialogDescription className="mt-2 max-w-sm truncate font-mono text-xs">
                    {selectedProjectId}
                  </DialogDescription>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    onClick={() => loadProjectAudit(selectedProject)}
                    aria-label="Refresh processing timeline"
                    title="Refresh timeline"
                  >
                    <RefreshCw
                      className={`size-4 ${isLoadingAudit ? "animate-spin" : ""}`}
                    />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    onClick={() => setIsAuditOpen(false)}
                    aria-label="Close processing timeline"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </DialogHeader>

              <div
                data-testid="audit-scroll-region"
                className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6"
              >
                {auditPolicy && (
                  <Card className="border-amber-500/30 bg-amber-500/5 shadow-none">
                    <CardHeader className="space-y-2 p-4">
                      <Badge variant="outline" className="w-fit">
                        Body capture policy
                      </Badge>
                      <CardDescription className="leading-relaxed">
                        Full redacted bodies are retained for allowlisted hosts;
                        binary and other hosts remain metadata-only. No body
                        truncation is applied.
                      </CardDescription>
                      <p className="break-words font-mono text-xs text-muted-foreground">
                        Hosts:{" "}
                        {auditPolicy.body_allowlist?.join(", ") || "none"}
                      </p>
                    </CardHeader>
                  </Card>
                )}

                {isLoadingAudit ? (
                  <Card>
                    <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-muted-foreground">
                      <Loader2 className="size-7 animate-spin text-primary" />
                      <p>Loading audit events...</p>
                    </CardContent>
                  </Card>
                ) : auditError ? (
                  <Card
                    role="alert"
                    className="border-destructive/30 bg-destructive/5 shadow-none"
                  >
                    <CardContent className="p-4 text-sm text-destructive">
                      {auditError}
                    </CardContent>
                  </Card>
                ) : auditEvents.length === 0 ? (
                  <Card className="border-dashed shadow-none">
                    <CardContent className="p-8 text-center text-sm text-muted-foreground">
                      No audit events captured yet. New processing runs will
                      appear here.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {auditEvents.map((event) => {
                      const StatusIcon =
                        event.status === "failed" ? AlertCircle : CheckCircle2;
                      const hasDetails =
                        Boolean(event.request_body) ||
                        Boolean(event.response_body) ||
                        (event.metadata &&
                          Object.keys(event.metadata).length > 0);
                      return (
                        <Card
                          key={event.id || `${event.sequence}-${event.name}`}
                          className="shadow-none"
                        >
                          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 p-4">
                            <div className="flex min-w-0 items-start gap-3">
                              <Badge
                                variant={
                                  event.status === "failed"
                                    ? "destructive"
                                    : "success"
                                }
                                className="mt-0.5 size-7 shrink-0 justify-center p-0"
                                aria-label={
                                  event.status === "failed"
                                    ? "Failed"
                                    : "Succeeded"
                                }
                              >
                                <StatusIcon className="size-4" />
                              </Badge>
                              <div className="min-w-0">
                                <CardTitle className="break-words text-base">
                                  {event.name || "Unnamed step"}
                                </CardTitle>
                                <CardDescription className="mt-1">
                                  {event.category || "processing"}
                                  {event.provider ? ` · ${event.provider}` : ""}
                                  {event.started_at
                                    ? ` · ${formatDate(event.started_at)}`
                                    : ""}
                                </CardDescription>
                              </div>
                            </div>
                            <Badge
                              variant={
                                event.status === "failed"
                                  ? "destructive"
                                  : "success"
                              }
                              className="shrink-0"
                            >
                              {event.status || "unknown"}
                            </Badge>
                          </CardHeader>
                          <CardContent className="space-y-3 p-4 pt-0">
                            <div className="flex flex-wrap gap-2">
                              {event.host && (
                                <Badge variant="outline" className="font-mono">
                                  {event.method || ""} {event.host}
                                  {event.path || ""}
                                </Badge>
                              )}
                              {event.duration_ms > 0 && (
                                <Badge variant="secondary">
                                  {event.duration_ms} ms
                                </Badge>
                              )}
                              {event.http_status > 0 && (
                                <Badge variant="secondary">
                                  HTTP {event.http_status}
                                </Badge>
                              )}
                              {(event.request_bytes > 0 ||
                                event.response_bytes > 0) && (
                                <Badge variant="secondary">
                                  {event.request_bytes || 0} B in ·{" "}
                                  {event.response_bytes || 0} B out
                                </Badge>
                              )}
                            </div>
                            {event.error && (
                              <p
                                role="alert"
                                className="break-words text-sm text-destructive"
                              >
                                {event.error}
                              </p>
                            )}
                            {hasDetails && (
                              <details className="border-t pt-3">
                                <summary className="cursor-pointer text-sm font-medium text-foreground marker:text-muted-foreground">
                                  Inspect captured details
                                </summary>
                                <div className="mt-3 space-y-3">
                                  {event.request_body && (
                                    <div>
                                      <p className="mb-2 text-sm font-medium">
                                        Request body
                                      </p>
                                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs leading-5 text-muted-foreground">
                                        {formatAuditBody(event.request_body)}
                                      </pre>
                                    </div>
                                  )}
                                  {event.response_body && (
                                    <div>
                                      <p className="mb-2 text-sm font-medium">
                                        Response body
                                      </p>
                                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs leading-5 text-muted-foreground">
                                        {formatAuditBody(event.response_body)}
                                      </pre>
                                    </div>
                                  )}
                                  {event.metadata &&
                                    Object.keys(event.metadata).length > 0 && (
                                      <div>
                                        <p className="mb-2 text-sm font-medium">
                                          Metadata
                                        </p>
                                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs leading-5 text-muted-foreground">
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
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto custom-scrollbar">
      <main className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-6 px-5 py-8 md:px-8 md:py-10 xl:px-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <Badge
              variant="outline"
              className="gap-1.5 rounded-md border-primary/25 bg-primary/10 px-2 py-1 font-medium text-primary"
            >
              <FolderOpen className="size-3.5" /> Project library
            </Badge>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                Projects
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
                Historical clip-generation jobs rendered the same way as the
                clip generator.
              </p>
            </div>
          </div>

          <Button variant="outline" onClick={loadProjects} type="button">
            <RefreshCw
              className={`size-4 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </header>

        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Label htmlFor="project-search" className="sr-only">
              Search projects
            </Label>
            <Input
              id="project-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects..."
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
          </CardContent>
        </Card>

        {error && (
          <Card className="border-destructive/30 bg-destructive/5 shadow-none">
            <CardContent className="p-4 text-sm text-destructive">
              {error}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <Card
            className="flex min-h-64 flex-col items-center justify-center gap-4 text-muted-foreground"
            role={editorOpen && editorClipIndex !== null ? "status" : undefined}
            aria-label={
              editorOpen && editorClipIndex !== null
                ? "Loading editor"
                : undefined
            }
            aria-live={
              editorOpen && editorClipIndex !== null ? "polite" : undefined
            }
          >
            <Loader2 className="size-8 animate-spin text-primary" />
            <p>
              {editorOpen && editorClipIndex !== null
                ? "Loading editor..."
                : "Loading your projects..."}
            </p>
          </Card>
        ) : filteredProjects.length === 0 ? (
          <Card className="border-dashed shadow-none">
            <CardContent className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
              <FolderOpen className="mb-4 size-10 text-muted-foreground/50" />
              <CardDescription>
                No projects found matching your search.
              </CardDescription>
            </CardContent>
          </Card>
        ) : (
          <section
            aria-label="Projects"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {filteredProjects.map((project) => {
              const previewVideoUrl =
                project.clips?.[0]?.url ||
                project.clips?.[0]?.video_url ||
                project.clips?.[0]?.source_video_url ||
                "";

              return (
                <Card
                  key={project.job_id}
                  className="group relative cursor-pointer overflow-hidden transition-colors hover:border-primary/40"
                >
                  <div className="relative aspect-[9/16] overflow-hidden bg-muted">
                    {previewVideoUrl ? (
                      <ProjectPreviewVideo src={previewVideoUrl} />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground/50">
                        <FolderOpen className="size-8" />
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <Badge variant="secondary" className="shadow-md">
                        View clips
                      </Badge>
                    </div>
                  </div>
                  <CardContent className="space-y-3 p-4">
                    <CardTitle className="truncate text-base transition-colors group-hover:text-primary">
                      {project.title || "Untitled Project"}
                    </CardTitle>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">
                        {formatDate(project.created_at)}
                      </span>
                      <Badge variant="secondary" className="shrink-0">
                        {project.clip_count || project.clips?.length || 0} clips
                      </Badge>
                    </div>
                    <code className="block truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                      {project.job_id}
                    </code>
                  </CardContent>
                  <Button
                    variant="ghost"
                    type="button"
                    aria-label={`View clips for ${project.title || "Untitled Project"}`}
                    onClick={() => handleViewProject(project)}
                    className="absolute inset-0 z-10 h-full w-full rounded-none bg-transparent p-0 text-transparent shadow-none hover:bg-transparent focus-visible:ring-inset active:scale-100"
                  />
                  <Button
                    variant="secondary"
                    size="icon"
                    type="button"
                    onClick={(e) => handleDeleteProject(e, project)}
                    className="absolute right-3 top-3 z-20 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                    title={`Delete ${project.title || "Untitled Project"}`}
                    aria-label={`Delete ${project.title || "Untitled Project"}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </Card>
              );
            })}
          </section>
        )}
      </main>
    </div>
  );
}
