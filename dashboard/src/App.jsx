import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Upload,
  FileVideo,
  Sparkles,
  Youtube,
  Instagram,
  Share2,
  LogOut,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Activity,
  LayoutDashboard,
  Settings,
  PlusCircle,
  History,
  Menu,
  X,
  Terminal,
  Shield,
  LayoutGrid,
  Image as ImageIcon,
  Globe,
  RotateCcw,
  Calendar,
  AlertTriangle,
  KeyRound,
  Bot,
  Users,
  Smartphone,
  ExternalLink,
  Copy,
  CheckCircle2,
  FolderOpen,
  Highlighter,
  Scissors,
  Loader2,
} from "lucide-react";
import KeyInput from "./components/KeyInput";
import MediaInput from "./components/MediaInput";
import ResultCard from "./components/ResultCard";
import ProcessingAnimation from "./components/ProcessingAnimation";
// import Gallery from './components/Gallery';
import ThumbnailStudio from "./components/ThumbnailStudio";
import ProjectLibrary from "./components/ProjectLibrary";
import SaaShortsTab from "./components/SaaShortsTab";
import UGCGallery from "./components/UGCGallery";
import ScheduleWeekModal from "./components/ScheduleWeekModal";
import AISettingsPanel from "./components/AISettingsPanel";
import LocalEditorTab from "./components/local-editor/LocalEditorTab";
import HighlightsTab from "./components/HighlightsTab";

import {
  pickLmStudioModel,
  pickProviderAfterDiscoveryFailure,
} from "./lib/lmStudio";
import {
  codexPollState,
  normalizeCodexModels,
  normalizeCodexStatus,
  pickCodexEffort,
  pickCodexModel,
} from "./lib/openaiCodex";
import { getApiUrl } from "./config";
import {
  OPENROUTER_BASE_URL,
  requiresAiApiKey,
  resolveAiBaseUrl,
  shouldForwardApiKey,
} from "./lib/aiProvider";
import {
  buildEditorPath,
  buildProjectPath,
  getPathForTab,
  parseRoute,
} from "./routing";
import { buildProcessRequest } from "./lib/processRequest";
import { activeClipRenderJobs } from "./lib/clipRenderJobs";

// Enhanced "Encryption" using XOR + Base64 with a Salt
// This is better than plain Base64 but still client-side.
const SECRET_KEY =
  import.meta.env.VITE_ENCRYPTION_KEY || "OpenShorts-Static-Salt-Change-Me";
const ENCRYPTION_PREFIX = "ENC:";

const encrypt = (text) => {
  if (!text) return "";
  try {
    const xor = text
      .split("")
      .map((c, i) =>
        String.fromCharCode(
          c.charCodeAt(0) ^ SECRET_KEY.charCodeAt(i % SECRET_KEY.length),
        ),
      )
      .join("");
    return ENCRYPTION_PREFIX + btoa(xor);
  } catch (e) {
    console.error("Encryption failed", e);
    return text;
  }
};

const decrypt = (text) => {
  if (!text) return "";
  if (text.startsWith(ENCRYPTION_PREFIX)) {
    try {
      const raw = text.slice(ENCRYPTION_PREFIX.length);
      // Check if it's plain base64 or our custom XOR (simple try)
      const xor = atob(raw);
      const result = xor
        .split("")
        .map((c, i) =>
          String.fromCharCode(
            c.charCodeAt(0) ^ SECRET_KEY.charCodeAt(i % SECRET_KEY.length),
          ),
        )
        .join("");
      return result;
    } catch (e) {
      // Fallback if decryption fails (might be old plain text)
      return "";
    }
  }
  // Backward compatibility: If no prefix, assume old plain text (or return empty if you want to force re-login)
  // For migration: Return text as is, so it populates the field, and next save will encrypt it.
  return text;
};

