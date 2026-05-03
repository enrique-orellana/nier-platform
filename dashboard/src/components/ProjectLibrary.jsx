import { ChevronLeft, FolderOpen, Image as ImageIcon, Loader2, Play, RefreshCw, Search } from 'lucide-react';
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
  const [activeClipIndex, setActiveClipIndex] = useState(0);

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

  useEffect(() => {
    setActiveClipIndex(0);
  }, [selectedProject]);

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

  const activeClip = projectClips[activeClipIndex] || projectClips[0] || null;
  const normalizedProjectClips = projectClips.map((clip, index) =>
    normalizeClipForResultCard(clip, index, selectedProject?.job_id || selectedProject?.session_id || selectedProject?.id)
  );
  const activeClipImage = selectedProject?.preview_image_url
    || selectedProject?.selected_thumbnail
    || activeClip?.preview_image_url
    || activeClip?.thumbnail_url
    || activeClip?.poster_url
    || activeClip?.image_url
    || activeClip?.actor_url
    || '';

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
        <div className="max-w-7xl mx-auto p-6 pb-10 space-y-6">
          <button
            onClick={() => setSelectedProject(null)}
            className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors group"
          >
            <ChevronLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
            Back to Projects
          </button>

          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                  <ImageIcon size={20} className="text-cyan-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-white tracking-tight">
                    {selectedProject.title || 'Untitled Project'}
                  </h1>
                  <p className="text-sm text-zinc-500 break-all">{selectedProject.job_id}</p>
                </div>
              </div>
              <p className="text-sm text-zinc-400">
                Historical clip generation results rendered the same way as the live generator.
              </p>
            </div>

            <button
              onClick={loadProjects}
              className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm text-zinc-300 flex items-center gap-2 transition-colors"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          <div className="grid lg:grid-cols-3 gap-6 min-h-0">
            <div className="lg:col-span-1 space-y-6">
              <div className="glass-panel p-5 space-y-4">
                <div className="aspect-[9/16] rounded-xl overflow-hidden border border-white/10 bg-black">
                  {activeClipImage ? (
                    <video
                      key={activeClip.video_url || activeClip.url}
                      src={activeClip.video_url || activeClip.url}
                      poster={activeClipImage}
                      controls
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-600">
                      <FolderOpen size={32} />
                    </div>
                  )}
                </div>

                <div>
                  <h2 className="text-xl font-bold text-white mb-1">
                    {selectedProject.title || 'Untitled Project'}
                  </h2>
                  <p className="text-[11px] text-zinc-500 break-all">{selectedProject.job_id}</p>
                </div>

                <div className="pt-4 border-t border-white/5 grid grid-cols-2 gap-3 text-center">
                  <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Clips</p>
                    <p className="text-sm font-bold text-white">{projectClips.length}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Created</p>
                    <p className="text-sm font-bold text-white">{formatDate(selectedProject.created_at)}</p>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/5 grid grid-cols-2 gap-3 text-center">
                  <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Duration</p>
                    <p className="text-sm font-bold text-white">
                      {formatDuration(selectedProject.total_duration)}
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Source</p>
                    <p className="text-sm font-bold text-white">S3 History</p>
                  </div>
                </div>

                {selectedProject.description && (
                  <div className="p-3 rounded-xl bg-black/20 border border-white/5 text-xs text-zinc-400 leading-relaxed italic">
                    "{selectedProject.description}"
                  </div>
                )}
              </div>

            </div>

            <div className="lg:col-span-2 space-y-6 min-h-0">
              <div className="glass-panel p-5">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Play size={18} className="text-cyan-400" /> Generated Clips
                  </h3>
                  <span className="text-xs text-zinc-500 bg-white/5 px-2 py-1 rounded-full">
                    {projectClips.length} results
                  </span>
                </div>

                {isLoadingClips ? (
                  <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
                    <Loader2 size={32} className="animate-spin text-cyan-500 mb-4" />
                    <p className="text-sm">Loading project clips...</p>
                  </div>
                ) : projectClips.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-white/5 rounded-2xl text-zinc-600">
                    <Play size={40} className="mb-4 opacity-20" />
                    <p className="text-sm">No clips found for this project</p>
                  </div>
                ) : (
                  <div className={`grid gap-4 pb-10 ${projectClips.length > 1 ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
                    {normalizedProjectClips.map((clip, index) => (
                      <ResultCard
                        key={clip.video_id || `${clip.job_id || 'clip'}-${clip.index ?? index}`}
                        clip={clip}
                        index={clip.index ?? index}
                        jobId={clip.job_id}
                        aiProvider={aiProvider}
                        aiApiKey={aiApiKey}
                        getAiHeaders={getAiHeaders}
                        onPlay={() => setActiveClipIndex(index)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
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
