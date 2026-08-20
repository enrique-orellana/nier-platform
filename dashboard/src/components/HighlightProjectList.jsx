import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Clock3,
  Download,
  FileText,
  Play,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import MinioObjectPicker from "./MinioObjectPicker";
import { getApiUrl } from "../config";

const DEFAULT_MINUTES = 12;
const DEFAULT_IDEAL_MINUTES = 20;

const isActive = (status) => status === "queued" || status === "processing";

export default function HighlightProjectList({ getAiHeaders, aiProvider }) {
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState("");
  const [minMinutes, setMinMinutes] = useState(DEFAULT_MINUTES);
  const [idealMinutes, setIdealMinutes] = useState(DEFAULT_IDEAL_MINUTES);
  const [acknowledged, setAcknowledged] = useState(false);
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadProjects = useCallback(async () => {
    try {
      const response = await fetch(getApiUrl("/api/highlights/projects"));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(payload.detail || "Could not load highlight projects.");
      const nextProjects = payload.projects || [];
      setProjects(nextProjects);
      setSelectedProject((current) => current || nextProjects[0] || null);
    } catch (loadError) {
      setError(loadError.message || "Could not load highlight projects.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (
      !selectedProject?.id ||
      !isActive(selectedProject.job?.status || selectedProject.status)
    )
      return undefined;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(
          getApiUrl(`/api/highlights/projects/${selectedProject.id}`),
        );
        const payload = await response.json().catch(() => ({}));
        if (response.ok) {
          setSelectedProject(payload);
          setProjects((current) =>
            current.map((project) =>
              project.id === payload.id ? payload : project,
            ),
          );
        }
      } catch {
        // The next poll retries without interrupting the running job.
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [
    selectedProject?.id,
    selectedProject?.job?.status,
    selectedProject?.status,
  ]);

  const durationHint = useMemo(
    () =>
      idealMinutes === minMinutes
        ? `At least ${minMinutes} minutes`
        : `At least ${minMinutes}, targeting about ${idealMinutes} minutes`,
    [idealMinutes, minMinutes],
  );

  const createProject = async () => {
    if (!selected || !acknowledged || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(getApiUrl("/api/highlights/projects"), {
        method: "POST",
        headers: getAiHeaders("json", { requiresRemoteTranscription: true }),
        body: JSON.stringify({
          name: name.trim(),
          source_object: { bucket: selected.bucket, key: selected.key },
          min_minutes: Number(minMinutes),
          ideal_minutes: Number(idealMinutes),
          acknowledged,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          payload.detail || "Could not create highlight project.",
        );
      setSelectedProject(payload);
      await loadProjects();
    } catch (createError) {
      setError(createError.message || "Could not create highlight project.");
    } finally {
      setSaving(false);
    }
  };

  const openProject = async (project) => {
    setError("");
    try {
      const response = await fetch(
        getApiUrl(`/api/highlights/projects/${project.id}`),
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(payload.detail || "Could not open highlight project.");
      setSelectedProject(payload);
    } catch (openError) {
      setError(openError.message || "Could not open highlight project.");
    }
  };

  const projectAction = async (project, action) => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        getApiUrl(`/api/highlights/projects/${project.id}/${action}`),
        {
          method: "POST",
          headers: getAiHeaders("json", {
            requiresRemoteTranscription: action === "retry",
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          payload.detail || `Could not ${action} highlight project.`,
        );
      setSelectedProject(payload);
      await loadProjects();
    } catch (actionError) {
      setError(actionError.message || `Could not ${action} highlight project.`);
    } finally {
      setSaving(false);
    }
  };

  const deleteProject = async (project) => {
    if (!window.confirm(`Delete highlight project “${project.name}”?`)) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        getApiUrl(`/api/highlights/projects/${project.id}`),
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          payload.detail || "Could not delete highlight project.",
        );
      setSelectedProject(null);
      await loadProjects();
    } catch (deleteError) {
      setError(deleteError.message || "Could not delete highlight project.");
    } finally {
      setSaving(false);
    }
  };

  const activeProject = selectedProject;
  const activeJob = activeProject?.job;
  const result = activeJob?.result;

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-6 md:p-10 animate-[fadeIn_0.3s_ease-out]">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[11px] uppercase tracking-wider text-primary font-semibold">
              <Sparkles size={12} /> AI Highlights
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-white mt-3">
              Highlights projects
            </h1>
            <p className="text-zinc-400 mt-2 max-w-2xl">
              Persist one downloaded MinIO video per project, find its strongest
              sections with your configured AI, and render one coherent
              long-form highlight.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
            Provider:{" "}
            <span className="text-white font-medium">
              {aiProvider || "configured provider"}
            </span>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-6">
          <section className="glass-panel p-6 space-y-5">
            <div className="flex items-center gap-3">
              <FileText size={20} className="text-primary" />
              <h2 className="text-lg font-semibold">New Highlights project</h2>
            </div>
            <label className="block text-sm text-zinc-300">
              Project name
              <input
                aria-label="Project name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Optional project name"
                className="input-field mt-2"
              />
            </label>
            <MinioObjectPicker selected={selected} onSelect={setSelected} />
            <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-1 accent-primary"
              />
              <span>
                I confirm I own this video or have permission to process it.
              </span>
            </label>
          </section>

          <section className="glass-panel p-6 space-y-5">
            <div className="flex items-center gap-3">
              <Clock3 size={20} className="text-primary" />
              <h2 className="text-lg font-semibold">Output target</h2>
            </div>
            <p className="text-sm text-zinc-400">
              {durationHint}. If there is not enough strong material, the result
              stays shorter instead of adding filler.
            </p>
            <label className="block text-sm text-zinc-300">
              Minimum minutes
              <input
                type="number"
                min="1"
                max="180"
                value={minMinutes}
                onChange={(event) => setMinMinutes(event.target.value)}
                className="input-field mt-2"
              />
            </label>
            <label className="block text-sm text-zinc-300">
              Ideal minutes
              <input
                type="number"
                min="1"
                max="180"
                value={idealMinutes}
                onChange={(event) => setIdealMinutes(event.target.value)}
                className="input-field mt-2"
              />
            </label>
            <button
              type="button"
              onClick={createProject}
              disabled={!selected || !acknowledged || saving}
              className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play size={16} /> {saving ? "Saving…" : "Create project"}
            </button>
          </section>
        </div>

        <section className="glass-panel p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Saved projects</h2>
            <span className="text-xs uppercase tracking-wider text-zinc-500">
              {loading
                ? "loading"
                : `${projects.length} project${projects.length === 1 ? "" : "s"}`}
            </span>
          </div>
          {loading ? (
            <p className="text-sm text-zinc-500">Loading projects…</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-zinc-500">No Highlights projects yet.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className={`rounded-xl border p-4 space-y-3 ${activeProject?.id === project.id ? "border-primary/50 bg-primary/5" : "border-white/10 bg-white/[0.02]"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-white">
                        {project.name}
                      </h3>
                      <p className="text-xs text-zinc-500 break-all mt-1">
                        {project.source_object?.key || "Source unavailable"}
                      </p>
                    </div>
                    <span className="text-xs uppercase tracking-wider text-zinc-500">
                      {project.job?.status || project.status}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    At least {project.min_minutes} min · targeting{" "}
                    {project.ideal_minutes} min
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openProject(project)}
                      className="px-3 py-2 rounded-lg border border-white/10 text-xs text-zinc-300 hover:bg-white/5"
                    >
                      Open
                    </button>
                    {!isActive(project.job?.status || project.status) && (
                      <button
                        type="button"
                        onClick={() => projectAction(project, "retry")}
                        disabled={saving}
                        className="px-3 py-2 rounded-lg border border-primary/30 text-xs text-primary hover:bg-primary/10"
                      >
                        Retry
                      </button>
                    )}
                    {isActive(project.job?.status || project.status) && (
                      <button
                        type="button"
                        onClick={() => projectAction(project, "cancel")}
                        disabled={saving}
                        className="px-3 py-2 rounded-lg border border-red-500/30 text-xs text-red-300 hover:bg-red-500/10"
                      >
                        <Square size={12} className="inline mr-1" />
                        Stop
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteProject(project)}
                      disabled={saving}
                      className="px-3 py-2 rounded-lg border border-white/10 text-xs text-zinc-400 hover:text-red-300"
                    >
                      <Trash2 size={12} className="inline mr-1" />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {activeProject && (
          <section className="glass-panel p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Activity
                  size={20}
                  className={
                    isActive(activeJob?.status || activeProject.status)
                      ? "text-primary animate-pulse"
                      : "text-zinc-400"
                  }
                />
                <h2 className="text-lg font-semibold">{activeProject.name}</h2>
                <span className="text-xs uppercase tracking-wider text-zinc-500">
                  {activeJob?.status || activeProject.status}
                </span>
              </div>
            </div>
            <div className="bg-[#0c0c0e] rounded-xl border border-white/10 overflow-hidden">
              <div className="px-4 py-2 border-b border-white/5 text-xs font-mono text-zinc-400">
                Live worker logs
              </div>
              <div className="p-4 min-h-28 max-h-64 overflow-y-auto font-mono text-xs space-y-2 text-zinc-400">
                {activeJob?.logs?.length ? (
                  activeJob.logs.map((log, index) => (
                    <div key={`${index}-${log}`}>{log}</div>
                  ))
                ) : (
                  <span className="text-zinc-600">Waiting for the worker…</span>
                )}
              </div>
            </div>
            {activeJob?.error && (
              <p className="text-sm text-red-300">{activeJob.error}</p>
            )}
            {result && activeJob.status === "completed" && (
              <div className="space-y-4">
                <video
                  controls
                  className="w-full max-h-[32rem] rounded-xl bg-black"
                  src={getApiUrl(result.video_url)}
                />
                <div className="flex flex-wrap gap-3">
                  <a
                    href={getApiUrl(result.video_url)}
                    download
                    className="btn-primary px-4 py-2 flex items-center gap-2"
                  >
                    <Download size={15} /> Download highlights
                  </a>
                  <a
                    href={getApiUrl(result.manifest_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 rounded-lg border border-white/10 text-zinc-300 hover:bg-white/5 flex items-center gap-2"
                  >
                    <FileText size={15} /> View manifest
                  </a>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
