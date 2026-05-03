import { ChevronLeft, FolderOpen, Loader2, Play, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { getApiUrl } from '../config';
import ResultCard from './ResultCard';

function formatDate(value) {
  if (!value) return 'Unknown';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return '';
  const rounded = Math.round(total);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes}m ${remainder.toString().padStart(2, '0')}s`;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeClipForResultCard(clip, index, fallbackJobId) {
  const videoUrl = clip.video_url || clip.url || '';
  const title = clip.video_title_for_youtube_short || clip.title || `Clip ${index + 1}`;
  const descriptionTiktok = clip.video_description_for_tiktok || clip.tiktok_desc || clip.description || '';
  const descriptionInstagram = clip.video_description_for_instagram || clip.insta_desc || clip.description || descriptionTiktok;
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
    video_title_for_youtube_short: title,
    video_description_for_tiktok: descriptionTiktok,
    video_description_for_instagram: descriptionInstagram,
    title,
    start,
    end,
    job_id: clip.job_id || fallbackJobId || 'project',
    index: Number.isInteger(clip.index) ? clip.index : index,
  };
}

export default function ProjectLibrary({ aiProvider = 'gemini', aiApiKey, getAiHeaders }) {
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectClips, setProjectClips] = useState([]);
  const [isLoadingClips, setIsLoadingClips] = useState(false);

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(getApiUrl('/api/projects/history?limit=48&refresh=true'));
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (e) {
      setProjects([]);
      setError(e.message || 'Failed to load projects');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects().catch(() => {});
  }, [loadProjects]);



  const loadProjectClips = useCallback(async (project) => {
    const jobId = project?.job_id || project?.session_id || project?.id;
    if (!jobId) {
      setProjectClips([]);
      return;
    }

    setIsLoadingClips(true);
    try {
      const res = await fetch(getApiUrl(`/api/projects/clips/${encodeURIComponent(jobId)}?refresh=true`));
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      setProjectClips(Array.isArray(data.clips) ? data.clips : []);
    } catch (e) {
      console.error('Error loading project clips:', e);
      setProjectClips([]);
    } finally {
      setIsLoadingClips(false);
    }
  }, []);

  const handleViewProject = (project) => {
    setSelectedProject(project);
    setProjectClips(Array.isArray(project?.clips) ? project.clips : []);
    if (!project?.clips?.length) {
      loadProjectClips(project);
    }
  };

  const handleDeleteProject = async (e, project) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete project "${project.title || project.job_id}"?`)) {
      return;
    }

    try {
      const res = await fetch(getApiUrl(`/api/projects/${encodeURIComponent(project.job_id)}`), {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      setProjects((prev) => prev.filter((p) => p.job_id !== project.job_id));
      if (selectedProject?.job_id === project.job_id) {
        setSelectedProject(null);
      }
    } catch (err) {
      console.error('Delete error:', err);
      alert('Failed to delete project: ' + err.message);
    }
  };

  const normalizedProjectClips = projectClips.map((clip, index) =>
    normalizeClipForResultCard(clip, index, selectedProject?.job_id || selectedProject?.session_id || selectedProject?.id)
  );

  const filteredProjects = projects.filter((project) => {
    const haystack = [
      project.job_id,
      project.title,
      project.description,
      project.created_at,
      String(project.clip_count || ''),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  if (selectedProject) {
    return (
      <div className="h-full min-h-0 overflow-y-auto custom-scrollbar">
        <div className="max-w-7xl mx-auto p-6 pb-10 space-y-8">
          {/* Header Navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSelectedProject(null)}
              className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors group"
            >
              <ChevronLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
              Back to Projects
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={loadProjects}
                className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm text-zinc-300 flex items-center gap-2 transition-colors"
              >
                <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
              <button
                onClick={(e) => handleDeleteProject(e, selectedProject)}
                className="px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/5 hover:bg-red-500/20 text-sm text-red-400 flex items-center gap-2 transition-colors"
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </div>

          {/* Project Header Card */}
          <div className="glass-panel p-8 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0 shadow-lg shadow-cyan-500/5">
                  <FolderOpen size={28} className="text-cyan-400" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-white tracking-tight mb-1">
                    {selectedProject.title || 'Untitled Project'}
                  </h1>
                  <p className="text-sm text-zinc-500 font-mono">{selectedProject.job_id}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/5">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-0.5">Clips</p>
                  <p className="text-lg font-bold text-white leading-none">{projectClips.length}</p>
                </div>
                <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/5">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-0.5">Created</p>
                  <p className="text-sm font-bold text-white leading-none">{formatDate(selectedProject.created_at).split(',')[0]}</p>
                </div>
                <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/5">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-0.5">Duration</p>
                  <p className="text-sm font-bold text-white leading-none">
                    {formatDuration(selectedProject.total_duration) || 'N/A'}
                  </p>
                </div>
                <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/5">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-0.5">Source</p>
                  <p className="text-sm font-bold text-white leading-none">S3 History</p>
                </div>
              </div>
            </div>

            {selectedProject.description && (
              <div className="p-4 rounded-xl bg-black/20 border border-white/5 text-sm text-zinc-400 leading-relaxed italic max-w-3xl">
                "{selectedProject.description}"
              </div>
            )}
            
            <p className="text-sm text-zinc-500">
              Historical clip generation results rendered the same way as the live generator.
            </p>
          </div>

          {/* Clips Gallery */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-white flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-cyan-400/10 flex items-center justify-center">
                  <Play size={16} className="text-cyan-400" />
                </div>
                Generated Clips
              </h3>
              <span className="text-sm text-zinc-500 font-medium px-3 py-1 rounded-full bg-white/5 border border-white/5">
                {projectClips.length} results
              </span>
            </div>

            {isLoadingClips ? (
              <div className="glass-panel py-24 flex flex-col items-center justify-center text-zinc-500">
                <Loader2 size={40} className="animate-spin text-cyan-500 mb-4" />
                <p className="text-lg font-medium">Loading project clips...</p>
              </div>
            ) : projectClips.length === 0 ? (
              <div className="glass-panel py-24 flex flex-col items-center justify-center border-2 border-dashed border-white/5 text-zinc-600">
                <Play size={48} className="mb-4 opacity-20" />
                <p className="text-lg font-medium">No clips found for this project</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {normalizedProjectClips.map((clip, index) => (
                  <ResultCard
                    key={clip.video_id || `${clip.job_id || 'clip'}-${clip.index ?? index}`}
                    clip={clip}
                    index={clip.index ?? index}
                    jobId={clip.job_id}
                    aiProvider={aiProvider}
                    aiApiKey={aiApiKey}
                    getAiHeaders={getAiHeaders}
                    onPlay={() => {}}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
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
                <h1 className="text-2xl font-bold text-white tracking-tight">Projects</h1>
                <p className="text-sm text-zinc-500">
                  Historical clip-generation jobs rendered the same way as the clip generator.
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={loadProjects}
            className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm text-zinc-300 flex items-center gap-2 transition-colors"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
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
              const previewVideoUrl = project.clips?.[0]?.url || project.clips?.[0]?.video_url || '';

              return (
                <button
                  key={project.job_id}
                  onClick={() => handleViewProject(project)}
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
                      {project.title || 'Untitled Project'}
                    </h3>
                    <div className="flex items-center justify-between mt-1 gap-2">
                      <span className="text-[10px] text-zinc-500 truncate">{formatDate(project.created_at)}</span>
                      <span className="text-[10px] text-zinc-400 font-medium px-2 py-0.5 rounded bg-white/5 border border-white/5 whitespace-nowrap">
                        {project.clip_count || 0} CLIPS
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-2 truncate">{project.job_id}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