// Simple TikTok icon sine Lucide might not have it or it varies
const TikTokIcon = ({ size = 16, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    <path d="M19.589 6.686a4.793 4.793 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-5.201 1.743l-.002-.001.002.001a2.895 2.895 0 0 1 3.183-4.51v-3.5a6.329 6.329 0 0 0-5.394 10.692 6.33 6.33 0 0 0 10.857-4.424V8.687a8.182 8.182 0 0 0 4.773 1.526V6.79a4.831 4.831 0 0 1-1.003-.104z" />
  </svg>
);

const UserProfileSelector = ({ profiles, selectedUserId, onSelect }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!profiles || profiles.length === 0) return null;

  const selectedProfile =
    profiles.find((p) => p.username === selectedUserId) || profiles[0];

  return (
    <div className="relative z-50">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-300 hover:bg-white/5 transition-colors min-w-[180px]"
      >
        <span className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-[10px] font-bold text-white">
            {selectedProfile?.username?.substring(0, 1).toUpperCase() || "U"}
          </div>
          <span className="font-medium text-white truncate max-w-[100px]">
            {selectedProfile?.username || "Select User"}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={`text-zinc-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 right-0 w-64 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {profiles.map((profile) => (
              <button
                key={profile.username}
                onClick={() => {
                  onSelect(profile.username);
                  setIsOpen(false);
                }}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors text-left group border-b border-white/5 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center text-xs font-bold text-white border border-white/10 shrink-0">
                    {profile.username.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors truncate">
                      {profile.username}
                    </div>
                    <div className="flex gap-2 mt-0.5">
                      {/* Status indicators */}
                      <div
                        className={`flex items-center gap-1 text-[10px] ${profile.connected.includes("tiktok") ? "text-zinc-300" : "text-zinc-600"}`}
                      >
                        <TikTokIcon size={10} />
                      </div>
                      <div
                        className={`flex items-center gap-1 text-[10px] ${profile.connected.includes("instagram") ? "text-pink-400" : "text-zinc-600"}`}
                      >
                        <Instagram size={10} />
                      </div>
                      <div
                        className={`flex items-center gap-1 text-[10px] ${profile.connected.includes("youtube") ? "text-red-400" : "text-zinc-600"}`}
                      >
                        <Youtube size={10} />
                      </div>
                    </div>
                  </div>
                </div>
                {selectedUserId === profile.username && (
                  <Check size={14} className="text-primary shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const SESSION_KEY = "openshorts_session";
const SESSION_MAX_AGE = 3600000; // 1 hour (matches server job retention)
const GEMINI_TEXT_MODEL = "gemini-2.5-flash";
const GEMINI_VISION_MODEL = "gemini-3.1-flash-image-preview";
const OPENROUTER_DEFAULT_MODEL = "openai/gpt-4o-mini";
const OPENROUTER_DEFAULT_TRANSCRIPTION_MODEL = "openai/whisper-large-v3";
const normalizeQualityPreset = (value) => {
  const preset = (value || "").trim().toLowerCase();
  if (preset === "fast") return "lite";
  if (["lite", "balanced", "best", "custom"].includes(preset)) return preset;
  return "balanced";
};
const QUALITY_PRESETS = {
  gemini: {
    lite: {
      text: "gemini-2.5-flash-lite",
      analyze: "gemini-2.5-flash-lite",
      vision: "gemini-2.5-flash-lite",
      image: "gemini-2.5-flash-image",
    },
    balanced: {
      text: "gemini-2.5-flash",
      analyze: "gemini-2.5-flash",
      vision: "gemini-2.5-flash",
      image: "gemini-2.5-flash-image",
    },
    best: {
      text: "gemini-2.5-pro",
      analyze: "gemini-2.5-pro",
      vision: "gemini-2.5-pro",
      image: "gemini-2.5-flash-image",
    },
  },
};
const CONFIGURED_LMSTUDIO_BASE_URL = (
  import.meta.env.VITE_AI_BASE_URL || ""
).trim();
const CONFIGURED_AI_QUALITY_PRESET = (
  import.meta.env.VITE_AI_QUALITY_PRESET || "balanced"
).trim();

// Mock polling function
const pollJob = async (jobId) => {
  const res = await fetch(getApiUrl(`/api/status/${jobId}`));
  if (!res.ok) throw new Error("Status check failed");
  return res.json();
};

function App() {
  const [apiKey, setApiKey] = useState(
    () =>
      localStorage.getItem("ai_api_key_v1") ||
      localStorage.getItem("gemini_key") ||
      "",
  );
  const [aiProvider, setAiProvider] = useState(
    () =>
      localStorage.getItem("ai_provider_v1") ||
      import.meta.env.VITE_AI_PROVIDER ||
      "gemini",
  );
  const [aiBaseUrl, setAiBaseUrl] = useState(
    () =>
      localStorage.getItem("ai_base_url_v1") ||
      CONFIGURED_LMSTUDIO_BASE_URL ||
      "",
  );
  const [aiQualityPreset, setAiQualityPreset] = useState(() =>
    normalizeQualityPreset(
      localStorage.getItem("ai_quality_preset_v1") ||
        CONFIGURED_AI_QUALITY_PRESET ||
        "balanced",
    ),
  );
  const [aiTextModel, setAiTextModel] = useState(
    () =>
      localStorage.getItem("ai_text_model_v1") ||
      import.meta.env.VITE_AI_MODEL ||
      "auto",
  );
  const [aiAnalyzeModel, setAiAnalyzeModel] = useState(
    () =>
      localStorage.getItem("ai_analyze_model_v1") ||
      import.meta.env.VITE_AI_ANALYZE_MODEL ||
      "auto",
  );
  const [aiVisionModel, setAiVisionModel] = useState(
    () =>
      localStorage.getItem("ai_vision_model_v1") ||
      import.meta.env.VITE_AI_VISION_MODEL ||
      "auto",
  );
  const [aiImageModel, setAiImageModel] = useState(
    () =>
      localStorage.getItem("ai_image_model_v1") ||
      import.meta.env.VITE_AI_IMAGE_MODEL ||
      "auto",
  );
  const [aiTextEffort, setAiTextEffort] = useState(
    () => localStorage.getItem("ai_text_effort_v1") || "auto",
  );
  const [aiAnalyzeEffort, setAiAnalyzeEffort] = useState(
    () => localStorage.getItem("ai_analyze_effort_v1") || "auto",
  );
  const [aiVisionEffort, setAiVisionEffort] = useState(
    () => localStorage.getItem("ai_vision_effort_v1") || "auto",
  );
  const [transcriptionModel, setTranscriptionModel] = useState(
    () =>
      localStorage.getItem("ai_transcription_model_v1") ||
      OPENROUTER_DEFAULT_TRANSCRIPTION_MODEL,
  );
  const [transcriptionLanguage, setTranscriptionLanguage] = useState(
    () => localStorage.getItem("ai_transcription_language_v1") || "auto",
  );
  const handleTranscriptionLanguageChange = (nextLanguage) => {
    const normalizedLanguage = nextLanguage || "auto";
    setTranscriptionLanguage(normalizedLanguage);
    localStorage.setItem("ai_transcription_language_v1", normalizedLanguage);
  };
  const [transcriptionOpenRouterProvider, setTranscriptionOpenRouterProvider] =
    useState(
      () =>
        localStorage.getItem("ai_transcription_openrouter_provider_v1") || "",
    );
  // Social API State - Load encrypted or plain
  const [uploadPostKey, setUploadPostKey] = useState(() => {
    const stored = localStorage.getItem("uploadPostKey_v3");
    if (stored) return decrypt(stored);
    return "";
  });
  // ElevenLabs API State - Load encrypted
  const [elevenLabsKey, setElevenLabsKey] = useState(() => {
    const stored = localStorage.getItem("elevenLabsKey_v1");
    if (stored) return decrypt(stored);
    return "";
  });

  // fal.ai API State - Load encrypted
  const [falKey, setFalKey] = useState(() => {
    const stored = localStorage.getItem("falKey_v1");
    if (stored) return decrypt(stored);
    return "";
  });

  const [uploadUserId, setUploadUserId] = useState(
    () => localStorage.getItem("uploadUserId") || "",
  );
  const [userProfiles, setUserProfiles] = useState([]); // List of {username, connected: []}
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState("idle"); // idle, processing, complete, error
  const [results, setResults] = useState(null);
  const [clipRenderJobs, setClipRenderJobs] = useState({});
  const [logs, setLogs] = useState([]);
  const [logsVisible, setLogsVisible] = useState(true);
  const [processingMedia, setProcessingMedia] = useState(null);
  const [route, setRoute] = useState(() => parseRoute());
  const activeTab = route.tab; // dashboard, settings, projects
  const [clipCount, setClipCount] = useState(() => {
    const stored = Number(localStorage.getItem("clip_count_v1"));
    return Number.isFinite(stored) && stored >= 3 && stored <= 15 ? stored : 6;
  });

  const [sessionRecovered, setSessionRecovered] = useState(false);
  const [showScheduleWeek, setShowScheduleWeek] = useState(false);

  const [lmStudioAvailable, setLmStudioAvailable] = useState(null);
  const [lmStudioModels, setLmStudioModels] = useState({
    textModels: [],
    visionModels: [],
  });
  const [codexStatus, setCodexStatus] = useState({
    connected: false,
    pending: false,
    requiresReconnect: false,
  });
  const [codexPending, setCodexPending] = useState(null);
  const [codexError, setCodexError] = useState("");
  const [codexModels, setCodexModels] = useState({
    models: [],
    defaultModel: "",
    loading: false,
    error: "",
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;

    fetch(getApiUrl("/api/ai/openai-codex/status"))
      .then((res) => {
        if (!res.ok)
          throw new Error("Unable to load ChatGPT connection status.");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setCodexStatus(normalizeCodexStatus(data));
      })
      .catch((error) => {
        if (!cancelled) setCodexError(error.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const connectCodex = useCallback(async () => {
    setCodexError("");
    try {
      const res = await fetch(getApiUrl("/api/ai/openai-codex/connect"), {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.detail || "Unable to start ChatGPT connection.");

      setCodexPending({
        verificationUrl: data.verificationUrl,
        userCode: data.userCode,
        intervalSeconds: data.intervalSeconds,
      });
      setCodexStatus({
        connected: false,
        pending: true,
        requiresReconnect: false,
      });
      if (data.verificationUrl)
        window.open(data.verificationUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setCodexStatus({
        connected: false,
        pending: false,
        requiresReconnect: true,
      });
      setCodexError(error.message);
    }
  }, []);

  useEffect(() => {
    if (!codexStatus.pending) return undefined;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(getApiUrl("/api/ai/openai-codex/poll"), {
          method: "POST",
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok)
          throw new Error(data.detail || "ChatGPT connection check failed.");

        const terminalState = codexPollState(data);
        if (terminalState) {
          setCodexStatus(terminalState);
          setCodexPending(null);
          if (data.status === "expired" || data.status === "error") {
            setCodexError(data.error || "ChatGPT connection expired.");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setCodexStatus({
            connected: false,
            pending: false,
            requiresReconnect: true,
          });
          setCodexPending(null);
          setCodexError(error.message);
        }
      }
    };

    poll();
    const intervalMs = Math.max(
      1000,
      Number(codexPending?.intervalSeconds || 5) * 1000,
    );
    const timer = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [codexStatus.pending, codexPending?.intervalSeconds]);

  const disconnectCodex = useCallback(async () => {
    setCodexError("");
    try {
      const res = await fetch(getApiUrl("/api/ai/openai-codex/disconnect"), {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.detail || "Unable to disconnect ChatGPT.");
      setCodexStatus(normalizeCodexStatus(data));
      setCodexPending(null);
    } catch (error) {
      setCodexError(error.message);
    }
  }, []);

  const refreshCodexModels = useCallback(async () => {
    setCodexModels((current) => ({ ...current, loading: true, error: "" }));
    try {
      const res = await fetch(getApiUrl("/api/ai/openai-codex/models"), {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data.detail || "Unable to load available Codex models.",
        );
      const catalog = normalizeCodexModels(data);
      setCodexModels({ ...catalog, loading: false, error: "", loaded: true });
    } catch (error) {
      setCodexModels((current) => ({
        ...current,
        loading: false,
        error: error.message,
        loaded: true,
      }));
    }
  }, []);

  useEffect(() => {
    if (aiProvider !== "openai-codex" || !codexStatus.connected) {
      setCodexModels({
        models: [],
        defaultModel: "",
        loading: false,
        error: "",
        loaded: false,
      });
      return undefined;
    }

    refreshCodexModels();
    return undefined;
  }, [aiProvider, codexStatus.connected, refreshCodexModels]);

  useEffect(() => {
    if (
      aiProvider !== "openai-codex" ||
      !codexStatus.connected ||
      codexModels.loading ||
      !codexModels.loaded
    )
      return;

    setAiTextModel((current) =>
      pickCodexModel({ currentModel: current, models: codexModels.models }),
    );
    setAiAnalyzeModel((current) =>
      pickCodexModel({ currentModel: current, models: codexModels.models }),
    );
    setAiVisionModel((current) =>
      pickCodexModel({ currentModel: current, models: codexModels.models }),
    );
    const defaultModel = codexModels.defaultModel;
    setAiTextEffort((current) =>
      pickCodexEffort({
        currentEffort: current,
        modelId: aiTextModel === "auto" ? defaultModel : aiTextModel,
        models: codexModels.models,
      }),
    );
    setAiAnalyzeEffort((current) =>
      pickCodexEffort({
        currentEffort: current,
        modelId: aiAnalyzeModel === "auto" ? defaultModel : aiAnalyzeModel,
        models: codexModels.models,
      }),
    );
    setAiVisionEffort((current) =>
      pickCodexEffort({
        currentEffort: current,
        modelId: aiVisionModel === "auto" ? defaultModel : aiVisionModel,
        models: codexModels.models,
      }),
    );
  }, [
    aiProvider,
    codexStatus.connected,
    codexModels.loading,
    codexModels.loaded,
    codexModels.models,
    codexModels.defaultModel,
    aiTextModel,
    aiAnalyzeModel,
    aiVisionModel,
  ]);

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      for (let attempt = 0; attempt < 5 && !cancelled; attempt += 1) {
        try {
          const res = await fetch(getApiUrl("/api/config"));
          const data = await res.json();
          const lmStudioConfig = data.lmStudioConfig;

          if (lmStudioConfig == null && attempt < 4) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            continue;
          }

          if (lmStudioConfig?.available) {
            setLmStudioAvailable(true);
            setLmStudioModels({
              textModels: lmStudioConfig.textModels || [],
              visionModels: lmStudioConfig.visionModels || [],
            });
            setAiBaseUrl((current) => {
              if ((current || "").trim()) return current;
              return lmStudioConfig.baseUrl || current;
            });
          } else {
            setLmStudioAvailable(false);
            setLmStudioModels({ textModels: [], visionModels: [] });
          }
          return;
        } catch (err) {
          console.error("Error fetching config:", err);
          if (!cancelled) {
            setLmStudioAvailable(false);
            setLmStudioModels({ textModels: [], visionModels: [] });
          }
          return;
        }
      }

      if (!cancelled) {
        setLmStudioAvailable(false);
        setLmStudioModels({ textModels: [], visionModels: [] });
      }
    };

    loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const detectLmStudio = useCallback(async () => {
    if (!aiBaseUrl) return;
    try {
      const res = await fetch(getApiUrl("/api/ai/lmstudio/discover"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: aiBaseUrl, apiKey: apiKey }),
      });
      const data = await res.json();

      if (data.available) {
        setLmStudioAvailable(true);
        setLmStudioModels({
          textModels: data.textModels || [],
          visionModels: data.visionModels || [],
        });
        setAiBaseUrl((current) => {
          if ((current || "").trim()) return current;
          return data.baseUrl || current;
        });
      } else {
        setLmStudioAvailable(false);
        setLmStudioModels({ textModels: [], visionModels: [] });
      }
    } catch (e) {
      console.error("Failed to discover LM Studio", e);
      setLmStudioAvailable(false);
      setLmStudioModels({ textModels: [], visionModels: [] });
      setAiProvider((current) =>
        pickProviderAfterDiscoveryFailure({
          currentProvider: current,
        }),
      );
    }
  }, [aiBaseUrl, apiKey]);

  useEffect(() => {
    if (aiProvider === "lmstudio" && lmStudioAvailable === false) {
      setAiProvider(
        pickProviderAfterDiscoveryFailure({
          currentProvider: "lmstudio",
        }),
      );
    }
  }, [aiProvider, aiBaseUrl, lmStudioAvailable]);

  useEffect(() => {
    if (aiProvider === "lmstudio") {
      const timer = setTimeout(() => {
        detectLmStudio();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [aiProvider, aiBaseUrl, detectLmStudio]);

  const needsOpenRouterKey = !apiKey;
  const needsAiConnection =
    (requiresAiApiKey() && !apiKey) ||
    (aiProvider === "openai-codex" && !codexStatus.connected);
  const lastProviderRef = useRef(aiProvider);

  // Sync state for original video playback
  const [syncedTime, setSyncedTime] = useState(0);
  const [isSyncedPlaying, setIsSyncedPlaying] = useState(false);
  const [syncTrigger, setSyncTrigger] = useState(0);

  const navigateToTab = useCallback((tab) => {
    const nextPath = getPathForTab(tab);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", `${nextPath}${window.location.hash}`);
    }
    setRoute(parseRoute());
  }, []);

  const navigateToProject = useCallback((projectId) => {
    window.history.pushState(
      {},
      "",
      `${buildProjectPath(projectId)}${window.location.hash}`,
    );
    setRoute(parseRoute());
  }, []);

  const navigateToEditor = useCallback(
    (projectId, clipIndex, versionId = null) => {
      window.history.pushState(
        {},
        "",
        `${buildEditorPath(projectId, clipIndex, versionId)}${window.location.hash}`,
      );
      setRoute(parseRoute());
    },
    [],
  );

  useEffect(() => {
    const handlePopState = () => setRoute(parseRoute());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleClipPlay = (startTime) => {
    setSyncedTime(startTime);
    setIsSyncedPlaying(true);
    setSyncTrigger((prev) => prev + 1);
  };

  const handleClipPause = () => {
    setIsSyncedPlaying(false);
  };

  const shouldSendAiBaseUrl = useCallback(() => {
    if (aiProvider === "openrouter") return true;
    if (aiProvider !== "lmstudio") return false;
    return !!aiBaseUrl && !!aiBaseUrl.trim();
  }, [aiProvider, aiBaseUrl]);

  // Session Recovery: Restore on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (!saved) return;
      const session = JSON.parse(saved);
      if (Date.now() - session.timestamp > SESSION_MAX_AGE) {
        localStorage.removeItem(SESSION_KEY);
        return;
      }
      if (session.jobId && session.status && session.status !== "idle") {
        setJobId(session.jobId);
        setResults(session.results || null);
        setClipRenderJobs(session.clipRenderJobs || {});
        if (session.processingMedia)
          setProcessingMedia(session.processingMedia);
        // If was processing, resume polling; if complete/error, just show results
        setStatus(
          session.status === "processing" ? "processing" : session.status,
        );
        setSessionRecovered(true);
        setTimeout(() => setSessionRecovered(false), 5000);
      }
    } catch (e) {
      localStorage.removeItem(SESSION_KEY);
    }
  }, []);

  // Session Recovery: Save state changes
  useEffect(() => {
    if (status === "idle") {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    try {
      const sessionData = {
        jobId,
        status,
        results,
        clipRenderJobs,
        processingMedia: ["url", "minio-object"].includes(processingMedia?.type)
          ? processingMedia
          : null,
        activeTab,
        timestamp: Date.now(),
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    } catch (e) {
      // localStorage full or serialization error - ignore
    }
  }, [jobId, status, results, clipRenderJobs, activeTab, processingMedia]);

  useEffect(() => {
    // Encrypt Gemini Key too for consistency if desired, but user asked specifically about Social integration not saving well.
    // For now keeping gemini plain for compatibility unless requested.
    if (apiKey) {
      localStorage.setItem("gemini_key", apiKey);
      localStorage.setItem("ai_api_key_v1", apiKey);
    }
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem("ai_provider_v1", aiProvider);
  }, [aiProvider]);

  useEffect(() => {
    localStorage.setItem("ai_base_url_v1", aiBaseUrl);
  }, [aiBaseUrl]);

  useEffect(() => {
    localStorage.setItem("ai_quality_preset_v1", aiQualityPreset);
  }, [aiQualityPreset]);

  useEffect(() => {
    localStorage.setItem("ai_text_model_v1", aiTextModel);
  }, [aiTextModel]);

  useEffect(() => {
    localStorage.setItem("ai_analyze_model_v1", aiAnalyzeModel);
  }, [aiAnalyzeModel]);

  useEffect(() => {
    localStorage.setItem("ai_vision_model_v1", aiVisionModel);
  }, [aiVisionModel]);

  useEffect(() => {
    localStorage.setItem("ai_image_model_v1", aiImageModel);
  }, [aiImageModel]);

  useEffect(() => {
    localStorage.setItem("ai_text_effort_v1", aiTextEffort);
  }, [aiTextEffort]);

  useEffect(() => {
    localStorage.setItem("ai_analyze_effort_v1", aiAnalyzeEffort);
  }, [aiAnalyzeEffort]);

  useEffect(() => {
    localStorage.setItem("ai_vision_effort_v1", aiVisionEffort);
  }, [aiVisionEffort]);

  useEffect(() => {
    localStorage.setItem("ai_transcription_model_v1", transcriptionModel);
  }, [transcriptionModel]);

  useEffect(() => {
    localStorage.setItem(
      "ai_transcription_openrouter_provider_v1",
      transcriptionOpenRouterProvider,
    );
  }, [transcriptionOpenRouterProvider]);

  useEffect(() => {
    const previousProvider = lastProviderRef.current;
    lastProviderRef.current = aiProvider;

    if (aiProvider === "openai-codex") {
      if (previousProvider !== "openai-codex") {
        setAiTextModel("auto");
        setAiAnalyzeModel("auto");
        setAiVisionModel("auto");
        setAiTextEffort("auto");
        setAiAnalyzeEffort("auto");
        setAiVisionEffort("auto");
      }
      setAiImageModel("");
      return;
    }

    if (aiProvider === "gemini") {
      setAiTextModel((current) =>
        !current || current === "" ? GEMINI_TEXT_MODEL : current,
      );
      setAiAnalyzeModel((current) =>
        !current || current === "" ? GEMINI_TEXT_MODEL : current,
      );
      setAiVisionModel((current) =>
        !current || current === "" ? GEMINI_VISION_MODEL : current,
      );
      setAiImageModel((current) =>
        !current || current === "" ? GEMINI_VISION_MODEL : current,
      );
      return;
    }

    if (aiProvider === "openrouter") {
      setAiBaseUrl(OPENROUTER_BASE_URL);
      setAiTextModel((current) => current || OPENROUTER_DEFAULT_MODEL);
      setAiAnalyzeModel((current) => current || OPENROUTER_DEFAULT_MODEL);
      setAiVisionModel((current) => current || OPENROUTER_DEFAULT_MODEL);
      setAiImageModel("");
      return;
    }

    if (previousProvider === "gemini") {
      setAiTextModel("");
      setAiAnalyzeModel("");
      setAiVisionModel("");
      setAiImageModel("");
    }
  }, [aiProvider]);

  useEffect(() => {
    if (aiProvider === "lmstudio") {
      const nextTextModel = pickLmStudioModel({
        currentModel: aiTextModel,
        models: lmStudioModels.textModels,
      });
      if (nextTextModel && nextTextModel !== aiTextModel) {
        setAiTextModel(nextTextModel);
      }

      const nextAnalyzeModel = pickLmStudioModel({
        currentModel: aiAnalyzeModel,
        models: lmStudioModels.textModels,
      });
      if (nextAnalyzeModel && nextAnalyzeModel !== aiAnalyzeModel) {
        setAiAnalyzeModel(nextAnalyzeModel);
      }

      const nextVisionModel = pickLmStudioModel({
        currentModel: aiVisionModel,
        models: lmStudioModels.visionModels,
      });
      if (
        nextVisionModel !== aiVisionModel &&
        (nextVisionModel || aiVisionModel)
      ) {
        setAiVisionModel(nextVisionModel);
      }
    }
  }, [aiProvider, aiTextModel, aiAnalyzeModel, aiVisionModel, lmStudioModels]);

  useEffect(() => {
    if (aiQualityPreset === "custom") return;
    const preset = QUALITY_PRESETS[aiProvider]?.[aiQualityPreset];
    if (!preset) return;
    setAiTextModel(preset.text);
    setAiAnalyzeModel(preset.analyze);
    setAiVisionModel(preset.vision);
    setAiImageModel(preset.image);
  }, [aiProvider, aiQualityPreset]);

  useEffect(() => {
    localStorage.setItem("clip_count_v1", String(clipCount));
  }, [clipCount]);

  useEffect(() => {
    if (uploadPostKey) {
      localStorage.setItem("uploadPostKey_v3", encrypt(uploadPostKey));
    }
    if (uploadUserId) {
      localStorage.setItem("uploadUserId", uploadUserId);
    }
  }, [uploadPostKey, uploadUserId]);

  useEffect(() => {
    if (elevenLabsKey) {
      localStorage.setItem("elevenLabsKey_v1", encrypt(elevenLabsKey));
    }
  }, [elevenLabsKey]);

  useEffect(() => {
    if (falKey) {
      localStorage.setItem("falKey_v1", encrypt(falKey));
    }
  }, [falKey]);

  const getAiHeaders = (
    contentType = null,
    { requiresRemoteTranscription = false } = {},
  ) => {
    const headers = {
      "X-AI-Provider": aiProvider,
      "X-AI-Model": aiTextModel,
      "X-AI-Analyze-Model": aiAnalyzeModel,
      "X-AI-Vision-Model": aiVisionModel,
      "X-AI-Image-Model": aiImageModel,
      "X-AI-Reasoning-Effort": aiTextEffort,
      "X-AI-Analyze-Reasoning-Effort": aiAnalyzeEffort,
      "X-AI-Vision-Reasoning-Effort": aiVisionEffort,
      "X-AI-Transcription-Model": transcriptionModel,
      "X-AI-Transcription-Language": transcriptionLanguage,
    };
    const configuredTranscriptionProvider =
      transcriptionOpenRouterProvider.trim();
    if (configuredTranscriptionProvider) {
      headers["X-AI-Transcription-OpenRouter-Provider"] =
        configuredTranscriptionProvider;
    }

    if (shouldSendAiBaseUrl()) {
      headers["X-AI-Base-Url"] = resolveAiBaseUrl(aiProvider, aiBaseUrl);
    }

    if (aiProvider === "gemini" && apiKey) {
      headers["X-Gemini-Key"] = apiKey;
    } else if (
      apiKey &&
      shouldForwardApiKey(aiProvider, { requiresRemoteTranscription })
    ) {
      headers["X-AI-Api-Key"] = apiKey;
    }

    if (contentType === "json") {
      headers["Content-Type"] = "application/json";
    }

    return headers;
  };

  const fetchUserProfiles = useCallback(async () => {
    if (!uploadPostKey) return;
    try {
      const res = await fetch(getApiUrl("/api/social/user"), {
        headers: { "X-Upload-Post-Key": uploadPostKey },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      if (data.profiles && data.profiles.length > 0) {
        setUserProfiles(data.profiles);
        // Auto select first if none selected
        if (!uploadUserId) {
          setUploadUserId(data.profiles[0].username);
        }
      } else {
        alert("No profiles found for this API Key.");
      }
    } catch (e) {
      alert("Error fetching User Profiles. Please check key.");
      console.error(e);
    }
  }, [uploadPostKey, uploadUserId]);

  useEffect(() => {
    if (uploadPostKey && userProfiles.length === 0) {
      fetchUserProfiles();
    }
  }, [uploadPostKey, userProfiles.length, fetchUserProfiles]);

  useEffect(() => {
    let interval;
    if (status === "processing" && jobId) {
      interval = setInterval(async () => {
        try {
          const data = await pollJob(jobId);
          console.log("Job status:", data);

          // Update results if available (real-time)
          if (data.result) {
            setResults(data.result);
          }

          if (data.status === "clips_ready") {
            setStatus("clips-ready");
            const activeRenders = activeClipRenderJobs(data.clip_renders);
            setClipRenderJobs(activeRenders);
            if (Object.keys(activeRenders).length === 0)
              clearInterval(interval);
          } else if (data.status === "completed") {
            setStatus("complete");
            clearInterval(interval);
          } else if (data.status === "failed") {
            setStatus("error");
            const errorMsg =
              data.error ||
              (data.logs && data.logs.length > 0
                ? data.logs[data.logs.length - 1]
                : "Process failed");
            setLogs((prev) => [...prev, "Error: " + errorMsg]);
            clearInterval(interval);
          } else {
            // Update logs if available
            if (data.logs) setLogs(data.logs);
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [status, jobId]);

  useEffect(() => {
    const entries = Object.entries(clipRenderJobs);
    if (entries.length === 0) return undefined;
    let cancelled = false;
    const pollClipRenders = async () => {
      const completed = [];
      await Promise.all(
        entries.map(async ([clipIndex, renderJobId]) => {
          try {
            const data = await pollJob(renderJobId);
            if (data.status === "completed" || data.status === "failed") {
              completed.push({ clipIndex: Number(clipIndex), data });
            }
          } catch (error) {
            console.error("Clip render polling error", error);
          }
        }),
      );
      if (cancelled || completed.length === 0) return;
      const parent = await pollJob(jobId);
      if (cancelled) return;
      if (parent.result) setResults(parent.result);
      setClipRenderJobs((current) => {
        const next = { ...current };
        completed.forEach(({ clipIndex, data }) => {
          if (data.status === "failed") {
            setResults((currentResult) => {
              if (!currentResult?.clips?.[clipIndex]) return currentResult;
              const clips = [...currentResult.clips];
              clips[clipIndex] = {
                ...clips[clipIndex],
                render_status: "failed",
                render_error: data.error || "Clip render failed",
              };
              return { ...currentResult, clips };
            });
          }
          delete next[clipIndex];
        });
        return next;
      });
    };
    pollClipRenders();
    const timer = setInterval(pollClipRenders, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [clipRenderJobs, jobId]);

  const handleProcess = async (data) => {
    if (requiresAiApiKey() && !apiKey) {
      setShowKeyModal(true);
      return;
    }
    if (aiProvider === "openai-codex" && !codexStatus.connected) {
      navigateToTab("settings");
      setLogs([
        codexStatus.requiresReconnect
          ? "Reconnect ChatGPT in Settings before processing."
          : "Connect ChatGPT in Settings before processing.",
      ]);
      setStatus("error");
      return;
    }
    if (aiProvider === "lmstudio" && !aiBaseUrl.trim()) {
      navigateToTab("settings");
      setLogs(["LM Studio mode needs a Base URL. Set it in Settings first."]);
      setStatus("error");
      return;
    }
    setStatus("processing");
    setLogs(["Starting process..."]);
    setResults(null);
    setClipRenderJobs({});
    setProcessingMedia(data);

    try {
      const { headers, body } = buildProcessRequest({
        data,
        headers: getAiHeaders(null, { requiresRemoteTranscription: true }),
      });
      const selectedClipCount = data.clipCount || clipCount;
      const processUrl = getApiUrl(
        `/api/process?clip_count=${encodeURIComponent(selectedClipCount)}`,
      );

      const res = await fetch(processUrl, {
        method: "POST",
        headers,
        body,
      });

      if (!res.ok) throw new Error(await res.text());
      const resData = await res.json();
      setJobId(resData.job_id);
    } catch (e) {
      setStatus("error");
      setLogs((l) => [...l, `Error starting job: ${e.message}`]);
    }
  };

  const handleReset = () => {
    setStatus("idle");
    setJobId(null);
    setResults(null);
    setClipRenderJobs({});
    setLogs([]);
    setProcessingMedia(null);
    localStorage.removeItem(SESSION_KEY);
  };

  const handleRenderClip = async (clipIndex) => {
    if (!jobId) return;
    try {
      const response = await fetch(
        getApiUrl(`/api/jobs/${jobId}/clips/${clipIndex}/render`),
        {
          method: "POST",
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.detail || "Could not queue clip render");
      setClipRenderJobs((current) => ({
        ...current,
        [clipIndex]: data.job_id,
      }));
      setResults((current) => {
        if (!current?.clips?.[clipIndex]) return current;
        const clips = [...current.clips];
        clips[clipIndex] = {
          ...clips[clipIndex],
          render_status: "queued",
          render_job_id: data.job_id,
        };
        return { ...current, clips };
      });
    } catch (error) {
      setResults((current) => {
        if (!current?.clips?.[clipIndex]) return current;
        const clips = [...current.clips];
        clips[clipIndex] = {
          ...clips[clipIndex],
          render_status: "failed",
          render_error: error.message,
        };
        return { ...current, clips };
      });
    }
  };

  const handleSaveClipRange = async (clipIndex, range) => {
    if (!jobId) return false;
    try {
      const response = await fetch(
        getApiUrl(`/api/jobs/${jobId}/clips/${clipIndex}/source-range`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(range),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.detail || "Could not save clip range");
      setResults((current) => {
        if (!current?.clips?.[clipIndex]) return current;
        const clips = [...current.clips];
        clips[clipIndex] = {
          ...clips[clipIndex],
          start: data.start,
          end: data.end,
        };
        return { ...current, clips };
      });
      return { start: data.start, end: data.end };
    } catch (error) {
      return false;
    }
  };

  // --- UI Components ---

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("openshorts_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("openshorts_sidebar_collapsed", String(next));
      } catch (error) {
        console.warn("Unable to persist sidebar preference", error);
      }
      return next;
    });
  };

  const NavItem = ({
    tabKey,
    icon: Icon,
    label,
    activeColor = "bg-primary/10 text-primary",
  }) => {
    const isActive = activeTab === tabKey;
    return (
      <div className="relative group/nav">
        <button
          onClick={() => navigateToTab(tabKey)}
          className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${
            isActive
              ? activeColor
              : "text-zinc-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Icon size={20} className="shrink-0" />
          <span
            className={`font-medium whitespace-nowrap overflow-hidden transition-all duration-300 ${
              sidebarCollapsed ? "w-0 opacity-0" : "w-auto opacity-100"
            }`}
          >
            {label}
          </span>
        </button>
        {sidebarCollapsed && (
          <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 px-2.5 py-1.5 rounded-lg bg-zinc-800 text-white text-xs font-medium shadow-xl opacity-0 group-hover/nav:opacity-100 transition-opacity duration-150 whitespace-nowrap">
            {label}
          </div>
        )}
      </div>
    );
  };

  const Sidebar = () => (
    <div
      className="bg-surface border-r border-white/5 flex flex-col h-full shrink-0 transition-all duration-300 relative"
      style={{ width: sidebarCollapsed ? "72px" : "256px" }}
    >
      {/* Logo + toggle */}
      <div
        className={`flex items-center transition-all duration-300 ${
          sidebarCollapsed ? "p-4 justify-center" : "px-4 py-5"
        }`}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center shrink-0 overflow-hidden border border-white/5">
            <img
              src="/logo-openshorts.png"
              alt="Logo"
              className="w-full h-full object-cover"
            />
          </div>
          <span
            className={`font-bold text-lg text-white tracking-tight whitespace-nowrap overflow-hidden transition-all duration-300 ${
              sidebarCollapsed ? "w-0 opacity-0" : "w-auto opacity-100"
            }`}
          >
            OpenShorts
          </span>
        </div>
        <button
          onClick={toggleSidebar}
          className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/8 transition-colors"
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed ? (
            <ChevronRight size={14} />
          ) : (
            <ChevronLeft size={14} />
          )}
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        <NavItem
          tabKey="dashboard"
          icon={LayoutDashboard}
          label="Clip Generator"
          activeColor="bg-primary/10 text-primary"
        />
        <NavItem
          tabKey="editor"
          icon={Scissors}
          label="Local Editor"
          activeColor="bg-fuchsia-500/10 text-fuchsia-400"
        />
        <NavItem
          tabKey="highlights"
          icon={Highlighter}
          label="Highlights"
          activeColor="bg-primary/10 text-primary"
        />
        <NavItem
          tabKey="saasshorts"
          icon={Sparkles}
          label="AI Shorts"
          activeColor="bg-violet-500/10 text-violet-400"
        />
        <NavItem
          tabKey="ai-agent"
          icon={Bot}
          label="AI Agent"
          activeColor="bg-emerald-500/10 text-emerald-400"
        />
        <NavItem
          tabKey="ugc-gallery"
          icon={LayoutGrid}
          label="UGC Gallery"
          activeColor="bg-violet-500/10 text-violet-400"
        />
        <NavItem
          tabKey="thumbnails"
          icon={ImageIcon}
          label="YouTube Studio"
          activeColor="bg-primary/10 text-primary"
        />
        <NavItem
          tabKey="projects"
          icon={FolderOpen}
          label="Projects"
          activeColor="bg-cyan-500/10 text-cyan-400"
        />
        <NavItem
          tabKey="settings"
          icon={Settings}
          label="Settings"
          activeColor="bg-primary/10 text-primary"
        />
      </nav>
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden selection:bg-primary/30">
      <Sidebar />

      {route.editor && (
        <div
          data-testid="editor-route-loading"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0d0d0f] text-white"
          aria-hidden="true"
        >
          <div className="flex flex-col items-center gap-3 text-zinc-300">
            <Loader2
              className="h-8 w-8 animate-spin text-cyan-300"
              aria-hidden="true"
            />
            <span className="text-sm">Loading editor...</span>
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Background Gradients */}
        <div className="absolute inset-0 overflow-hidden -z-10 pointer-events-none">
          <div className="absolute -top-[10%] -right-[10%] w-[50%] h-[50%] bg-primary/5 rounded-full blur-[120px]" />
        </div>

        {/* Top Header */}
        {activeTab !== "editor" && (
          <header className="h-16 border-b border-white/5 bg-background/50 backdrop-blur-md flex items-center justify-between px-6 shrink-0 z-10">
            <div className="flex items-center gap-4">
              {status !== "idle" && (
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
                >
                  <PlusCircle size={16} />
                  <span className="hidden sm:inline">New Project</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-4">
              {userProfiles.length > 0 && (
                <UserProfileSelector
                  profiles={userProfiles}
                  selectedUserId={uploadUserId}
                  onSelect={setUploadUserId}
                />
              )}

              {needsAiConnection && (
                <button
                  onClick={() => navigateToTab("settings")}
                  className="text-xs text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1 rounded-full border border-amber-500/30 transition-colors flex items-center gap-1.5"
                  title="Click to configure your API keys"
                >
                  <AlertTriangle size={12} />
                  {aiProvider === "openai-codex" && !needsOpenRouterKey
                    ? "Connect ChatGPT"
                    : `${needsOpenRouterKey ? "OpenRouter" : "Gemini"} API Key Missing`}
                </button>
              )}
            </div>
          </header>
        )}

        {/* Persistent Missing Keys Banner — visible on every screen */}
        {needsAiConnection && activeTab !== "settings" && (
          <div className="mx-6 mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between gap-4 shrink-0 animate-[fadeIn_0.3s_ease-out]">
            <div className="flex items-center gap-3 text-sm text-amber-200">
              <KeyRound size={16} className="shrink-0 text-amber-400" />
              <div>
                <span className="font-semibold">
                  {aiProvider === "openai-codex" && !needsOpenRouterKey
                    ? "ChatGPT connection required."
                    : `${needsOpenRouterKey ? "OpenRouter" : "Gemini"} API key missing.`}
                </span>{" "}
                <span className="text-amber-200/80">
                  {aiProvider === "openai-codex" && !needsOpenRouterKey
                    ? "Connect your ChatGPT account in Settings to use OpenAI Codex. Upload-Post is optional and only needed for social publishing."
                    : `Set your ${needsOpenRouterKey ? "OpenRouter" : "Gemini"} API key to use OpenShorts. Upload-Post is optional and only needed if you want social publishing.`}
                </span>
              </div>
            </div>
            <button
              onClick={() => navigateToTab("settings")}
              className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black transition-colors"
            >
              Go to Settings
            </button>
          </div>
        )}

        {/* Session Recovery Banner */}
        {sessionRecovered && (
          <div className="mx-6 mt-2 p-3 bg-primary/10 border border-primary/20 rounded-xl flex items-center justify-between animate-[fadeIn_0.3s_ease-out] shrink-0">
            <div className="flex items-center gap-2 text-sm text-primary">
              <RotateCcw size={16} />
              <span className="font-medium">Session recovered</span>
              <span className="text-zinc-400 text-xs">
                Your previous work has been restored.
              </span>
            </div>
            <button
              onClick={() => setSessionRecovered(false)}
              className="text-zinc-500 hover:text-white transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Main Workspace */}
        <div className="flex-1 overflow-hidden relative">
          {/* View: Settings */}
          {activeTab === "settings" && (
            <div className="h-full overflow-y-auto p-8 max-w-2xl mx-auto animate-[fadeIn_0.3s_ease-out]">
              <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl font-bold">Settings</h1>
                <div className="px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full text-[10px] text-green-400 font-medium flex items-center gap-2">
                  <Shield size={12} /> Privacy: keys only live in your browser
                  (sent to backend just to process)
                </div>
              </div>
              <AISettingsPanel
                aiProvider={aiProvider}
                setAiProvider={setAiProvider}
                apiKey={apiKey}
                setApiKey={setApiKey}
                aiBaseUrl={aiBaseUrl}
                setAiBaseUrl={setAiBaseUrl}
                aiQualityPreset={aiQualityPreset}
                setAiQualityPreset={setAiQualityPreset}
                aiTextModel={aiTextModel}
                setAiTextModel={setAiTextModel}
                aiAnalyzeModel={aiAnalyzeModel}
                setAiAnalyzeModel={setAiAnalyzeModel}
                aiVisionModel={aiVisionModel}
                setAiVisionModel={setAiVisionModel}
                aiImageModel={aiImageModel}
                setAiImageModel={setAiImageModel}
                aiTextEffort={aiTextEffort}
                setAiTextEffort={setAiTextEffort}
                aiAnalyzeEffort={aiAnalyzeEffort}
                setAiAnalyzeEffort={setAiAnalyzeEffort}
                aiVisionEffort={aiVisionEffort}
                setAiVisionEffort={setAiVisionEffort}
                transcriptionModel={transcriptionModel}
                setTranscriptionModel={setTranscriptionModel}
                transcriptionLanguage={transcriptionLanguage}
                setTranscriptionLanguage={handleTranscriptionLanguageChange}
                transcriptionOpenRouterProvider={
                  transcriptionOpenRouterProvider
                }
                setTranscriptionOpenRouterProvider={
                  setTranscriptionOpenRouterProvider
                }
                lmStudioAvailable={lmStudioAvailable}
                lmStudioModels={lmStudioModels}
                codexStatus={codexStatus}
                codexPending={codexPending}
                codexError={codexError}
                codexModels={codexModels}
                codexModelsLoading={codexModels.loading}
                codexModelsError={codexModels.error}
                onConnectCodex={connectCodex}
                onDisconnectCodex={disconnectCodex}
                onRefreshCodexModels={refreshCodexModels}
                onDetectLmStudio={detectLmStudio}
              />

              {aiProvider === "gemini" && (
                <KeyInput
                  onKeySet={(key) => {
                    setApiKey(key);
                    setAiProvider("gemini");
                  }}
                  savedKey={apiKey}
                />
              )}

              <div
                className={`glass-panel p-6 mt-8 ${!uploadPostKey ? "border-amber-500/30 ring-1 ring-amber-500/20" : ""}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Social Integration</h2>
                  <span className="text-[10px] bg-white/5 border border-white/5 px-2 py-0.5 rounded text-zinc-500 uppercase tracking-wider">
                    Optional
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mb-6 leading-relaxed">
                  Optional. Connect <strong>Upload-Post</strong> only if you
                  want to publish your clips to TikTok, Instagram Reels, and
                  YouTube Shorts. The core clip generation workflow works fully
                  locally without it.
                </p>
                <div className="space-y-4">
                  <label className="block text-sm text-zinc-400">
                    Upload-Post API Key
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={uploadPostKey}
                      onChange={(e) => setUploadPostKey(e.target.value)}
                      className="input-field"
                      placeholder="ey..."
                    />
                    <button
                      onClick={fetchUserProfiles}
                      className="btn-primary py-2 px-4 text-sm"
                    >
                      Connect
                    </button>
                  </div>
                  <div className="text-xs text-zinc-500 leading-relaxed">
                    Connect your Upload-Post account if you want publishing
                    features.
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <a
                        href="https://app.upload-post.com/login"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 border border-white/5 rounded-lg hover:bg-white/5 transition-colors flex flex-col gap-1"
                      >
                        <span className="text-zinc-400 font-medium">
                          1. Login
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          Register account
                        </span>
                      </a>
                      <a
                        href="https://app.upload-post.com/manage-users"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 border border-white/5 rounded-lg hover:bg-white/5 transition-colors flex flex-col gap-1"
                      >
                        <span className="text-zinc-400 font-medium">
                          2. Profiles
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          Create & Connect
                        </span>
                      </a>
                      <a
                        href="https://app.upload-post.com/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 border border-white/5 rounded-lg hover:bg-white/5 transition-colors flex flex-col gap-1"
                      >
                        <span className="text-zinc-400 font-medium">
                          3. API Key
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          Generate key
                        </span>
                      </a>
                    </div>
                    <br />
                    <span className="text-zinc-600 italic">
                      Keys are only stored in your browser. They are sent to the
                      backend only when you publish, never stored server-side.
                    </span>
                  </div>
                </div>
              </div>

              <div className="glass-panel p-6 mt-8">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Video Translation</h2>
                  <span className="text-[10px] bg-white/5 border border-white/5 px-2 py-0.5 rounded text-zinc-500 uppercase tracking-wider">
                    Optional
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mb-6 leading-relaxed">
                  Translate your clips to different languages using{" "}
                  <strong>ElevenLabs</strong> AI dubbing. Automatically
                  translates speech while preserving the original voice
                  characteristics.
                </p>
                <div className="space-y-4">
                  <label className="block text-sm text-zinc-400">
                    ElevenLabs API Key
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={elevenLabsKey}
                      onChange={(e) => setElevenLabsKey(e.target.value)}
                      className="input-field"
                      placeholder="sk_..."
                    />
                    <button
                      onClick={() => {
                        if (elevenLabsKey) {
                          localStorage.setItem(
                            "elevenLabsKey_v1",
                            encrypt(elevenLabsKey),
                          );
                          alert("ElevenLabs API Key saved!");
                        }
                      }}
                      className="btn-primary py-2 px-4 text-sm"
                    >
                      Save
                    </button>
                  </div>
                  <div className="text-xs text-zinc-500 leading-relaxed">
                    Get your API key from ElevenLabs to enable video
                    translation.
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <a
                        href="https://elevenlabs.io/sign-up"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 border border-white/5 rounded-lg hover:bg-white/5 transition-colors flex flex-col gap-1"
                      >
                        <span className="text-zinc-400 font-medium">
                          1. Sign Up
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          Create account
                        </span>
                      </a>
                      <a
                        href="https://elevenlabs.io/app/settings/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 border border-white/5 rounded-lg hover:bg-white/5 transition-colors flex flex-col gap-1"
                      >
                        <span className="text-zinc-400 font-medium">
                          2. API Key
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          Generate key
                        </span>
                      </a>
                    </div>
                    <br />
                    <span className="text-zinc-600 italic">
                      Keys are only stored in your browser. They are sent to the
                      backend only to process your request, never stored
                      server-side.
                    </span>
                  </div>
                </div>
              </div>

              <div className="glass-panel p-6 mt-8">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">
                    AI Shorts (UGC Videos)
                  </h2>
                  <span className="text-[10px] bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded text-violet-400 uppercase tracking-wider">
                    New
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mb-6 leading-relaxed">
                  Generate UGC-style videos with AI actors for any product or
                  business using <strong>fal.ai</strong>. Just describe your
                  product or paste a URL. Requires fal.ai + ElevenLabs API keys.
                </p>
                <div className="space-y-4">
                  <label className="block text-sm text-zinc-400">
                    fal.ai API Key
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={falKey}
                      onChange={(e) => setFalKey(e.target.value)}
                      className="input-field"
                      placeholder="fal_..."
                    />
                    <button
                      onClick={() => {
                        if (falKey) {
                          localStorage.setItem("falKey_v1", encrypt(falKey));
                          alert("fal.ai API Key saved!");
                        }
                      }}
                      className="btn-primary py-2 px-4 text-sm"
                    >
                      Save
                    </button>
                  </div>
                  <div className="text-xs text-zinc-500 leading-relaxed">
                    Get your API key from fal.ai to enable AI actor video
                    generation.
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <a
                        href="https://fal.ai/dashboard/keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 border border-white/5 rounded-lg hover:bg-white/5 transition-colors flex flex-col gap-1"
                      >
                        <span className="text-zinc-400 font-medium">
                          1. Sign Up
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          Create fal.ai account
                        </span>
                      </a>
                      <a
                        href="https://fal.ai/dashboard/keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 border border-white/5 rounded-lg hover:bg-white/5 transition-colors flex flex-col gap-1"
                      >
                        <span className="text-zinc-400 font-medium">
                          2. API Key
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          Generate key
                        </span>
                      </a>
                    </div>
                    <br />
                    <span className="text-zinc-600 italic">
                      Keys are only stored in your browser. Sent to backend only
                      to process requests.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "editor" && <LocalEditorTab />}

          {activeTab === "highlights" && (
            <HighlightsTab
              getAiHeaders={getAiHeaders}
              aiProvider={aiProvider}
            />
          )}

          {/* View: SaaS Shorts */}
          {activeTab === "saasshorts" && (
            <SaaShortsTab
              aiProvider={aiProvider}
              aiApiKey={apiKey}
              getAiHeaders={getAiHeaders}
              elevenLabsKey={elevenLabsKey}
              falKey={falKey}
              uploadPostKey={uploadPostKey}
              uploadUserId={uploadUserId}
            />
          )}

          {/* View: AI Agent */}
          {activeTab === "ai-agent" && (
            <div className="h-full overflow-y-auto custom-scrollbar p-6 md:p-10 animate-[fadeIn_0.3s_ease-out]">
              <div className="max-w-4xl mx-auto space-y-8">
                {/* Header */}
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[11px] uppercase tracking-wider text-emerald-400 font-semibold">
                    <Bot size={12} /> Autonomous Skill
                  </div>
                  <h1 className="text-3xl md:text-4xl font-black bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
                    Your Personal Clipping Team
                  </h1>
                  <p className="text-zinc-400 text-base md:text-lg leading-relaxed max-w-2xl">
                    Drop your videos in a folder and a team of AI clippers picks
                    the viral moments, edits them, and queues them for your
                    approval — like having a 24/7 short-form editing crew on
                    autopilot.
                  </p>
                </div>

                {/* Mobile-format warning */}
                <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-start gap-3">
                  <Smartphone
                    size={20}
                    className="text-amber-400 shrink-0 mt-0.5"
                  />
                  <div className="text-sm text-amber-100">
                    <p className="font-semibold text-amber-300 mb-1">
                      Upload videos already in vertical (9:16) mobile format.
                    </p>
                    <p className="text-amber-100/80 leading-relaxed">
                      The agent does not reframe horizontal footage. Make sure
                      every source video is shot or pre-cropped to
                      mobile/portrait format before dropping it into the input
                      folder.
                    </p>
                  </div>
                </div>

                {/* Workflow */}
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="glass-panel p-5 space-y-2">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                      <Upload size={18} />
                    </div>
                    <h3 className="font-semibold text-white">
                      1. Drop your videos
                    </h3>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Put your long-form vertical footage in the watched folder.
                      The skill picks one video per run.
                    </p>
                  </div>

                  <div className="glass-panel p-5 space-y-2">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                      <Users size={18} />
                    </div>
                    <h3 className="font-semibold text-white">
                      2. AI clippers work
                    </h3>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Whisper transcribes, Gemini 3 Flash spots viral beats,
                      FFmpeg cuts each clip and adds a hook overlay.
                    </p>
                  </div>

                  <div className="glass-panel p-5 space-y-2">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                      <CheckCircle2 size={18} />
                    </div>
                    <h3 className="font-semibold text-white">
                      3. You validate, it ships
                    </h3>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Approve the candidates you like and the skill
                      auto-publishes them to TikTok, Reels and YouTube Shorts
                      via Upload-Post.
                    </p>
                  </div>
                </div>

                {/* Repo CTA */}
                <div className="glass-panel p-6 md:p-8 space-y-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <h2 className="text-xl font-bold text-white mb-1">
                        skill-autoshorts
                      </h2>
                      <p className="text-sm text-zinc-400">
                        The Claude Code skill that powers this workflow. Install
                        it once and trigger it whenever you want a fresh batch
                        of clips.
                      </p>
                    </div>
                    <a
                      href="https://github.com/mutonby/skill-autoshorts"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary py-2 px-4 text-sm flex items-center gap-2 shrink-0"
                    >
                      View on GitHub <ExternalLink size={14} />
                    </a>
                  </div>

                  <div className="bg-[#0c0c0e] border border-white/10 rounded-lg p-4 font-mono text-xs text-zinc-300 flex items-center justify-between gap-3">
                    <span className="truncate">
                      git clone https://github.com/mutonby/skill-autoshorts
                    </span>
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(
                          "git clone https://github.com/mutonby/skill-autoshorts",
                        )
                      }
                      className="text-zinc-500 hover:text-white transition-colors shrink-0"
                      title="Copy"
                    >
                      <Copy size={14} />
                    </button>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    <div className="flex items-start gap-2 text-zinc-300">
                      <Check
                        size={16}
                        className="text-emerald-400 shrink-0 mt-0.5"
                      />
                      <span>Daily batch — picks one long video per run</span>
                    </div>
                    <div className="flex items-start gap-2 text-zinc-300">
                      <Check
                        size={16}
                        className="text-emerald-400 shrink-0 mt-0.5"
                      />
                      <span>Whisper transcription with word-level timing</span>
                    </div>
                    <div className="flex items-start gap-2 text-zinc-300">
                      <Check
                        size={16}
                        className="text-emerald-400 shrink-0 mt-0.5"
                      />
                      <span>Gemini 3 Flash multimodal moment detection</span>
                    </div>
                    <div className="flex items-start gap-2 text-zinc-300">
                      <Check
                        size={16}
                        className="text-emerald-400 shrink-0 mt-0.5"
                      />
                      <span>
                        Auto-publish to TikTok, Reels & YouTube Shorts
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* View: UGC Gallery */}
          {activeTab === "ugc-gallery" && <UGCGallery />}

          {/* View: Thumbnails */}
          {activeTab === "thumbnails" && (
            <ThumbnailStudio
              aiProvider={aiProvider}
              aiApiKey={apiKey}
              getAiHeaders={getAiHeaders}
              uploadPostKey={uploadPostKey}
              uploadUserId={uploadUserId}
            />
          )}

          {activeTab === "projects" && (
            <ProjectLibrary
              aiProvider={aiProvider}
              aiApiKey={apiKey}
              getAiHeaders={getAiHeaders}
              projectId={route.projectId}
              editorClipIndex={route.clipIndex}
              editorOpen={route.editor}
              versionId={route.versionId}
              onOpenProject={navigateToProject}
              onBackToProjects={() => navigateToTab("projects")}
              onOpenEditor={navigateToEditor}
              onCloseEditor={() => navigateToProject(route.projectId)}
              onVersionChange={(versionId) =>
                navigateToEditor(route.projectId, route.clipIndex, versionId)
              }
            />
          )}

          {/* View: Gallery */}
          {/* {activeTab === 'gallery' && (
            <Gallery />
          )} */}

          {/* View: Dashboard (Idle) */}
          {activeTab === "dashboard" && status === "idle" && (
            <div
              data-testid="dashboard-scroll-container"
              className="h-full overflow-y-auto custom-scrollbar p-6 animate-[fadeIn_0.3s_ease-out]"
            >
              <div className="min-h-full flex flex-col items-center justify-center">
                <div className="max-w-xl w-full text-center space-y-8 py-8">
                  <div className="space-y-4">
                    <h1 className="text-4xl md:text-5xl font-black bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
                      Create Viral Shorts
                    </h1>
                    <p className="text-zinc-400 text-lg">
                      Drop your long-form video below to instantly generate
                      viral clips with AI.
                    </p>
                  </div>

                  <MediaInput
                    onProcess={handleProcess}
                    isProcessing={status === "processing"}
                    targetClipCount={clipCount}
                    onTargetClipCountChange={setClipCount}
                  />

                  <div className="flex items-center justify-center gap-8 text-zinc-500 text-sm">
                    <span className="flex items-center gap-2">
                      <Youtube size={16} /> YouTube
                    </span>
                    <span className="flex items-center gap-2">
                      <Instagram size={16} /> Instagram
                    </span>
                    <span className="flex items-center gap-2">
                      <TikTokIcon size={16} /> TikTok
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* View: Processing / Results (Split View) */}
          {activeTab === "dashboard" &&
            (status === "processing" ||
              status === "clips-ready" ||
              status === "complete" ||
              status === "error") && (
              <div className="h-full flex flex-col md:flex-row animate-[fadeIn_0.3s_ease-out]">
                {/* Left Panel: Preview & Status */}
                <div
                  className={`${status === "complete" || status === "clips-ready" ? "w-full md:w-[30%] lg:w-[25%]" : "w-full md:w-[55%] lg:w-[60%]"} h-full flex flex-col border-r border-white/5 bg-black/20 p-6 overflow-y-auto custom-scrollbar transition-all duration-700 ease-in-out`}
                >
                  <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <Activity
                        className={`text-primary ${status === "processing" ? "animate-pulse" : ""}`}
                        size={20}
                      />
                      Live Analysis
                    </h2>
                    <span
                      className={`text-xs px-2 py-1 rounded-full border ${
                        status === "processing"
                          ? "bg-primary/10 border-primary/20 text-primary"
                          : status === "complete" || status === "clips-ready"
                            ? "bg-green-500/10 border-green-500/20 text-green-400"
                            : "bg-red-500/10 border-red-500/20 text-red-400"
                      }`}
                    >
                      {status.toUpperCase()}
                    </span>
                  </div>

                  {/* Video Preview */}
                  {processingMedia && (
                    <ProcessingAnimation
                      media={processingMedia}
                      isComplete={
                        status === "complete" || status === "clips-ready"
                      }
                      syncedTime={syncedTime}
                      isSyncedPlaying={isSyncedPlaying}
                      syncTrigger={syncTrigger}
                      aiProvider={aiProvider}
                      aiTextModel={aiTextModel}
                    />
                  )}

                  {/* Logs Terminal */}
                  <div
                    className={`bg-[#0c0c0e] rounded-xl border border-white/10 overflow-hidden flex flex-col transition-all duration-500 ${status === "complete" || status === "clips-ready" ? "h-32 min-h-0 opacity-50 hover:opacity-100" : "flex-1 min-h-[200px]"}`}
                  >
                    <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between bg-white/5 shrink-0">
                      <span className="text-xs font-mono text-zinc-400 flex items-center gap-2">
                        <Terminal size={12} /> System Logs
                      </span>
                      <button
                        onClick={() => setLogsVisible(!logsVisible)}
                        className="text-zinc-500 hover:text-white transition-colors"
                      >
                        {logsVisible ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronDown size={14} className="rotate-180" />
                        )}
                      </button>
                    </div>
                    {logsVisible && (
                      <div className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-1.5 custom-scrollbar text-zinc-400">
                        {logs.map((log, i) => (
                          <div
                            key={i}
                            className={`flex gap-2 ${log.toLowerCase().includes("error") ? "text-red-400" : "text-zinc-400"}`}
                          >
                            <span className="text-zinc-700 shrink-0">
                              {new Date().toLocaleTimeString()}
                            </span>
                            <span>{log}</span>
                          </div>
                        ))}
                        {status === "processing" && (
                          <div className="animate-pulse text-primary/70">_</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Panel: Results Grid */}
                <div
                  className={`${status === "complete" || status === "clips-ready" ? "w-full md:w-[70%] lg:w-[75%]" : "w-full md:w-[45%] lg:w-[40%]"} h-full flex flex-col bg-background p-6 transition-all duration-700 ease-in-out`}
                >
                  <h2 className="text-lg font-semibold mb-6 flex items-center gap-2 shrink-0">
                    <Sparkles className="text-yellow-400" size={20} />
                    Generated Shorts
                    {results?.clips?.length > 0 && (
                      <span className="text-xs bg-white/10 text-white px-2 py-0.5 rounded-full ml-auto">
                        {results.clips.length} Clips
                      </span>
                    )}
                    {results?.cost_analysis && (
                      <span
                        className="text-xs bg-green-500/10 border border-green-500/20 text-green-400 px-2 py-0.5 rounded-full ml-2"
                        title={`Input: ${results.cost_analysis.input_tokens} | Output: ${results.cost_analysis.output_tokens}`}
                      >
                        $
                        {Number.isFinite(results.cost_analysis.total_cost)
                          ? results.cost_analysis.total_cost.toFixed(5)
                          : "N/A"}
                      </span>
                    )}
                    {results?.clips?.length > 1 && status === "complete" && (
                      <button
                        onClick={() => setShowScheduleWeek(true)}
                        className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-500/20 to-indigo-500/20 hover:from-purple-500/30 hover:to-indigo-500/30 border border-purple-500/30 text-purple-300 hover:text-purple-200 rounded-full text-xs font-bold transition-all"
                      >
                        <Calendar size={14} />
                        Programar Semana
                      </button>
                    )}
                  </h2>

                  <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
                    {results && results.clips && results.clips.length > 0 ? (
                      <div
                        className={`grid gap-4 pb-10 ${status === "complete" || status === "clips-ready" ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1"}`}
                      >
                        {results.clips.map((clip, i) => (
                          <ResultCard
                            key={i}
                            clip={clip}
                            index={i}
                            jobId={jobId}
                            uploadPostKey={uploadPostKey}
                            uploadUserId={uploadUserId}
                            aiProvider={aiProvider}
                            aiApiKey={apiKey}
                            getAiHeaders={getAiHeaders}
                            elevenLabsKey={elevenLabsKey}
                            onPlay={(time) => handleClipPlay(time)}
                            onPause={handleClipPause}
                            onRenderClip={
                              status === "clips-ready"
                                ? handleRenderClip
                                : undefined
                            }
                            onSaveClipRange={
                              status === "clips-ready" || status === "complete"
                                ? handleSaveClipRange
                                : undefined
                            }
                            renderStatus={clip.render_status}
                            renderError={clip.render_error}
                            masterDuration={
                              results.source_duration_seconds ||
                              clip.master_duration ||
                              clip.source_duration_seconds
                            }
                          />
                        ))}
                      </div>
                    ) : status === "processing" ? (
                      <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-4 opacity-50">
                        <div className="w-12 h-12 rounded-full border-2 border-zinc-800 border-t-primary animate-spin" />
                        <p className="text-sm">Waiting for clips...</p>
                      </div>
                    ) : status === "error" ? (
                      <div className="h-full flex flex-col items-center justify-center text-red-400 space-y-2">
                        <p>Generation failed.</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
        </div>
      </main>

      {/* Missing API Key Modal */}
      {showKeyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowKeyModal(false)}
        >
          <div
            className="bg-[#18181b] border border-white/10 rounded-2xl p-6 max-w-md w-full mx-4 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-white">
              {!apiKey
                ? "Gemini API Key Required"
                : "Optional Publishing Setup"}
            </h2>
            <p className="text-sm text-zinc-400">
              OpenShorts needs a{" "}
              <strong className="text-zinc-200">Gemini</strong> API key for
              generation. <strong className="text-zinc-200">Upload-Post</strong>{" "}
              is optional and only used for social publishing.
            </p>

            {/* Gemini block */}
            <div
              className={`rounded-lg p-4 space-y-2 border ${!apiKey ? "bg-blue-500/5 border-blue-500/30" : "bg-white/5 border-white/10 opacity-70"}`}
            >
              <p className="text-xs font-semibold text-zinc-200 flex items-center gap-2">
                {apiKey ? (
                  <Check size={12} className="text-green-400" />
                ) : (
                  <AlertTriangle size={12} className="text-amber-400" />
                )}
                Gemini API Key{" "}
                {apiKey && <span className="text-green-400">— set</span>}
              </p>
              {!apiKey && (
                <>
                  <ol className="text-xs text-zinc-400 space-y-1 list-decimal list-inside">
                    <li>
                      Go to{" "}
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 underline"
                      >
                        aistudio.google.com/app/apikey
                      </a>
                    </li>
                    <li>Sign in with your Google account</li>
                    <li>Click "Create API Key"</li>
                    <li>Copy the key and paste it below</li>
                  </ol>
                  <input
                    type="text"
                    placeholder="Paste your Gemini API key here..."
                    className="w-full bg-black/50 border border-white/20 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target.value.trim()) {
                        setApiKey(e.target.value.trim());
                      }
                    }}
                  />
                </>
              )}
            </div>

            {/* Upload-Post block */}
            <div
              className={`rounded-lg p-4 space-y-2 border ${!uploadPostKey ? "bg-violet-500/5 border-violet-500/30" : "bg-white/5 border-white/10 opacity-70"}`}
            >
              <p className="text-xs font-semibold text-zinc-200 flex items-center gap-2">
                {uploadPostKey ? (
                  <Check size={12} className="text-green-400" />
                ) : (
                  <AlertTriangle size={12} className="text-amber-400" />
                )}
                Upload-Post API Key{" "}
                {uploadPostKey && <span className="text-green-400">— set</span>}
              </p>
              {!uploadPostKey && (
                <>
                  <p className="text-xs text-zinc-400">
                    Optional. Add this only if you want to publish your clips to
                    TikTok, Instagram Reels, and YouTube Shorts. Free tier
                    available, no credit card needed.
                  </p>
                  <ol className="text-xs text-zinc-400 space-y-1 list-decimal list-inside">
                    <li>
                      Register at{" "}
                      <a
                        href="https://app.upload-post.com/login"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-violet-400 underline"
                      >
                        app.upload-post.com
                      </a>
                    </li>
                    <li>Connect your TikTok, Instagram, or YouTube accounts</li>
                    <li>
                      Go to{" "}
                      <a
                        href="https://app.upload-post.com/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-violet-400 underline"
                      >
                        API Keys
                      </a>{" "}
                      and generate one
                    </li>
                    <li>Paste it below</li>
                  </ol>
                  <input
                    type="text"
                    placeholder="Paste your Upload-Post API key here..."
                    className="w-full bg-black/50 border border-white/20 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target.value.trim()) {
                        setUploadPostKey(e.target.value.trim());
                      }
                    }}
                  />
                </>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowKeyModal(false)}
                className="flex-1 text-sm text-zinc-400 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowKeyModal(false);
                  navigateToTab("settings");
                }}
                className="flex-1 text-sm text-white py-2 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors font-medium"
              >
                Open Settings
              </button>
            </div>
          </div>
        </div>
      )}

      <ScheduleWeekModal
        isOpen={showScheduleWeek}
        onClose={() => setShowScheduleWeek(false)}
        clips={results?.clips || []}
        jobId={jobId}
        uploadPostKey={uploadPostKey}
        uploadUserId={uploadUserId}
      />
    </div>
  );
}

export default App;
