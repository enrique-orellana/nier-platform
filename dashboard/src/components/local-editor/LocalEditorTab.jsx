import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  Bookmark,
  Download,
  FileScan,
  FastForward,
  FileText,
  Film,
  FolderOpen,
  Languages,
  Loader2,
  Maximize2,
  Minimize2,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Redo2,
  Repeat,
  Rewind,
  RotateCcw,
  Save,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Undo2,
  Upload,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  X,
} from "lucide-react";
import LocalEditorTimeline from "./LocalEditorTimeline";
import ClipMetadataPanel from "./ClipMetadataPanel";
import SubtitleCueTable from "./SubtitleCueTable";
import SubtitleCueModal from "./SubtitleCueModal";
import LocalEditorFeaturePanel from "./LocalEditorFeaturePanel";
import LocalEditorFeatureRail from "./LocalEditorFeatureRail";
import { LOCAL_EDITOR_FEATURES } from "./localEditorFeatures";
import RemotionPreview from "../RemotionPreview";
import { parseSubtitleFile, serializeSrt } from "./subtitleFormats";
import { activeCueAt, formatClock } from "./localEditorExport";
import {
  burnLocalEditorSubtitles,
  cueCaptionsForRender,
  cleanSubtitleCue,
  renderLocalVideoOnBackend,
  resolveProjectExportStartSeconds,
  syncSubtitleCue,
} from "./localEditorRender";
import {
  detectEmbeddedSideBars,
  getFilledFrameDimensions,
} from "./localEditorVideo";
import {
  clipTimeToSourceTime,
  sourceTimeToClipTime,
} from "./localEditorPlayback";
import { getApiUrl } from "../../config";
import { createSubtitleCue } from "../../editor/timelineModel";
import {
  getHookAnimationStyle,
  getHookBoxStyle,
  getHookPositionStyle,
} from "../../remotion/lib/hookVisual";
import LocalEditorProjects from "./LocalEditorProjects";
import { getLocalAiHeaders } from "./localEditorAi";
import {
  createEmptyEditorHistory,
  createStoredProject,
  deleteStoredProject,
  EDITOR_HISTORY_LIMIT,
  EDITOR_HISTORY_STORAGE_KEY,
  getActiveProjectId,
  listStoredProjects,
  loadStoredProject,
  migrateLegacyProject,
  readEditorHistory,
  renameStoredProject,
  saveEditorHistory,
  saveStoredProject,
  setActiveProjectId,
} from "./localEditorPersistence";
import {
  readEditorLayout,
  readEditorPreferences,
  saveEditorLayout,
  saveEditorPreferences,
  updateEditorPreferencesFromState,
} from "./localEditorPreferences";
import {
  DEFAULT_SUBTITLE_STYLE,
  hexToRgba,
  normalizeSubtitleStyle,
  subtitlePositionClass,
  toClipGeneratorSubtitleStyle,
} from "./localEditorStyles";
import { SUBTITLE_LANGUAGES } from "../subtitleLanguages";
import {
  DEFAULT_DURATION_MS,
  sleep,
  clamp,
  clampCue,
  normalizeGeneratedCues,
  outlineTextShadow,
  downloadBlob,
  downloadUrl,
} from "./localEditorUtils";
import LocalEditorUploadState from "./LocalEditorUploadState";
import LocalEditorSubtitleStyleInspector from "./LocalEditorSubtitleStyleInspector";
import LocalEditorHookInspector from "./LocalEditorHookInspector";
import LocalEditorSaveProjectDialog from "./LocalEditorSaveProjectDialog";

const MIN_TIMELINE_HEIGHT = 220;
const MIN_PREVIEW_HEIGHT = 260;
const MIN_INSPECTOR_WIDTH = 220;
const MAX_INSPECTOR_WIDTH = 520;
const DEFAULT_INSPECTOR_WIDTH = 300;
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const MIN_TIMELINE_ZOOM = 0.1;
const MAX_TIMELINE_ZOOM = 4;
const TIMELINE_ZOOM_STEP = 0.1;

export default function LocalEditorTab({
  initialVideoUrl = "",
  initialExportVideoUrl = "",
  initialVideoName = "",
  initialProjectId = "",
  initialClipIndex = null,
  initialPlaybackStartMs = 0,
  initialPlaybackDurationMs = null,
  remotionPreviewProps = null,
  initialEditorState = null,
  initialStateKey = null,
  onStateChange,
  onClose = null,
  headerActions = null,
  sidePanel = null,
  versionHistoryPanel = null,
  footer = null,
  persistHistory = true,
  allowLocalUpload = true,
  clipMetadata = null,
  onHashtagsChange = null,
  onExport = null,
}) {
  const projectClipIndex = Number(initialClipIndex);
  const hasProjectClipSource = Boolean(
    initialProjectId &&
    initialVideoUrl &&
    initialClipIndex !== null &&
    Number.isInteger(projectClipIndex) &&
    projectClipIndex >= 0,
  );
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const workspaceRef = useRef(null);
  const layoutResizeRef = useRef(null);
  const inspectorResizeRef = useRef(null);
  const remotionPlayerRef = useRef(null);
  const remotionPlayheadRef = useRef(0);
  const remotionPlayheadTimerRef = useRef(null);
  const remotionNativeClockActiveRef = useRef(false);
  const remotionMediaPlayheadTimerRef = useRef(null);
  const objectUrlRef = useRef("");
  const previewObjectUrlRef = useRef("");
  const subtitleInputRef = useRef(null);
  const timelineDragRef = useRef(null);
  const timelineApiRef = useRef(null);
  const scrollToCurrentRef = useRef(null);
  const videoRestoreGenerationRef = useRef(0);
  const videoLoadStartedRef = useRef(false);
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [previewVideoUrl, setPreviewVideoUrl] = useState("");
  const [durationMs, setDurationMs] = useState(DEFAULT_DURATION_MS);
  const [playheadMs, setPlayheadMs] = useState(0);
  const editorPreferencesRef = useRef(readEditorPreferences());
  const [editHistory, setEditHistory] = useState(() => {
    const history = createEmptyEditorHistory(editorPreferencesRef.current);
    if (initialEditorState)
      return {
        ...history,
        present: { ...history.present, ...initialEditorState },
      };
    try {
      return localStorage.getItem(EDITOR_HISTORY_STORAGE_KEY)
        ? readEditorHistory()
        : history;
    } catch {
      return history;
    }
  });
  const [selected, setSelected] = useState(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState(null);
  const [editingSubtitle, setEditingSubtitle] = useState(null);
  const [pendingSubtitle, setPendingSubtitle] = useState(null);
  const [error, setError] = useState("");
  const [generatingSubtitles, setGeneratingSubtitles] = useState(false);
  const [translatingSubtitles, setTranslatingSubtitles] = useState(false);
  const [translationTarget, setTranslationTarget] = useState("es");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playbackRateMenuOpen, setPlaybackRateMenuOpen] = useState(false);
  const [loopSegment, setLoopSegment] = useState(false);
  const [followAudio, setFollowAudio] = useState(true);
  const [videoViewMode, setVideoViewMode] = useState("auto");
  const [autoCrop, setAutoCrop] = useState(false);
  const [subtitleTrackActionsOpen, setSubtitleTrackActionsOpen] =
    useState(true);
  const [subtitleCueEditingOpen, setSubtitleCueEditingOpen] = useState(true);
  const [hookOpen, setHookOpen] = useState(false);
  const [activeFeature, setActiveFeature] = useState("details");
  const [subtitleView, setSubtitleView] = useState("timeline");
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [timelineHeight, setTimelineHeight] = useState(() => {
    const savedHeight = readEditorLayout().timelineHeight;
    return savedHeight >= MIN_TIMELINE_HEIGHT ? savedHeight : null;
  });
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    const savedWidth = readEditorLayout().inspectorWidth;
    return savedWidth >= MIN_INSPECTOR_WIDTH ? savedWidth : null;
  });
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectIdState] = useState(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [saveProjectDialogOpen, setSaveProjectDialogOpen] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectStorageWarning, setProjectStorageWarning] = useState("");
  const [projectSaveNotice, setProjectSaveNotice] = useState("");

  const playbackStartMs = Math.max(0, Number(initialPlaybackStartMs) || 0);
  const requestedPlaybackDurationMs =
    Number(initialPlaybackDurationMs) > 0
      ? Number(initialPlaybackDurationMs)
      : null;
  const remotionFps = Number(remotionPreviewProps?.fps || 30);

  const handleRemotionFrameChange = useCallback(
    (frame) => {
      if (remotionNativeClockActiveRef.current) return;
      remotionPlayheadRef.current = Math.min(
        durationMs,
        (frame / remotionFps) * 1000,
      );
      if (remotionPlayheadTimerRef.current) return;
      remotionPlayheadTimerRef.current = window.setTimeout(() => {
        remotionPlayheadTimerRef.current = null;
        if (!remotionNativeClockActiveRef.current)
          setPlayheadMs(remotionPlayheadRef.current);
      }, 100);
    },
    [durationMs, remotionFps],
  );
  const handleRemotionMediaTimeChange = useCallback(
    (mediaTimeMs) => {
      if (!Number.isFinite(mediaTimeMs)) {
        remotionNativeClockActiveRef.current = false;
        if (remotionMediaPlayheadTimerRef.current) {
          window.clearTimeout(remotionMediaPlayheadTimerRef.current);
          remotionMediaPlayheadTimerRef.current = null;
        }
        setPlayheadMs(
          Math.min(durationMs, Math.max(0, remotionPlayheadRef.current)),
        );
        return;
      }

      remotionNativeClockActiveRef.current = true;
      remotionPlayheadRef.current = Math.min(
        durationMs,
        Math.max(0, mediaTimeMs),
      );
      if (remotionMediaPlayheadTimerRef.current) return;
      remotionMediaPlayheadTimerRef.current = window.setTimeout(() => {
        remotionMediaPlayheadTimerRef.current = null;
        if (remotionNativeClockActiveRef.current)
          setPlayheadMs(remotionPlayheadRef.current);
      }, 50);
    },
    [durationMs],
  );
  const handleRemotionPlayerReady = useCallback((player) => {
    remotionPlayerRef.current = player;
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate, previewVideoUrl, videoUrl]);

  const scrollToCurrentSubtitle = useCallback(() => {
    setSubtitleView("table");
    window.setTimeout(() => scrollToCurrentRef.current?.(), 0);
  }, []);

  useEffect(
    () => () => {
      if (remotionPlayheadTimerRef.current)
        window.clearTimeout(remotionPlayheadTimerRef.current);
      if (remotionMediaPlayheadTimerRef.current)
        window.clearTimeout(remotionMediaPlayheadTimerRef.current);
    },
    [],
  );

  const {
    subtitleCues,
    subtitleStyle,
    subtitleLanguage,
    hook,
    markers = [],
  } = editHistory.present;
  const editHistoryRef = useRef(editHistory);
  const activeProjectIdRef = useRef(null);
  const activeProjectNameRef = useRef("");
  const appliedInitialStateKeyRef = useRef(null);
  const projectSaveTimerRef = useRef(null);
  const legacyHistoryPresentRef = useRef(
    (() => {
      try {
        return Boolean(localStorage.getItem(EDITOR_HISTORY_STORAGE_KEY));
      } catch {
        return false;
      }
    })(),
  );
  useEffect(() => {
    editHistoryRef.current = editHistory;
    if (persistHistory && !activeProjectIdRef.current)
      saveEditorHistory(editHistory);
    onStateChange?.(editHistory.present);
    const persistedProjectId = activeProjectIdRef.current || activeProjectId;
    if (!persistedProjectId || !videoFile) return undefined;
    if (projectSaveTimerRef.current)
      window.clearTimeout(projectSaveTimerRef.current);
    projectSaveTimerRef.current = window.setTimeout(async () => {
      const saved = await saveStoredProject(
        {
          id: persistedProjectId,
          name: activeProjectNameRef.current || videoFile.name,
          history: editHistoryRef.current,
          videoName: videoFile.name,
          durationMs,
        },
        null,
      );
      if (!saved)
        setProjectStorageWarning(
          "Could not save this project in browser storage. Your current edits are still available in memory.",
        );
      else {
        setProjectStorageWarning("");
        setProjects(await listStoredProjects());
      }
    }, 350);
    return () => {
      if (projectSaveTimerRef.current)
        window.clearTimeout(projectSaveTimerRef.current);
    };
  }, [
    activeProjectId,
    durationMs,
    editHistory,
    onStateChange,
    persistHistory,
    videoFile,
  ]);

  useEffect(() => {
    if (
      !initialEditorState ||
      initialStateKey === null ||
      appliedInitialStateKeyRef.current === initialStateKey
    )
      return;
    appliedInitialStateKeyRef.current = initialStateKey;
    setEditHistory((current) => ({
      ...createEmptyEditorHistory(editorPreferencesRef.current),
      present: { ...current.present, ...initialEditorState },
    }));
    setSelected(null);
  }, [initialEditorState, initialStateKey]);

  useEffect(() => {
    if (timelineHeight !== null) saveEditorLayout({ timelineHeight });
  }, [timelineHeight]);

  useEffect(() => {
    if (inspectorWidth !== null) saveEditorLayout({ inspectorWidth });
  }, [inspectorWidth]);

  useEffect(() => {
    const persistCurrentHistory = () => {
      if (persistHistory && !activeProjectIdRef.current)
        saveEditorHistory(editHistoryRef.current);
    };
    window.addEventListener("pagehide", persistCurrentHistory);
    window.addEventListener("beforeunload", persistCurrentHistory);
    return () => {
      window.removeEventListener("pagehide", persistCurrentHistory);
      window.removeEventListener("beforeunload", persistCurrentHistory);
    };
  }, [persistHistory]);

  const refreshProjects = async () => {
    const storedProjects = await listStoredProjects();
    setProjects(storedProjects);
    return storedProjects;
  };

  useEffect(
    () => () => {
      if (projectSaveTimerRef.current)
        window.clearTimeout(projectSaveTimerRef.current);
    },
    [],
  );

  const commitEdit = (
    updater,
    { coalesce = false, transaction = null, recordAction = false } = {},
  ) =>
    setEditHistory((current) => {
      const next =
        typeof updater === "function" ? updater(current.present) : updater;
      if (next === current.present) return current;
      if (coalesce && transaction) {
        if (recordAction) {
          return {
            past: [...current.past, current.present].slice(
              -EDITOR_HISTORY_LIMIT,
            ),
            present: next,
            future: [],
          };
        }
        return { ...current, present: next, future: [] };
      }
      return {
        past: [...current.past, current.present].slice(-EDITOR_HISTORY_LIMIT),
        present: next,
        future: [],
      };
    });
  const rememberEditorSettings = (state) => {
    const next = updateEditorPreferencesFromState(
      editorPreferencesRef.current,
      state,
    );
    editorPreferencesRef.current = next;
    saveEditorPreferences(next);
  };
  const undo = () =>
    setEditHistory((current) => {
      if (!current.past.length) return current;
      const previous = current.past[current.past.length - 1];
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future].slice(
          0,
          EDITOR_HISTORY_LIMIT,
        ),
      };
    });
  const redo = () =>
    setEditHistory((current) => {
      if (!current.future.length) return current;
      const [next, ...future] = current.future;
      return {
        past: [...current.past, current.present].slice(-EDITOR_HISTORY_LIMIT),
        present: next,
        future,
      };
    });

  useEffect(
    () => () => {
      if (objectUrlRef.current && typeof URL.revokeObjectURL === "function")
        URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    const handleFullscreenChange = () =>
      setIsFullscreen(document.fullscreenElement === playerRef.current);
    document.addEventListener?.("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener?.(
        "fullscreenchange",
        handleFullscreenChange,
      );
  }, []);

  useEffect(() => {
    const handleHistoryKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    };
    document.addEventListener("keydown", handleHistoryKeyDown);
    return () => document.removeEventListener("keydown", handleHistoryKeyDown);
  });

  const selectedCue = useMemo(() => {
    if (!selected) return null;
    if (selected.type === "hook") return hook;
    return subtitleCues.find((cue) => cue.id === selected.id) || null;
  }, [hook, selected, subtitleCues]);

  const loadVideo = useCallback(
    (
      file,
      {
        persist = true,
        projectId = null,
        restoredDurationMs = null,
        previewFile = file,
        previewUrl = "",
      } = {},
    ) => {
      if (!file?.type?.startsWith("video/")) {
        setError("Please choose a playable video file.");
        return;
      }
      videoLoadStartedRef.current = true;
      if (persist && !projectId) {
        activeProjectIdRef.current = null;
        activeProjectNameRef.current = "";
        setActiveProjectIdState(null);
        void setActiveProjectId(null);
      }
      const nextUrl = URL.createObjectURL(file);
      if (objectUrlRef.current && typeof URL.revokeObjectURL === "function")
        URL.revokeObjectURL(objectUrlRef.current);
      if (
        previewObjectUrlRef.current &&
        previewObjectUrlRef.current !== objectUrlRef.current &&
        typeof URL.revokeObjectURL === "function"
      )
        URL.revokeObjectURL(previewObjectUrlRef.current);
      objectUrlRef.current = nextUrl;
      const nextPreviewUrl =
        previewUrl ||
        (previewFile === file ? nextUrl : URL.createObjectURL(previewFile));
      previewObjectUrlRef.current = previewUrl ? "" : nextPreviewUrl;
      setVideoFile(file);
      setVideoUrl(nextUrl);
      setPreviewVideoUrl(nextPreviewUrl);
      setError("");
      setDurationMs(
        requestedPlaybackDurationMs ||
          restoredDurationMs ||
          DEFAULT_DURATION_MS,
      );
      setPlayheadMs(0);
      setIsPlaying(false);
      setIsLooping(false);
      setPlaybackRate(1);
      setLoopSegment(false);
      setFollowAudio(true);
      setIsMuted(false);
      setVideoViewMode("auto");
      setAutoCrop(false);
      if (videoRef.current) videoRef.current.loop = false;
      if (videoRef.current) videoRef.current.muted = false;
    },
    [requestedPlaybackDurationMs],
  );

  useEffect(() => {
    let active = true;
    const initializeProjects = async () => {
      await migrateLegacyProject({
        hasLegacyHistory: legacyHistoryPresentRef.current,
      });
      const storedProjects = await listStoredProjects();
      const storedActiveId = await getActiveProjectId();
      if (!active) return;
      setProjects(storedProjects);
      if (initialVideoUrl || !storedActiveId || videoLoadStartedRef.current)
        return;
      const stored = await loadStoredProject(storedActiveId);
      if (!active) return;
      if (!stored?.file) {
        await setActiveProjectId(null);
        return;
      }
      activeProjectIdRef.current = stored.project.id;
      activeProjectNameRef.current = stored.project.name;
      setActiveProjectIdState(stored.project.id);
      setEditHistory(stored.project.history);
      loadVideo(stored.file, {
        persist: false,
        projectId: stored.project.id,
        restoredDurationMs: stored.project.durationMs,
      });
    };
    void initializeProjects();
    return () => {
      active = false;
    };
  }, [initialVideoUrl, loadVideo]);

  useEffect(() => {
    if (!initialVideoUrl) return undefined;
    videoLoadStartedRef.current = true;
    const streamUrl = initialExportVideoUrl || initialVideoUrl;
    setVideoFile(null);
    setVideoUrl(streamUrl);
    setPreviewVideoUrl(streamUrl);
    setDurationMs(requestedPlaybackDurationMs || DEFAULT_DURATION_MS);
    setPlayheadMs(0);
    setIsPlaying(false);
    setPlaybackRate(1);
    setLoopSegment(false);
    setFollowAudio(true);
    setError("");
    const videoElement = videoRef.current;
    return () => {
      if (videoElement) videoElement.pause();
    };
  }, [initialExportVideoUrl, initialVideoUrl, requestedPlaybackDurationMs]);

  const handleVideoError = () => {
    if (!videoFile) setError("Could not stream the project video from MinIO.");
  };

  const handleMetadata = () => {
    const sourceDurationMs = Math.max(
      1,
      Math.round((videoRef.current?.duration || 30) * 1000),
    );
    const availableClipDurationMs = Math.max(
      1,
      sourceDurationMs - playbackStartMs,
    );
    const nextDuration = requestedPlaybackDurationMs
      ? Math.min(requestedPlaybackDurationMs, availableClipDurationMs)
      : sourceDurationMs;
    if (videoRef.current && playbackStartMs > 0) {
      videoRef.current.currentTime = playbackStartMs / 1000;
    }
    setDurationMs(nextDuration);
    setEditHistory((current) => ({
      ...current,
      present: {
        ...current.present,
        subtitleCues: current.present.subtitleCues.map((cue) =>
          clampCue(cue, nextDuration),
        ),
        hook: current.present.hook
          ? clampCue(current.present.hook, nextDuration)
          : current.present.hook,
      },
    }));
  };

  const detectVideoFraming = () => {
    const video = videoRef.current;
    if (!video) return;
    const detect = () => {
      try {
        setAutoCrop(detectEmbeddedSideBars(video));
      } catch {
        setAutoCrop(false);
      }
    };
    if (typeof video.requestVideoFrameCallback === "function")
      video.requestVideoFrameCallback(detect);
    else window.setTimeout(detect, 0);
  };

  const cycleVideoViewMode = () =>
    setVideoViewMode((current) =>
      current === "auto" ? "fill" : current === "fill" ? "fit" : "auto",
    );

  const updateSubtitle = (cue, options) =>
    commitEdit(
      (current) => ({
        ...current,
        subtitleCues: current.subtitleCues.map((item) =>
          item.id === cue.id
            ? syncSubtitleCue(item, clampCue(cue, durationMs))
            : item,
        ),
      }),
      options,
    );
  const updateHook = (nextHook, options) => {
    const normalizedHook = clampCue(nextHook, durationMs);
    rememberEditorSettings({
      ...editHistoryRef.current.present,
      hook: normalizedHook,
    });
    return commitEdit(
      (current) => ({ ...current, hook: normalizedHook }),
      options,
    );
  };
  const updateSubtitleStyle = (nextStyle) => {
    rememberEditorSettings({
      ...editHistoryRef.current.present,
      subtitleStyle: nextStyle,
    });
    commitEdit((current) => ({ ...current, subtitleStyle: nextStyle }));
  };
  const updateSubtitleLanguage = (nextLanguage) => {
    rememberEditorSettings({
      ...editHistoryRef.current.present,
      subtitleLanguage: nextLanguage,
    });
    commitEdit((current) => ({ ...current, subtitleLanguage: nextLanguage }));
  };

  const handleTimelineSelect = (cue, type, { openEditor = true } = {}) => {
    setSelected({ id: cue.id, type });
    if (type === "subtitle" && openEditor) setEditingSubtitle(cue);
  };
  const beginTimelineEdit = () => {
    timelineDragRef.current = { recorded: false };
  };
  const endTimelineEdit = () => {
    timelineDragRef.current = null;
  };
  const handleTimelineChange = (cue, type) => {
    const transaction = timelineDragRef.current;
    const recordAction = Boolean(transaction && !transaction.recorded);
    if (transaction) transaction.recorded = true;
    const options = transaction
      ? { coalesce: true, transaction, recordAction }
      : {};
    return type === "hook"
      ? updateHook(cue, options)
      : updateSubtitle(cue, options);
  };

  const handleLayoutResizeStart = (event) => {
    const workspace = workspaceRef.current;
    const bounds = workspace?.getBoundingClientRect();
    if (!bounds) return;
    const workspaceHeight = bounds.height || 800;
    layoutResizeRef.current = {
      startY: Number.isFinite(event.clientY) ? event.clientY : 0,
      startHeight: timelineHeight ?? workspaceHeight * 0.4,
      workspaceHeight,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const handleLayoutResizeMove = (event) => {
    const resize = layoutResizeRef.current;
    if (!resize) return;
    const minHeight = Math.min(
      MIN_TIMELINE_HEIGHT,
      Math.max(160, resize.workspaceHeight * 0.45),
    );
    const maxHeight = Math.max(
      minHeight,
      resize.workspaceHeight - MIN_PREVIEW_HEIGHT,
    );
    const currentY = Number.isFinite(event.clientY)
      ? event.clientY
      : resize.startY;
    const deltaY = currentY - resize.startY;
    setTimelineHeight(
      Math.round(clamp(resize.startHeight - deltaY, minHeight, maxHeight)),
    );
  };

  const handleLayoutResizeEnd = () => {
    layoutResizeRef.current = null;
  };

  const handleLayoutResizeKeyDown = (event) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const bounds = workspaceRef.current?.getBoundingClientRect();
    const workspaceHeight = bounds?.height || 800;
    const minHeight = Math.min(
      MIN_TIMELINE_HEIGHT,
      Math.max(160, workspaceHeight * 0.45),
    );
    const maxHeight = Math.max(minHeight, workspaceHeight - MIN_PREVIEW_HEIGHT);
    const currentHeight = timelineHeight ?? workspaceHeight * 0.4;
    const nextHeight =
      event.key === "Home"
        ? minHeight
        : event.key === "End"
          ? maxHeight
          : currentHeight + (event.key === "ArrowUp" ? 32 : -32);
    setTimelineHeight(Math.round(clamp(nextHeight, minHeight, maxHeight)));
  };

  const handleInspectorResizeStart = (event) => {
    inspectorResizeRef.current = {
      startX: Number.isFinite(event.clientX) ? event.clientX : 0,
      startWidth: inspectorWidth ?? DEFAULT_INSPECTOR_WIDTH,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const handleInspectorResizeMove = (event) => {
    const resize = inspectorResizeRef.current;
    if (!resize) return;
    const currentX = Number.isFinite(event.clientX)
      ? event.clientX
      : resize.startX;
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width;
    const maxWidth = Math.min(
      MAX_INSPECTOR_WIDTH,
      Math.max(
        MIN_INSPECTOR_WIDTH,
        (workspaceWidth || 1280) - MIN_PREVIEW_HEIGHT - 220,
      ),
    );
    setInspectorWidth(
      Math.round(
        clamp(
          resize.startWidth + currentX - resize.startX,
          MIN_INSPECTOR_WIDTH,
          maxWidth,
        ),
      ),
    );
  };

  const handleInspectorResizeEnd = () => {
    inspectorResizeRef.current = null;
  };

  const handleInspectorResizeKeyDown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width;
    const maxWidth = Math.min(
      MAX_INSPECTOR_WIDTH,
      Math.max(
        MIN_INSPECTOR_WIDTH,
        (workspaceWidth || 1280) - MIN_PREVIEW_HEIGHT - 220,
      ),
    );
    const currentWidth = inspectorWidth ?? DEFAULT_INSPECTOR_WIDTH;
    const nextWidth =
      event.key === "Home"
        ? MIN_INSPECTOR_WIDTH
        : event.key === "End"
          ? maxWidth
          : currentWidth + (event.key === "ArrowRight" ? 32 : -32);
    setInspectorWidth(
      Math.round(clamp(nextWidth, MIN_INSPECTOR_WIDTH, maxWidth)),
    );
  };

  const importSubtitleFile = async (file) => {
    if (!file) return;
    try {
      if (
        subtitleCues.length &&
        !window.confirm("Replace the current subtitle track?")
      )
        return;
      const cues = parseSubtitleFile(file.name, await file.text());
      const importedCues = cues.map((cue) => clampCue(cue, durationMs));
      commitEdit((current) => ({
        ...current,
        subtitleCues: importedCues,
        subtitleLanguage: "en",
      }));
      setPendingSubtitle(null);
      if (subtitleInputRef.current) subtitleInputRef.current.value = "";
      setSelected(null);
      setError("");
    } catch (importError) {
      setError(importError.message || "Could not import subtitles.");
    }
  };

  const generateSubtitles = async () => {
    if (
      subtitleCues.length &&
      !window.confirm("Replace the current subtitle track?")
    )
      return;
    setGeneratingSubtitles(true);
    setError("");
    try {
      let response;
      if (videoFile) {
        const formData = new FormData();
        formData.append("file", videoFile, videoFile.name);
        response = await fetch(getApiUrl("/api/local-editor/transcribe"), {
          method: "POST",
          body: formData,
        });
      } else if (hasProjectClipSource) {
        response = await fetch(
          getApiUrl(
            `/api/projects/${encodeURIComponent(initialProjectId)}/clips/${projectClipIndex}/transcribe`,
          ),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...getLocalAiHeaders(),
            },
            body: JSON.stringify({}),
          },
        );
      } else {
        throw new Error("Choose a video before generating subtitles.");
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(payload.detail || "Could not generate subtitles.");
      const generatedCues = normalizeGeneratedCues(
        payload.captions?.length ? payload.captions : payload.segments,
        durationMs,
      );
      if (!generatedCues.length)
        throw new Error("No speech was detected in this video.");
      commitEdit((current) => ({
        ...current,
        subtitleCues: generatedCues,
        subtitleLanguage: String(payload.language || "en").toLowerCase(),
      }));
      setSelected(null);
    } catch (generationError) {
      setError(generationError.message || "Could not generate subtitles.");
    } finally {
      setGeneratingSubtitles(false);
    }
  };

  const handleImport = () => {
    if (pendingSubtitle) {
      importSubtitleFile(pendingSubtitle);
      return;
    }
    subtitleInputRef.current?.click();
  };

  const translateSubtitles = async () => {
    if (!subtitleCues.length || translatingSubtitles) return;
    const sourceLanguage = String(subtitleLanguage || "en").toLowerCase();
    const targetLanguage = String(translationTarget || "").toLowerCase();
    if (!targetLanguage || targetLanguage === sourceLanguage) {
      setError("Choose a target language different from the source language.");
      return;
    }
    setTranslatingSubtitles(true);
    setError("");
    try {
      const sourceCues = subtitleCues.map(({ id, text, startMs, endMs }) => ({
        id,
        text,
        startMs,
        endMs,
      }));
      const response = await fetch(getApiUrl("/api/local-editor/translate"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getLocalAiHeaders() },
        body: JSON.stringify({
          target_language: targetLanguage,
          source_track_id: "original",
          tracks: [
            { id: "original", language: sourceLanguage, cues: sourceCues },
          ],
        }),
      });
      let statusPayload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(statusPayload.detail || "Subtitle translation failed.");
      const translationId = statusPayload.translationId;
      if (!translationId)
        throw new Error("Translation service did not return a job id.");
      while (!["done", "error", "failed"].includes(statusPayload.status)) {
        await sleep(500);
        const statusResponse = await fetch(
          getApiUrl(`/api/translation/${translationId}`),
        );
        statusPayload = await statusResponse.json().catch(() => ({}));
        if (!statusResponse.ok)
          throw new Error(
            statusPayload.detail || "Unable to read translation status.",
          );
      }
      if (statusPayload.status !== "done")
        throw new Error(statusPayload.error || "Subtitle translation failed.");
      const translatedCues = statusPayload.track?.cues;
      if (
        !Array.isArray(translatedCues) ||
        translatedCues.length !== sourceCues.length
      )
        throw new Error("Translation returned an invalid subtitle track.");
      commitEdit((current) => ({
        ...current,
        subtitleLanguage: targetLanguage,
        subtitleCues: sourceCues.map((cue, index) => ({
          ...(current.subtitleCues.find((item) => item.id === cue.id) || cue),
          text: String(translatedCues[index]?.text || "").trim(),
          label: String(translatedCues[index]?.text || "").trim(),
          captions: Array.isArray(translatedCues[index]?.captions)
            ? translatedCues[index].captions.map((caption) => ({
                text: String(caption?.text || "").trim(),
                startMs: Number(caption?.startMs),
                endMs: Number(caption?.endMs),
              }))
            : undefined,
        })),
      }));
      setSelected(null);
    } catch (translationError) {
      setError(translationError.message || "Subtitle translation failed.");
    } finally {
      setTranslatingSubtitles(false);
    }
  };

  const addHook = () => {
    if (hook && !window.confirm("Replace the current viral hook?")) return;
    const { durationMs: hookDurationMs, ...hookDefaults } =
      editorPreferencesRef.current.hookDefaults;
    const nextHook = {
      id: "hook",
      text: "Your viral hook",
      startMs: 0,
      endMs: Math.min(hookDurationMs, durationMs),
      ...hookDefaults,
    };
    rememberEditorSettings({
      ...editHistoryRef.current.present,
      hook: nextHook,
    });
    commitEdit((current) => ({ ...current, hook: nextHook }));
    setSelected({ id: "hook", type: "hook" });
    setHookOpen(true);
  };

  const removeHook = () => {
    if (!hook || !window.confirm("Remove viral hook?")) return;
    commitEdit((current) => ({ ...current, hook: null }));
    setSelected((current) => (current?.type === "hook" ? null : current));
  };

  const removeSubtitles = () => {
    if (!window.confirm("Remove all subtitles?")) return;
    commitEdit((current) => ({
      ...current,
      subtitleCues: [],
      subtitleStyle: DEFAULT_SUBTITLE_STYLE,
      subtitleLanguage: "en",
    }));
    setSelected((current) => (current?.type === "subtitle" ? null : current));
    setEditingSubtitle(null);
  };

  const cleanSubtitleDots = () => {
    if (!subtitleCues.length) return;
    commitEdit((current) => ({
      ...current,
      subtitleCues: current.subtitleCues.map(cleanSubtitleCue),
    }));
  };

  const addSubtitleCue = () => {
    const nextCue = clampCue(
      createSubtitleCue({
        playheadMs,
        durationMs,
        existingIds: subtitleCues.map((cue) => cue.id),
      }),
      durationMs,
    );
    commitEdit((current) => ({
      ...current,
      subtitleCues: [...current.subtitleCues, nextCue],
    }));
    setSelected({ id: nextCue.id, type: "subtitle" });
    setEditingSubtitle(nextCue);
  };

  const addMarker = () => {
    const markerId = `marker-${Date.now()}-${markers.length}`;
    commitEdit((current) => ({
      ...current,
      markers: [
        ...(Array.isArray(current.markers) ? current.markers : []),
        {
          id: markerId,
          timeMs: clamp(playheadMs, 0, durationMs),
          label: "",
        },
      ],
    }));
    setSelectedMarkerId(markerId);
  };

  const removeMarker = (markerId) => {
    if (!markerId) return;
    commitEdit((current) => ({
      ...current,
      markers: (current.markers || []).filter(
        (marker) => marker.id !== markerId,
      ),
    }));
    setSelectedMarkerId(null);
  };

  const moveMarker = (markerId, markerTimeMs) => {
    const nextTimeMs = clamp(markerTimeMs, 0, durationMs);
    commitEdit((current) => {
      const currentMarkers = Array.isArray(current.markers)
        ? current.markers
        : [];
      if (!currentMarkers.some((marker) => marker.id === markerId))
        return current;
      return {
        ...current,
        markers: currentMarkers.map((marker) =>
          marker.id === markerId ? { ...marker, timeMs: nextTimeMs } : marker,
        ),
      };
    });
    handleSeek(nextTimeMs);
    setSelectedMarkerId(markerId);
  };

  const selectMarker = (markerId, markerTimeMs) => {
    setSelectedMarkerId(markerId);
    setSelected(null);
    handleSeek(markerTimeMs);
  };

  const activeMarker =
    markers.find(
      (marker) => Math.abs(Number(marker.timeMs) - playheadMs) <= 1,
    ) || null;

  const toggleMarker = () => {
    if (activeMarker) {
      removeMarker(activeMarker.id);
      return;
    }
    addMarker();
  };

  const handleTimelineKeyDown = (event) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      if (!selectedMarkerId) return;
      event.preventDefault();
      removeMarker(selectedMarkerId);
      return;
    }
    if (event.key.toLowerCase() !== "m") return;
    event.preventDefault();
    toggleMarker();
  };

  const removeSubtitleCue = (id) => {
    if (!window.confirm("Remove this subtitle cue?")) return;
    commitEdit((current) => ({
      ...current,
      subtitleCues: current.subtitleCues.filter((cue) => cue.id !== id),
    }));
    setSelected((current) =>
      current?.id === id && current.type === "subtitle" ? null : current,
    );
    setEditingSubtitle((current) => (current?.id === id ? null : current));
  };

  const handleSeek = (nextMs) => {
    const clampedMs = clamp(nextMs, 0, durationMs);
    const markerAtPlayhead = markers.find(
      (marker) => Math.abs(Number(marker.timeMs) - clampedMs) <= 1,
    );
    setSelectedMarkerId(markerAtPlayhead?.id || null);
    setPlayheadMs(clampedMs);
    if (remotionPlayerRef.current) {
      remotionPlayerRef.current.seekTo?.(
        Math.round((clampedMs / 1000) * remotionFps),
      );
      return;
    }
    if (videoRef.current)
      videoRef.current.currentTime =
        clipTimeToSourceTime(clampedMs, playbackStartMs, durationMs) / 1000;
  };

  const handleVideoTimeUpdate = (event) => {
    const sourceMs = event.currentTarget.currentTime * 1000;
    if (sourceMs < playbackStartMs) {
      event.currentTarget.currentTime = playbackStartMs / 1000;
      setPlayheadMs(0);
      return;
    }
    const nextMs = sourceTimeToClipTime(sourceMs, playbackStartMs, durationMs);
    if (sourceMs >= playbackStartMs + durationMs) {
      if (isLooping) {
        event.currentTarget.currentTime = playbackStartMs / 1000;
        setPlayheadMs(0);
        return;
      }
      event.currentTarget.pause();
      event.currentTarget.currentTime =
        clipTimeToSourceTime(durationMs, playbackStartMs, durationMs) / 1000;
      setPlayheadMs(durationMs);
      setIsPlaying(false);
      return;
    }
    const loopCue = loopSegment
      ? selected?.type === "subtitle"
        ? subtitleCues.find((cue) => cue.id === selected.id)
        : activeCueAt(subtitleCues, playheadMs)
      : null;
    if (loopCue && nextMs >= loopCue.endMs) {
      event.currentTarget.currentTime =
        clipTimeToSourceTime(loopCue.startMs, playbackStartMs, durationMs) /
        1000;
      setPlayheadMs(loopCue.startMs);
      return;
    }
    setPlayheadMs(nextMs);
  };

  const seekBy = (deltaMs) => {
    handleSeek(playheadMs + deltaMs);
  };

  const togglePlayback = async (event) => {
    const remotionPlayer = remotionPlayerRef.current;
    if (remotionPlayer) {
      if (isPlaying) {
        remotionPlayer.pause?.();
        setIsPlaying(false);
      } else {
        try {
          await remotionPlayer.play?.(event);
          setIsPlaying(true);
        } catch (playError) {
          setError(playError.message || "Could not play project video.");
        }
      }
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
        setIsPlaying(true);
      } catch (playError) {
        setError(playError.message || "Could not play local video.");
      }
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const stopVideo = () => {
    if (remotionPlayerRef.current) {
      remotionPlayerRef.current.pause?.();
      remotionPlayerRef.current.seekTo?.(0);
      setPlayheadMs(0);
      setIsPlaying(false);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = playbackStartMs / 1000;
    setPlayheadMs(0);
    setIsPlaying(false);
  };

  const toggleLoop = () => {
    const nextLooping = !isLooping;
    setIsLooping(nextLooping);
    if (videoRef.current) videoRef.current.loop = nextLooping;
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (remotionPlayerRef.current) {
      if (nextMuted) remotionPlayerRef.current.mute?.();
      else remotionPlayerRef.current.unmute?.();
    } else if (videoRef.current) videoRef.current.muted = nextMuted;
  };

  const handlePlayerKeyDown = (event) => {
    if (
      ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(event.target.tagName)
    )
      return;
    const key = event.key.toLowerCase();
    if (event.key === " " || key === "k") {
      event.preventDefault();
      togglePlayback(event);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekBy(-5000);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      seekBy(5000);
    } else if (event.key === "Home") {
      event.preventDefault();
      handleSeek(0);
    } else if (event.key === "End") {
      event.preventDefault();
      handleSeek(durationMs);
    } else if (key === "m") {
      event.preventDefault();
      toggleMute();
    } else if (key === "f") {
      event.preventDefault();
      toggleFullscreen();
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen?.();
      } else if (playerRef.current?.requestFullscreen) {
        await playerRef.current.requestFullscreen();
      } else {
        setError("Fullscreen is not supported by this browser.");
      }
    } catch (fullscreenError) {
      setError(fullscreenError.message || "Could not open fullscreen mode.");
    }
  };

  const exportSubtitles = () =>
    downloadBlob(
      new Blob([serializeSrt(subtitleCues)], { type: "application/x-subrip" }),
      "openshorts-subtitles.srt",
    );

  const exportVideo = async () => {
    setBusy(true);
    setProgress(0);
    setError("");
    try {
      const video = videoRef.current;
      const sourceWidth =
        Number(video?.videoWidth) ||
        Number(remotionPreviewProps?.width) ||
        Number(clipMetadata?.output_width);
      const sourceHeight =
        Number(video?.videoHeight) ||
        Number(remotionPreviewProps?.height) ||
        Number(clipMetadata?.output_height);
      if (!sourceWidth || !sourceHeight)
        throw new Error("Video metadata is not ready for export.");
      const cropForExport =
        videoViewMode === "fill" || (videoViewMode === "auto" && autoCrop);
      const outputDimensions = getFilledFrameDimensions(
        sourceWidth,
        sourceHeight,
      );
      const projectSourceUrl =
        !videoFile && initialProjectId && initialClipIndex !== null
          ? clipMetadata?.video_url ||
            clipMetadata?.source_video_url ||
            clipMetadata?.original_video_url ||
            ""
          : "";
      const renderParams = {
        durationSeconds: durationMs / 1000,
        fps: 60,
        videoStartSeconds: projectSourceUrl
          ? resolveProjectExportStartSeconds(
              projectSourceUrl,
              clipMetadata?.start,
              remotionPreviewProps?.videoStartSeconds,
            )
          : 0,
        ...outputDimensions,
        videoFit: cropForExport ? "cover" : "contain",
        subtitleCues,
        subtitleStyle,
        hook,
        onProgress: setProgress,
      };
      const backendSourceParams = projectSourceUrl
        ? {
            sourceUrl: projectSourceUrl,
            jobId: initialProjectId,
            clipIndex: projectClipIndex,
          }
        : {};
      let outputUrl;
      if (onExport) {
        outputUrl = await onExport();
        if (!outputUrl) throw new Error("Export did not return a video URL.");
      } else if (subtitleCues.length) {
        outputUrl = await burnLocalEditorSubtitles({
          file: videoFile,
          ...backendSourceParams,
          ...renderParams,
        });
      } else {
        outputUrl = await renderLocalVideoOnBackend({
          file: videoFile,
          ...backendSourceParams,
          ...renderParams,
        });
      }
      downloadUrl(outputUrl, "openshorts-local-editor.mp4");
    } catch (exportError) {
      setError(exportError.message || "Could not export this video locally.");
    } finally {
      setBusy(false);
    }
  };

  const startNewProject = () => {
    videoRestoreGenerationRef.current += 1;
    videoLoadStartedRef.current = true;
    activeProjectIdRef.current = null;
    activeProjectNameRef.current = "";
    setActiveProjectIdState(null);
    void setActiveProjectId(null);
    videoRef.current?.pause();
    if (videoRef.current) videoRef.current.loop = false;
    if (objectUrlRef.current && typeof URL.revokeObjectURL === "function")
      URL.revokeObjectURL(objectUrlRef.current);
    if (
      previewObjectUrlRef.current &&
      previewObjectUrlRef.current !== objectUrlRef.current &&
      typeof URL.revokeObjectURL === "function"
    )
      URL.revokeObjectURL(previewObjectUrlRef.current);
    objectUrlRef.current = "";
    previewObjectUrlRef.current = "";
    setVideoFile(null);
    setVideoUrl("");
    setPreviewVideoUrl("");
    setEditHistory(createEmptyEditorHistory(editorPreferencesRef.current));
    setSelected(null);
    setPendingSubtitle(null);
    setPlayheadMs(0);
    setProgress(0);
    setIsPlaying(false);
    setIsLooping(false);
    setPlaybackRate(1);
    setLoopSegment(false);
    setFollowAudio(true);
    setError("");
  };

  const openSaveProjectDialog = () => {
    if (!videoFile) return;
    setProjectNameDraft(activeProjectNameRef.current || videoFile.name);
    setProjectStorageWarning("");
    setProjectSaveNotice("");
    setSaveProjectDialogOpen(true);
  };

  const saveProject = async () => {
    if (!videoFile) return;
    const name = projectNameDraft.trim();
    if (!name) return;
    try {
      const saved = activeProjectId
        ? await saveStoredProject(
            {
              id: activeProjectId,
              name,
              history: editHistoryRef.current,
              videoName: videoFile.name,
              durationMs,
            },
            videoFile,
          )
        : await createStoredProject({
            name,
            history: editHistoryRef.current,
            file: videoFile,
            durationMs,
          });
      if (!saved) {
        setProjectStorageWarning(
          "Could not save this project in browser storage. Your current edits are still available in memory.",
        );
        return;
      }
      activeProjectIdRef.current = saved.id;
      activeProjectNameRef.current = saved.name;
      setActiveProjectIdState(saved.id);
      await setActiveProjectId(saved.id);
      setProjectStorageWarning("");
      setProjectSaveNotice(`Saved “${saved.name}”`);
      setSaveProjectDialogOpen(false);
      await refreshProjects();
    } catch {
      setProjectStorageWarning(
        "Could not save this project in browser storage. Your current edits are still available in memory.",
      );
    }
  };

  const openProject = async (projectId) => {
    const stored = await loadStoredProject(projectId);
    if (!stored?.file) {
      setProjectStorageWarning(
        "This project video is unavailable in browser storage.",
      );
      return;
    }
    activeProjectIdRef.current = stored.project.id;
    activeProjectNameRef.current = stored.project.name;
    setActiveProjectIdState(stored.project.id);
    await setActiveProjectId(stored.project.id);
    setEditHistory(stored.project.history);
    setSelected(null);
    loadVideo(stored.file, {
      persist: false,
      projectId: stored.project.id,
      restoredDurationMs: stored.project.durationMs,
    });
    setProjectsOpen(false);
    setProjectStorageWarning("");
  };

  const renameProject = async (project) => {
    const name = window.prompt("Project name", project.name)?.trim() || "";
    if (!name) return;
    const renamed = await renameStoredProject(project.id, name);
    if (!renamed) {
      setProjectStorageWarning(
        "Could not rename this project in browser storage.",
      );
      return;
    }
    if (project.id === activeProjectIdRef.current)
      activeProjectNameRef.current = renamed.name;
    await refreshProjects();
  };

  const deleteProject = async (projectId) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project || !window.confirm(`Delete ${project.name}?`)) return;
    const deleted = await deleteStoredProject(projectId);
    if (!deleted) {
      setProjectStorageWarning(
        "Could not delete this project from browser storage.",
      );
      return;
    }
    if (projectId === activeProjectIdRef.current) startNewProject();
    await refreshProjects();
  };

  const openProjects = async () => {
    await refreshProjects();
    setProjectsOpen(true);
  };

  const reset = startNewProject;
  const cueEditingOpen = subtitleCueEditingOpen;
  const projectsDialog = (
    <LocalEditorProjects
      open={projectsOpen}
      projects={projects}
      activeProjectId={activeProjectId}
      onClose={() => setProjectsOpen(false)}
      onOpen={openProject}
      onRename={renameProject}
      onDelete={deleteProject}
      onNewProject={() => {
        startNewProject();
        setProjectsOpen(false);
      }}
    />
  );

  if (!videoFile && !videoUrl) {
    return (
      <div className="h-full overflow-y-auto bg-[#0d0d0f] text-white">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <h1 className="text-lg font-bold">Local Editor</h1>
            <p className="mt-0.5 text-xs text-zinc-500">
              Edit local videos, subtitles, and viral hooks in your browser.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!initialProjectId && (
              <button
                type="button"
                onClick={openProjects}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-white/5"
              >
                <FolderOpen size={13} />
                Projects
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close editor"
                className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
        {projectStorageWarning && (
          <div className="mx-4 mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
            {projectStorageWarning}
          </div>
        )}
        {!allowLocalUpload ? (
          <div className="flex h-64 items-center justify-center gap-2 text-sm text-zinc-400">
            {error || "Project video is unavailable."}
          </div>
        ) : (
          <LocalEditorUploadState onFile={loadVideo} error={error} />
        )}
        {projectsDialog}
      </div>
    );
  }

  const activeSubtitle = activeCueAt(subtitleCues, playheadMs);
  const activeSubtitleWords = activeSubtitle
    ? cueCaptionsForRender(activeSubtitle)
    : [];
  const activeSubtitleWordIndex = activeSubtitleWords.findIndex(
    (word) => playheadMs >= word.startMs && playheadMs < word.endMs,
  );
  const activeHook =
    hook && playheadMs >= hook.startMs && playheadMs < hook.endMs ? hook : null;
  const previewSubtitleStyle = normalizeSubtitleStyle(subtitleStyle);
  const previewSubtitles = subtitleCues.length
    ? {
        captions: subtitleCues.flatMap((cue) => cueCaptionsForRender(cue)),
        blocks: subtitleCues.map((cue) => ({
          words: cueCaptionsForRender(cue),
          startMs: Number(cue.startMs),
          endMs: Number(cue.endMs),
          text: String(cue.text || ""),
        })),
        position: previewSubtitleStyle.position || "bottom",
        style: toClipGeneratorSubtitleStyle(previewSubtitleStyle),
      }
    : null;
  const hookElapsedMs = activeHook
    ? Math.max(0, playheadMs - activeHook.startMs)
    : 0;
  const hookEntranceStyle = activeHook
    ? getHookAnimationStyle(activeHook.entranceAnimation, hookElapsedMs)
    : {};
  const shouldCropVideo =
    videoViewMode === "fill" || (videoViewMode === "auto" && autoCrop);
  const videoViewLabel =
    videoViewMode === "auto"
      ? autoCrop
        ? "Auto crop"
        : "Auto fit"
      : videoViewMode === "fill"
        ? "Fill"
        : "Fit";
  const activeFeatureLabel =
    LOCAL_EDITOR_FEATURES.find(({ id }) => id === activeFeature)?.label ||
    "Details";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0d0d0f] text-white">
      <div
        data-testid="local-editor-header"
        className="flex h-11 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-1"
      >
        <div>
          <h1 className="text-sm font-bold leading-4">Local Editor</h1>
          <p className="text-[10px] leading-3 text-zinc-500">
            {videoFile?.name || initialVideoName || "Project video"} ·{" "}
            {videoFile ? "local-only editing" : "streamed project video"}
          </p>
        </div>
        <div
          data-testid="local-editor-header-actions"
          className="flex flex-wrap items-center gap-1"
        >
          {!initialProjectId && (
            <div
              data-testid="local-editor-header-workspace"
              className="flex items-center gap-1"
            >
              <button
                type="button"
                onClick={openProjects}
                className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] text-zinc-300 hover:bg-white/5"
              >
                <FolderOpen size={13} />
                Projects
              </button>
            </div>
          )}
          {!initialProjectId && (
            <div
              data-testid="local-editor-header-edit"
              className="flex items-center gap-1 border-l border-white/10 pl-2"
            >
              {editHistory.past.length > 0 && (
                <button
                  type="button"
                  onClick={undo}
                  disabled={busy}
                  aria-label="Undo"
                  title="Undo (Ctrl/Cmd+Z)"
                  className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] text-zinc-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Undo2 size={13} />
                  Undo
                </button>
              )}
              {editHistory.future.length > 0 && (
                <button
                  type="button"
                  onClick={redo}
                  disabled={busy}
                  aria-label="Redo"
                  title="Redo (Ctrl/Cmd+Shift+Z)"
                  className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] text-zinc-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Redo2 size={13} />
                  Redo
                </button>
              )}
            </div>
          )}
          <div
            data-testid="local-editor-header-output"
            className={
              initialProjectId
                ? "flex items-center gap-1"
                : "flex items-center gap-1 border-l border-white/10 pl-2"
            }
          >
            {videoFile && (
              <button
                type="button"
                onClick={openSaveProjectDialog}
                disabled={busy}
                className="flex items-center gap-1 rounded-md bg-emerald-500 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save size={13} />
                Save Project
              </button>
            )}
            {(videoFile || initialExportVideoUrl || videoUrl) && (
              <button
                type="button"
                onClick={exportVideo}
                disabled={busy}
                className="flex items-center gap-1 rounded-md bg-fuchsia-500 px-2 py-1 text-[10px] font-semibold hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Film size={13} />
                {busy
                  ? `Exporting ${Math.round(progress * 100)}%`
                  : "Export Video"}
              </button>
            )}
            {headerActions}
          </div>
          <div
            data-testid="local-editor-header-utility"
            className="flex items-center gap-1 border-l border-white/10 pl-2"
          >
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              aria-label="Reset"
              className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] text-zinc-300 hover:bg-white/5 disabled:opacity-50"
            >
              <RotateCcw size={13} />
              Reset
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close editor"
                title="Close editor"
                className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] text-zinc-300 hover:bg-white/5"
              >
                <X size={13} />
                Close
              </button>
            )}
          </div>
        </div>
      </div>
      {error && (
        <div className="mx-6 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      {projectStorageWarning && (
        <div className="mx-6 mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          {projectStorageWarning}
        </div>
      )}
      {projectSaveNotice && (
        <div
          className="mx-6 mt-4 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100"
          role="status"
        >
          {projectSaveNotice}
        </div>
      )}
      <LocalEditorSaveProjectDialog
        open={saveProjectDialogOpen}
        projectNameDraft={projectNameDraft}
        onChange={setProjectNameDraft}
        onSave={saveProject}
        onClose={() => setSaveProjectDialogOpen(false)}
      />
      <div
        ref={workspaceRef}
        data-testid="local-editor-workspace"
        className="relative grid min-h-0 flex-1 gap-2 overflow-hidden p-0 xl:grid-cols-[auto_var(--local-editor-inspector-width)_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)_minmax(280px,40vh)]"
        style={{
          "--local-editor-inspector-width": inspectorWidth
            ? `${inspectorWidth}px`
            : "minmax(260px, 320px)",
          ...(timelineHeight
            ? { gridTemplateRows: `minmax(0, 1fr) ${timelineHeight}px` }
            : {}),
        }}
      >
        <LocalEditorFeatureRail
          activeFeature={activeFeature}
          onSelect={setActiveFeature}
        />
        <main className="contents">
          <div className="min-h-0 min-w-0 xl:col-start-3 xl:row-start-1">
            <div
              ref={playerRef}
              data-testid="local-editor-player"
              tabIndex={0}
              role="region"
              aria-label="Video preview. Use Space or K to play or pause, arrow keys to seek, M to mute, and F for fullscreen."
              aria-keyshortcuts="Space K ArrowLeft ArrowRight Home End M F"
              onKeyDown={handlePlayerKeyDown}
              className={
                isFullscreen
                  ? "fixed inset-0 z-50 flex flex-col overflow-hidden bg-black p-4"
                  : "mx-auto flex h-full max-h-full w-full flex-col overflow-hidden rounded-none border border-white/10 bg-[#242424] shadow-2xl"
              }
            >
              <div
                data-testid="local-editor-player-stage"
                className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#242424]"
              >
                <div className="relative h-full max-h-full w-auto max-w-full aspect-[9/16]">
                  {remotionPreviewProps ? (
                    <RemotionPreview
                      {...remotionPreviewProps}
                      subtitles={previewSubtitles}
                      subtitleTracks={[]}
                      activeSubtitleTrackId={null}
                      hook={hook}
                      currentFrame={Math.round(
                        (playheadMs / 1000) * remotionFps,
                      )}
                      playing={isPlaying}
                      loop={isLooping}
                      playbackRate={playbackRate}
                      controls={false}
                      className="h-full w-full"
                      onFrameChange={handleRemotionFrameChange}
                      onMediaTimeChange={handleRemotionMediaTimeChange}
                      onPlayingChange={setIsPlaying}
                      onPlayerReady={handleRemotionPlayerReady}
                    />
                  ) : (
                    <>
                      <video
                        ref={videoRef}
                        data-testid="local-editor-native-video"
                        src={previewVideoUrl || videoUrl}
                        controls={false}
                        className={`h-full w-full ${shouldCropVideo ? "object-cover" : "object-contain"}`}
                        onLoadedMetadata={handleMetadata}
                        onLoadedData={detectVideoFraming}
                        onError={handleVideoError}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onEnded={() => {
                          setPlayheadMs(durationMs);
                          setIsPlaying(false);
                        }}
                        onTimeUpdate={handleVideoTimeUpdate}
                      />
                      <div className="pointer-events-none absolute inset-0">
                        {activeHook && (
                          <div
                            className="absolute w-[88%]"
                            style={{
                              left: "50%",
                              ...getHookPositionStyle(activeHook.position),
                            }}
                          >
                            <div
                              className="text-center"
                              style={{
                                ...getHookBoxStyle(activeHook),
                                ...hookEntranceStyle,
                              }}
                            >
                              {activeHook.text}
                            </div>
                          </div>
                        )}
                        {activeSubtitle && (
                          <div
                            className={`absolute left-1/2 flex w-[88%] -translate-x-1/2 flex-wrap justify-center gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-center font-semibold shadow-lg ${subtitlePositionClass(previewSubtitleStyle.position)}`}
                            style={{
                              fontFamily: previewSubtitleStyle.fontFamily,
                              fontSize: `${Math.max(12, previewSubtitleStyle.fontSize * (20 / 24))}px`,
                              textShadow: outlineTextShadow(
                                previewSubtitleStyle.borderWidth,
                                previewSubtitleStyle.borderColor,
                              ),
                              backgroundColor:
                                previewSubtitleStyle.bgOpacity > 0
                                  ? hexToRgba(
                                      previewSubtitleStyle.bgColor,
                                      previewSubtitleStyle.bgOpacity,
                                    )
                                  : "transparent",
                            }}
                          >
                            {activeSubtitleWords.map((word, index) => {
                              const isActive =
                                index === activeSubtitleWordIndex;
                              const isKaraoke =
                                previewSubtitleStyle.animation === "karaoke" &&
                                isActive;
                              return (
                                <span
                                  key={`${word.startMs}-${index}`}
                                  style={{
                                    color: isKaraoke
                                      ? previewSubtitleStyle.bgColor
                                      : isActive
                                        ? previewSubtitleStyle.highlightColor
                                        : previewSubtitleStyle.fontColor,
                                    display: "inline-block",
                                    transform:
                                      isActive &&
                                      previewSubtitleStyle.animation === "pop"
                                        ? "scale(1.1)"
                                        : "none",
                                    textShadow:
                                      previewSubtitleStyle.animation ===
                                        "word-highlight" && isActive
                                        ? `0 0 12px ${previewSubtitleStyle.highlightColor}, 0 0 24px ${previewSubtitleStyle.highlightColor}40`
                                        : "inherit",
                                    backgroundColor: isKaraoke
                                      ? previewSubtitleStyle.highlightColor
                                      : "transparent",
                                    borderRadius: isKaraoke ? 4 : 0,
                                    padding: isKaraoke ? "2px 6px" : 0,
                                  }}
                                >
                                  {word.text}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div
                data-testid="local-editor-video-controls"
                className="relative z-30 grid h-9 min-h-0 flex-none grid-cols-[1fr_auto_1fr] items-center border-t border-white/10 bg-[#202126]/95 px-2 py-0.5 text-zinc-300 shadow-lg backdrop-blur"
              >
                <div className="flex min-w-0 items-center gap-1">
                  <span
                    data-testid="local-editor-timecode"
                    className="whitespace-nowrap font-mono text-[10px] text-zinc-400"
                  >
                    <span className="text-cyan-400">
                      {formatClock(playheadMs, remotionFps)}
                    </span>{" "}
                    / {formatClock(durationMs, remotionFps)}
                  </span>
                </div>
                <div className="flex items-center justify-self-center gap-0.5">
                  <button
                    type="button"
                    aria-label="Go to beginning"
                    title="Go to beginning"
                    onClick={() => handleSeek(0)}
                    className="rounded p-1 hover:bg-white/10 hover:text-white"
                  >
                    <SkipBack size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label="Rewind 5 seconds"
                    title="Rewind 5 seconds"
                    onClick={() => seekBy(-5000)}
                    className="rounded p-1 hover:bg-white/10 hover:text-white"
                  >
                    <Rewind size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={isPlaying ? "Pause video" : "Play video"}
                    title={isPlaying ? "Pause video" : "Play video"}
                    onClick={togglePlayback}
                    className="rounded p-1 hover:bg-white/10 hover:text-white"
                  >
                    {isPlaying ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                  <button
                    type="button"
                    aria-label="Stop video"
                    title="Stop video"
                    onClick={stopVideo}
                    className="rounded p-1 hover:bg-white/10 hover:text-white"
                  >
                    <Square size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label="Fast forward 5 seconds"
                    title="Fast forward 5 seconds"
                    onClick={() => seekBy(5000)}
                    className="rounded p-1 hover:bg-white/10 hover:text-white"
                  >
                    <FastForward size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label="Go to end"
                    title="Go to end"
                    onClick={() => handleSeek(durationMs)}
                    className="rounded p-1 hover:bg-white/10 hover:text-white"
                  >
                    <SkipForward size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={isLooping ? "Disable loop" : "Enable loop"}
                    title={isLooping ? "Disable loop" : "Enable loop"}
                    onClick={toggleLoop}
                    className={`rounded p-1 hover:bg-white/10 hover:text-white ${isLooping ? "text-fuchsia-300" : ""}`}
                  >
                    <Repeat size={15} />
                  </button>
                </div>
                <div className="ml-auto flex items-center gap-0.5">
                  <div className="relative">
                    <button
                      type="button"
                      aria-label="Playback speed"
                      aria-haspopup="listbox"
                      aria-expanded={playbackRateMenuOpen}
                      onClick={() =>
                        setPlaybackRateMenuOpen((current) => !current)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Escape")
                          setPlaybackRateMenuOpen(false);
                      }}
                      className="flex h-7 min-h-7 shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/[.02] px-2 text-[10px] text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100"
                    >
                      <span>Speed</span>
                      <span className="font-medium text-zinc-100">
                        {playbackRate.toFixed(2)}x
                      </span>
                      <ChevronDown
                        size={13}
                        className={`transition-transform ${playbackRateMenuOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                    {playbackRateMenuOpen && (
                      <div
                        role="listbox"
                        aria-label="Playback speed options"
                        className="absolute bottom-8 right-0 z-40 min-w-full overflow-hidden rounded-md border border-white/10 bg-[#1b1b20] p-1 shadow-xl"
                      >
                        {PLAYBACK_RATES.map((rate) => (
                          <button
                            key={rate}
                            type="button"
                            role="option"
                            aria-selected={playbackRate === rate}
                            onClick={() => {
                              setPlaybackRate(rate);
                              setPlaybackRateMenuOpen(false);
                            }}
                            className={`block w-full rounded px-2 py-1.5 text-left text-[11px] ${playbackRate === rate ? "bg-violet-500/20 text-violet-200" : "text-zinc-300 hover:bg-white/10 hover:text-white"}`}
                          >
                            {rate.toFixed(2)}x
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={isMuted ? "Unmute video" : "Mute video"}
                    title={isMuted ? "Unmute video" : "Mute video"}
                    onClick={toggleMute}
                    className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
                  >
                    {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                  <button
                    type="button"
                    aria-label={
                      videoViewMode === "auto"
                        ? autoCrop
                          ? "Fit video"
                          : "Fill video"
                        : videoViewMode === "fill"
                          ? "Fit video"
                          : "Auto fit video"
                    }
                    title={"Change preview fit (" + videoViewLabel + ")"}
                    onClick={cycleVideoViewMode}
                    className="rounded px-1.5 py-1 text-[10px] font-semibold hover:bg-white/10 hover:text-white"
                  >
                    Full
                  </button>
                  <button
                    type="button"
                    aria-label="Aspect ratio 9:16"
                    title="Aspect ratio 9:16"
                    className="rounded-sm border border-zinc-500/70 bg-[#2b2b2b] px-1 py-0.5 text-[10px] font-medium leading-none text-zinc-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] hover:border-zinc-300 hover:bg-[#343434] hover:text-white"
                  >
                    9:16
                  </button>
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    aria-label={
                      isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
                    }
                    title={
                      isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
                    }
                    className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
                  >
                    {isFullscreen ? (
                      <Minimize2 size={14} />
                    ) : (
                      <Maximize2 size={14} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div
            data-testid="local-editor-subtitle-workspace-shell"
            className="relative min-h-0 min-w-0 xl:col-span-3 xl:col-start-1 xl:row-start-2"
          >
            <div
              data-testid="local-editor-subtitle-workspace"
              tabIndex={0}
              onKeyDown={handleTimelineKeyDown}
              className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-none border border-white/10 bg-[#101014]"
            >
              <div
                data-testid="local-editor-subtitle-toolbar"
                className="flex h-9 flex-none items-center justify-between border-b border-white/10 px-2"
              >
                <div
                  data-testid="local-editor-timeline-actions"
                  className="flex h-7 items-center gap-0.5 text-zinc-500"
                >
                  <button
                    type="button"
                    aria-label="Add cue to timeline"
                    title="Add cue to timeline"
                    onClick={addSubtitleCue}
                    className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 hover:text-white"
                  >
                    <Plus size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label="Select timeline tool"
                    title="Select timeline tool"
                    className="flex h-7 w-7 items-center justify-center rounded bg-white/10 text-zinc-200"
                  >
                    <MousePointer2 size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={
                      activeMarker ? "Remove marker (M)" : "Add marker (M)"
                    }
                    title={
                      activeMarker ? "Remove marker (M)" : "Add marker (M)"
                    }
                    aria-pressed={Boolean(activeMarker)}
                    onClick={toggleMarker}
                    className={`flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 hover:text-white ${activeMarker ? "bg-amber-300/15 text-amber-200" : ""}`}
                  >
                    <Bookmark
                      size={14}
                      fill={activeMarker ? "currentColor" : "none"}
                    />
                  </button>
                  <span
                    className="mx-1 h-5 w-px bg-white/10"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onClick={undo}
                    disabled={busy || editHistory.past.length === 0}
                    aria-label="Timeline undo"
                    title="Timeline undo (Ctrl/Cmd+Z)"
                    className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Undo2 size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={redo}
                    disabled={busy || editHistory.future.length === 0}
                    aria-label="Timeline redo"
                    title="Timeline redo (Ctrl/Cmd+Shift+Z)"
                    className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Redo2 size={15} />
                  </button>
                  <span
                    className="mx-1 h-5 w-px bg-white/10"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onClick={() => removeSubtitleCue(selected?.id)}
                    disabled={busy || selected?.type !== "subtitle"}
                    aria-label="Remove selected cue"
                    title="Remove selected cue"
                    className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {subtitleView === "timeline" && (
                    <div
                      data-testid="local-editor-timeline-zoom-controls"
                      className="flex h-7 shrink-0 items-center gap-0.5 rounded-md border border-white/10 bg-black/20 px-0.5 text-zinc-400"
                    >
                      <button
                        type="button"
                        aria-label="Fit timeline to window"
                        title="Fit timeline to window"
                        onClick={() => timelineApiRef.current?.zoomToFit()}
                        className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/10 hover:text-white"
                      >
                        <FileScan size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label="Reset timeline zoom"
                        title="Reset timeline zoom"
                        onClick={() => setTimelineZoom(1)}
                        className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/10 hover:text-white"
                      >
                        <FileScan size={14} className="opacity-70" />
                      </button>
                      <button
                        type="button"
                        aria-label="Zoom out"
                        title="Zoom out"
                        onClick={() =>
                          setTimelineZoom((current) =>
                            Number(
                              clamp(
                                current - TIMELINE_ZOOM_STEP,
                                MIN_TIMELINE_ZOOM,
                                MAX_TIMELINE_ZOOM,
                              ).toFixed(2),
                            ),
                          )
                        }
                        disabled={timelineZoom <= MIN_TIMELINE_ZOOM}
                        className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        <ZoomOut size={14} />
                      </button>
                      <input
                        type="range"
                        aria-label="Timeline zoom"
                        min={MIN_TIMELINE_ZOOM}
                        max={MAX_TIMELINE_ZOOM}
                        step={TIMELINE_ZOOM_STEP}
                        value={timelineZoom}
                        onChange={(event) =>
                          setTimelineZoom(Number(event.target.value))
                        }
                        className="h-4 w-16 accent-zinc-200"
                      />
                      <button
                        type="button"
                        aria-label="Zoom in"
                        title="Zoom in"
                        onClick={() =>
                          setTimelineZoom((current) =>
                            Number(
                              clamp(
                                current + TIMELINE_ZOOM_STEP,
                                MIN_TIMELINE_ZOOM,
                                MAX_TIMELINE_ZOOM,
                              ).toFixed(2),
                            ),
                          )
                        }
                        disabled={timelineZoom >= MAX_TIMELINE_ZOOM}
                        className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        <ZoomIn size={14} />
                      </button>
                    </div>
                  )}
                  {subtitleView === "table" && (
                    <div
                      data-testid="local-editor-playback-controls"
                      className="flex h-7 shrink-0 items-center gap-1"
                    >
                      <label className="group inline-flex h-7 shrink-0 cursor-pointer items-center">
                        <input
                          aria-label="Loop segment"
                          type="checkbox"
                          checked={loopSegment}
                          onChange={(event) =>
                            setLoopSegment(event.target.checked)
                          }
                          className="peer sr-only"
                        />
                        <span className="flex h-7 items-center rounded-md border border-white/10 px-2 text-[10px] text-zinc-400 transition-colors group-hover:border-white/20 group-hover:text-zinc-200 peer-checked:border-violet-400/50 peer-checked:bg-violet-500/15 peer-checked:text-violet-200">
                          Loop
                        </span>
                      </label>
                      <label className="group inline-flex h-7 shrink-0 cursor-pointer items-center">
                        <input
                          aria-label="Follow audio"
                          type="checkbox"
                          checked={followAudio}
                          onChange={(event) =>
                            setFollowAudio(event.target.checked)
                          }
                          className="peer sr-only"
                        />
                        <span className="flex h-7 items-center rounded-md border border-white/10 px-2 text-[10px] text-zinc-400 transition-colors group-hover:border-white/20 group-hover:text-zinc-200 peer-checked:border-violet-400/50 peer-checked:bg-violet-500/15 peer-checked:text-violet-200">
                          Follow
                        </span>
                      </label>
                      <button
                        type="button"
                        aria-label="Scroll to current subtitle"
                        title="Scroll to current subtitle"
                        onClick={scrollToCurrentSubtitle}
                        disabled={!subtitleCues.length}
                        className="flex h-7 shrink-0 items-center rounded-md border border-white/10 px-2 text-[10px] text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Current
                      </button>
                    </div>
                  )}
                  <div
                    role="tablist"
                    aria-label="Subtitle editing view"
                    className="flex h-7 shrink-0 rounded border border-white/10 bg-black/20 p-0.5"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-label="Timeline view"
                      aria-selected={subtitleView === "timeline"}
                      onClick={() => setSubtitleView("timeline")}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${subtitleView === "timeline" ? "bg-white text-black" : "text-zinc-400 hover:bg-white/10 hover:text-white"}`}
                    >
                      Timeline
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-label="Subtitle table view"
                      aria-selected={subtitleView === "table"}
                      onClick={() => setSubtitleView("table")}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${subtitleView === "table" ? "bg-violet-500 text-white" : "text-zinc-400 hover:bg-white/10 hover:text-white"}`}
                    >
                      Cue table
                    </button>
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {subtitleView === "table" ? (
                  <SubtitleCueTable
                    cues={subtitleCues}
                    selectedId={selected?.id}
                    playheadMs={playheadMs}
                    onSelect={handleTimelineSelect}
                    onChange={(cue) => updateSubtitle(cue)}
                    onDelete={removeSubtitleCue}
                    followAudio={followAudio}
                    scrollToCurrentRef={scrollToCurrentRef}
                  />
                ) : (
                  <LocalEditorTimeline
                    videoUrl={videoUrl}
                    durationMs={durationMs}
                    fps={remotionFps}
                    subtitleCues={subtitleCues}
                    hook={hook}
                    selectedId={selected?.id}
                    onSelect={(cue, type) =>
                      handleTimelineSelect(cue, type, { openEditor: false })
                    }
                    onDoubleClick={handleTimelineSelect}
                    onChange={handleTimelineChange}
                    onChangeStart={beginTimelineEdit}
                    onChangeEnd={endTimelineEdit}
                    playheadMs={playheadMs}
                    onSeek={handleSeek}
                    ref={timelineApiRef}
                    timelineZoom={timelineZoom}
                    onTimelineZoomChange={setTimelineZoom}
                    markers={markers}
                    selectedMarkerId={selectedMarkerId}
                    onMarkerSelect={selectMarker}
                    onMarkerMove={moveMarker}
                  />
                )}
              </div>
            </div>
            <button
              type="button"
              role="separator"
              aria-label="Resize preview and timeline"
              aria-orientation="horizontal"
              aria-valuemin={MIN_TIMELINE_HEIGHT}
              aria-valuemax={2000}
              aria-valuenow={Math.round(timelineHeight ?? 320)}
              title="Resize preview and timeline"
              onPointerDown={handleLayoutResizeStart}
              onPointerMove={handleLayoutResizeMove}
              onPointerUp={handleLayoutResizeEnd}
              onPointerCancel={handleLayoutResizeEnd}
              onKeyDown={handleLayoutResizeKeyDown}
              className="group absolute left-0 right-0 top-0 z-40 flex h-2 -translate-y-1/2 cursor-row-resize items-center justify-center border-y border-transparent bg-transparent hover:border-cyan-300/50 focus:border-cyan-300/70 focus:outline-none"
            >
              <span className="h-px w-12 bg-zinc-600/70 transition-colors group-hover:bg-cyan-300" />
            </button>
          </div>
        </main>
        <aside className="contents" aria-label="Inspector">
          <LocalEditorFeaturePanel
            title={activeFeatureLabel}
            className="relative xl:col-start-2 xl:row-start-1"
            overlay={
              <button
                type="button"
                role="separator"
                aria-label="Resize details panel"
                aria-orientation="vertical"
                aria-valuemin={MIN_INSPECTOR_WIDTH}
                aria-valuemax={MAX_INSPECTOR_WIDTH}
                aria-valuenow={Math.round(
                  inspectorWidth ?? DEFAULT_INSPECTOR_WIDTH,
                )}
                title="Resize details panel"
                onPointerDown={handleInspectorResizeStart}
                onPointerMove={handleInspectorResizeMove}
                onPointerUp={handleInspectorResizeEnd}
                onPointerCancel={handleInspectorResizeEnd}
                onKeyDown={handleInspectorResizeKeyDown}
                className="group absolute right-0 top-0 z-40 flex h-full w-2 translate-x-1/2 cursor-col-resize items-center justify-center border-x border-transparent bg-transparent hover:border-cyan-300/50 focus:border-cyan-300/70 focus:outline-none"
              >
                <span className="h-12 w-px bg-zinc-600/70 transition-colors group-hover:bg-cyan-300" />
              </button>
            }
          >
            <div className={activeFeature === "details" ? "" : "sr-only"}>
              <ClipMetadataPanel
                clip={clipMetadata}
                subtitleCues={subtitleCues}
                videoName={videoFile?.name || initialVideoName}
                fps={remotionFps}
                width={remotionPreviewProps?.width}
                height={remotionPreviewProps?.height}
                hashtags={clipMetadata?.hashtags}
                onHashtagsChange={onHashtagsChange}
              />
            </div>
            <section
              className={`overflow-hidden rounded-xl border border-white/10 bg-white/[.02] ${activeFeature === "subtitles" ? "" : "sr-only"}`}
            >
              <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                <button
                  type="button"
                  aria-label="Toggle Subtitles settings"
                  aria-expanded="true"
                  aria-controls="subtitle-settings-panel"
                  onClick={() => setSubtitleView("table")}
                  className="flex min-w-0 items-center gap-2 text-left"
                >
                  <span className="truncate text-sm font-semibold text-white">
                    Subtitles
                  </span>
                  <span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                    {subtitleCues.length}{" "}
                    {subtitleCues.length === 1 ? "cue" : "cues"}
                  </span>
                </button>
                <div className="flex items-center gap-2">
                  {subtitleCues.length > 0 && (
                    <button
                      type="button"
                      aria-label="Export Subtitles"
                      onClick={exportSubtitles}
                      disabled={busy}
                      className="flex h-7 items-center gap-1 rounded-md border border-violet-400/30 px-2 text-[11px] font-semibold text-violet-200 transition-colors hover:border-violet-300/60 hover:bg-violet-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Download size={14} aria-hidden="true" />
                      Export
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Open subtitle table"
                    title="Open subtitle table"
                    onClick={() => setSubtitleView("table")}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-violet-300 transition-colors hover:bg-violet-500/10 hover:text-violet-200"
                  >
                    <FileText size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div
                id="subtitle-settings-panel"
                className="border-t border-white/10 px-4 pb-4"
              >
                <section className="border-b border-white/10 pb-3">
                  <button
                    type="button"
                    aria-label="Toggle Track actions"
                    aria-expanded={subtitleTrackActionsOpen}
                    aria-controls="subtitle-track-actions-panel"
                    onClick={() => setSubtitleTrackActionsOpen((open) => !open)}
                    className="flex w-full items-center gap-2 py-2 text-left"
                  >
                    <ChevronDown
                      size={15}
                      className={`shrink-0 text-violet-300 transition-transform ${subtitleTrackActionsOpen ? "" : "-rotate-90"}`}
                    />
                    <span className="text-xs font-semibold text-zinc-100">
                      Track
                    </span>
                  </button>
                  {subtitleTrackActionsOpen && (
                    <div id="subtitle-track-actions-panel" className="pt-2">
                      <input
                        ref={subtitleInputRef}
                        type="file"
                        accept=".srt,.vtt,text/vtt,application/x-subrip"
                        aria-label="Subtitle file"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          setPendingSubtitle(file);
                          importSubtitleFile(file);
                        }}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={handleImport}
                          className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-transparent px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-violet-300/30 hover:bg-white/[.04] hover:text-violet-200"
                        >
                          <Upload size={14} />
                          Import subtitles
                        </button>
                        <button
                          type="button"
                          onClick={generateSubtitles}
                          disabled={
                            generatingSubtitles ||
                            (!videoFile && !hasProjectClipSource)
                          }
                          className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-transparent px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-fuchsia-300/30 hover:bg-white/[.04] hover:text-fuchsia-200 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {generatingSubtitles ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <FileText size={14} />
                          )}
                          {generatingSubtitles
                            ? "Transcribing…"
                            : "Generate subtitles"}
                        </button>
                      </div>
                      <div className="mt-2">
                        <button
                          type="button"
                          aria-label="Clean subtitle dots"
                          onClick={cleanSubtitleDots}
                          disabled={busy || !subtitleCues.length}
                          className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-transparent px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-amber-300/30 hover:bg-white/[.04] hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Clean subtitle dots
                        </button>
                      </div>
                      {pendingSubtitle && (
                        <p className="mt-2 truncate text-xs text-violet-300">
                          Ready: {pendingSubtitle.name}
                        </p>
                      )}
                      <div className="mt-3 border-t border-white/10 pt-3">
                        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                          <Languages size={14} className="text-cyan-300" />
                          Translate
                        </div>
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                              Source
                              <div className="relative mt-1.5">
                                <select
                                  aria-label="Subtitle source language"
                                  value={subtitleLanguage}
                                  onChange={(event) =>
                                    updateSubtitleLanguage(event.target.value)
                                  }
                                  disabled={translatingSubtitles}
                                  style={{ colorScheme: "dark" }}
                                  className="w-full appearance-none rounded-md border border-white/10 bg-transparent px-2.5 py-2 pr-8 text-xs text-zinc-200 outline-none transition-colors hover:border-white/20 focus:border-cyan-300/50"
                                >
                                  {Object.entries(SUBTITLE_LANGUAGES).map(
                                    ([code, name]) => (
                                      <option
                                        key={code}
                                        value={code}
                                        style={{
                                          backgroundColor: "#171e21",
                                          color: "#f4f4f5",
                                        }}
                                      >
                                        {name}
                                      </option>
                                    ),
                                  )}
                                </select>
                                <ChevronDown
                                  size={14}
                                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
                                />
                              </div>
                            </label>
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                              Target
                              <div className="relative mt-1.5">
                                <select
                                  aria-label="Translation target language"
                                  value={translationTarget}
                                  onChange={(event) =>
                                    setTranslationTarget(event.target.value)
                                  }
                                  disabled={translatingSubtitles}
                                  style={{ colorScheme: "dark" }}
                                  className="w-full appearance-none rounded-md border border-white/10 bg-transparent px-2.5 py-2 pr-8 text-xs text-zinc-200 outline-none transition-colors hover:border-white/20 focus:border-cyan-300/50"
                                >
                                  {Object.entries(SUBTITLE_LANGUAGES).map(
                                    ([code, name]) => (
                                      <option
                                        key={code}
                                        value={code}
                                        disabled={code === subtitleLanguage}
                                        style={{
                                          backgroundColor: "#171e21",
                                          color:
                                            code === subtitleLanguage
                                              ? "#a1a1aa"
                                              : "#f4f4f5",
                                        }}
                                      >
                                        {name}
                                        {code === subtitleLanguage
                                          ? " (source)"
                                          : ""}
                                      </option>
                                    ),
                                  )}
                                </select>
                                <ChevronDown
                                  size={14}
                                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
                                />
                              </div>
                            </label>
                          </div>
                          <button
                            type="button"
                            aria-label="Translate subtitles"
                            onClick={translateSubtitles}
                            disabled={
                              translatingSubtitles ||
                              !subtitleCues.length ||
                              translationTarget === subtitleLanguage
                            }
                            className="flex w-full items-center justify-center gap-2 rounded-md border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            {translatingSubtitles ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Languages size={14} />
                            )}
                            {translatingSubtitles
                              ? "Translating…"
                              : "Translate subtitles"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
                <section className="pt-3">
                  <button
                    type="button"
                    aria-label="Toggle Cue editing"
                    aria-expanded={cueEditingOpen}
                    aria-controls="subtitle-cue-editing-panel"
                    onClick={() => setSubtitleCueEditingOpen((open) => !open)}
                    className="flex w-full items-center gap-2 py-2 text-left"
                  >
                    <ChevronDown
                      size={15}
                      className={`shrink-0 text-violet-300 transition-transform ${cueEditingOpen ? "" : "-rotate-90"}`}
                    />
                    <span className="text-xs font-semibold text-zinc-100">
                      Style
                    </span>
                  </button>
                  {cueEditingOpen && (
                    <div id="subtitle-cue-editing-panel" className="pt-2">
                      <LocalEditorSubtitleStyleInspector
                        style={subtitleStyle}
                        onChange={updateSubtitleStyle}
                        onRemove={removeSubtitles}
                        hasCues={subtitleCues.length > 0}
                      />
                    </div>
                  )}
                </section>
              </div>
            </section>
            <section
              className={`rounded-xl border border-white/10 bg-white/[.02] p-4 ${activeFeature === "viral-hook" ? "" : "sr-only"}`}
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Toggle Viral Hook settings"
                  aria-expanded={hookOpen}
                  aria-controls="viral-hook-settings-panel"
                  onClick={() => setHookOpen((open) => !open)}
                  className="flex items-center gap-2 text-sm font-semibold text-white"
                >
                  <ChevronDown
                    size={16}
                    className={`text-amber-300 transition-transform ${hookOpen ? "" : "-rotate-90"}`}
                  />
                  Viral Hook
                </button>
                <button
                  type="button"
                  onClick={addHook}
                  className="flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/25"
                >
                  <Plus size={12} />
                  {hook ? "Reset hook" : "Add Viral Hook"}
                </button>
              </div>
              {hookOpen && (
                <div id="viral-hook-settings-panel" className="mt-3">
                  {selected?.type === "hook" ? (
                    <LocalEditorHookInspector
                      hook={selectedCue}
                      onChange={updateHook}
                      onRemove={removeHook}
                    />
                  ) : (
                    <LocalEditorHookInspector
                      hook={null}
                      onChange={updateHook}
                      onRemove={removeHook}
                    />
                  )}
                </div>
              )}
            </section>
            <div
              role="region"
              aria-label="Project context"
              className={`space-y-4 ${activeFeature === "project" ? "" : "sr-only"}`}
            >
              {sidePanel || (
                <p className="rounded-xl border border-white/10 bg-white/[.02] p-4 text-xs leading-5 text-zinc-500">
                  Open the editor from a project to see project actions.
                </p>
              )}
            </div>
            <div
              role="region"
              aria-label="Version History context"
              className={`space-y-4 ${activeFeature === "versions" ? "" : "sr-only"}`}
            >
              {versionHistoryPanel || (
                <p className="rounded-xl border border-white/10 bg-white/[.02] p-4 text-xs leading-5 text-zinc-500">
                  Version history is available for saved project versions.
                </p>
              )}
            </div>
          </LocalEditorFeaturePanel>
        </aside>
      </div>
      {footer && (
        <div className="border-t border-white/10 px-6 py-3">{footer}</div>
      )}
      {projectsDialog}
      {editingSubtitle && (
        <SubtitleCueModal
          cue={
            selected?.type === "subtitle"
              ? selectedCue || editingSubtitle
              : editingSubtitle
          }
          onClose={() => setEditingSubtitle(null)}
          onDelete={removeSubtitleCue}
          onSave={(cue) => {
            updateSubtitle(cue);
            setEditingSubtitle(null);
          }}
        />
      )}
    </div>
  );
}
