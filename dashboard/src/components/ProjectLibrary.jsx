import { ChevronLeft, Download, ExternalLink, FileText, FolderOpen, Image, Loader2, Play, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiUrl } from '../config';

function formatDate(value) {
  if (!value) return 'Unknown';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function ProjectLibrary() {
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
      const res = await fetch(getApiUrl('/api/thumbnail/projects?limit=48'));
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (e) {
      setError(e.message || 'Failed to load projects');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects().catch(() => {});
  }, [loadProjects]);
  
  const loadProjectClips = useCallback(async (project) => {
    setIsLoadingClips(true);
    try {
      // session_id is used as the job_id for linking clips to projects
      const session_id = project.session_id || project.id;
      if (!session_id) {
        setProjectClips([]);
        return;
      }

      // Fetch clips specifically for this project session
      const res = await fetch(getApiUrl(`/api/projects/clips/${encodeURIComponent(session_id)}`));
      if (!res.ok) throw new Error('Failed to load project clips');
      const data = await res.json();
      
      // If no project clips found, try the general SaaS Shorts gallery as fallback
      // (in case it was a SaaS generation that isn't indexed by job_id prefix)
      if (!data.clips || data.clips.length === 0) {
        const saasRes = await fetch(getApiUrl(`/api/saasshorts/gallery?session_id=${encodeURIComponent(session_id)}`));
        if (saasRes.ok) {
          const saasData = await saasRes.json();
          setProjectClips(saasData.videos || []);
        } else {
          setProjectClips([]);
        }
      } else {
        setProjectClips(data.clips);
      }
    } catch (e) {
      console.error('Error loading project clips:', e);
      setProjectClips([]);
    } finally {
      setIsLoadingClips(false);
    }
  }, []);

  const handleViewProject = (project) => {
    setSelectedProject(project);
    loadProjectClips(project);
  };

  const projectApiBase = useCallback((project) => {
    return getApiUrl(`/api/thumbnail/projects/${encodeURIComponent(project.session_id)}/${encodeURIComponent(project.project_slug)}`);
  }, []);

  const handleUpdateProject = async (project, patch) => {
    try {
      const res = await fetch(projectApiBase(project), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      await loadProjects();
    } catch (e) {
      setError(e.message || 'Failed to update project');
    }
  };

  const handleRenameProject = async (project) => {
    const nextTitle = window.prompt('Rename project', project.title || '');
    if (nextTitle === null) return;
    await handleUpdateProject(project, { title: nextTitle.trim() });
  };

  const handleEditProjectDescription = async (project) => {
    const nextDescription = window.prompt('Edit project description', project.description || '');
    if (nextDescription === null) return;
    await handleUpdateProject(project, { description: nextDescription });
  };

  const handleDeleteProject = async (project) => {
    try {
      if (!window.confirm(`Delete project "${project.title || project.project_slug}"? This removes every file in the folder.`)) {
        return;
      }
      const res = await fetch(projectApiBase(project), {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      await loadProjects();
    } catch (e) {
      setError(e.message || 'Failed to delete project');
    }
  };

  const handleEditProjectFile = async (project, file) => {
    try {
      if (!file.editable) return;
      if (!file.url) throw new Error(`Missing download URL for ${file.name}`);
      const currentText = await fetch(file.url).then((res) => {
        if (!res.ok) throw new Error(`Failed to load ${file.name}`);
        return res.text();
      });
      const nextContent = window.prompt(`Edit ${file.name}`, currentText);
      if (nextContent === null) return;
      const res = await fetch(`${projectApiBase(project)}/files/${encodeURI(file.name)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: nextContent }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      await loadProjects();
    } catch (e) {
      setError(e.message || 'Failed to update file');
    }
  };

  const handleDeleteProjectFile = async (project, file) => {
    try {
      if (!window.confirm(`Delete file "${file.name}" from this project?`)) return;
      const res = await fetch(`${projectApiBase(project)}/files/${encodeURI(file.name)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      await loadProjects();
    } catch (e) {
      setError(e.message || 'Failed to delete file');
    }
  };

  const filteredProjects = projects.filter((project) => {
    const haystack = [
      project.title,
      project.project_slug,
      project.session_id,
      project.description,
      project.context,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  if (selectedProject) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <button
          onClick={() => setSelectedProject(null)}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-6 group"
        >
          <ChevronLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          Back to Library
        </button>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left Column: Metadata & Files */}
          <div className="lg:col-span-1 space-y-6">
            <div className="glass-panel p-5 space-y-4">
              <div className="aspect-video rounded-xl overflow-hidden border border-white/10 bg-white/5">
                {(selectedProject.files || []).find(f => f.kind === 'image') ? (
                  <img 
                    src={(selectedProject.files || []).find(f => f.kind === 'image').url} 
                    alt="Preview" 
                    className="w-full h-full object-cover" 
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-600">
                    <Image size={32} />
                  </div>
                )}
              </div>
              <div>
                <h2 className="text-xl font-bold text-white mb-1">{selectedProject.title || 'Untitled Project'}</h2>
                <p className="text-[11px] text-zinc-500 break-all">{selectedProject.project_slug}</p>
              </div>

              <div className="pt-4 border-t border-white/5 grid grid-cols-2 gap-3 text-center">
                <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Clips</p>
                  <p className="text-sm font-bold text-white">{projectClips.length}</p>
                </div>
                <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Files</p>
                  <p className="text-sm font-bold text-white">{selectedProject.files?.length || 0}</p>
                </div>
              </div>

              {selectedProject.description && (
                <div className="p-3 rounded-xl bg-black/20 border border-white/5 text-xs text-zinc-400 leading-relaxed italic">
                  "{selectedProject.description}"
                </div>
              )}
            </div>

            <div className="glass-panel p-5">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                <FileText size={12} /> Project Files
              </h3>
              <div className="space-y-2">
                {(selectedProject.files || []).map((file) => (
                  <div key={file.key} className="p-2 rounded-lg bg-white/5 border border-white/5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] text-zinc-300 truncate">{file.name}</p>
                      <p className="text-[9px] text-zinc-600">{file.kind || 'file'}</p>
                    </div>
                    {file.url && (
                      <a href={file.url} target="_blank" rel="noreferrer" className="p-1.5 rounded-md bg-white/5 hover:bg-white/10 text-zinc-400 transition-colors">
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Clips Gallery */}
          <div className="lg:col-span-2 space-y-6">
            <div className="glass-panel p-5">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Play size={18} className="text-cyan-400" /> Generated Clips
                </h3>
                <span className="text-xs text-zinc-500 bg-white/5 px-2 py-1 rounded-full">{projectClips.length} results</span>
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
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {projectClips.map((video) => (
                    <ProjectVideoCard key={video.video_id} video={video} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <FolderOpen size={20} className="text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Project Library</h1>
              <p className="text-sm text-zinc-500">Browse saved projects and view their generated video clips.</p>
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

      <div className="glass-panel p-4 mb-6 flex flex-col md:flex-row md:items-center gap-3">
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
            const previewFile = project.selected_thumbnail
              ? { url: project.selected_thumbnail }
              : (project.files || []).find((file) => file.kind === 'image' && file.url);

            return (
              <div 
                key={`${project.session_id}/${project.project_slug}`}
                onClick={() => handleViewProject(project)}
                className="group glass-panel p-3 cursor-pointer hover:border-cyan-500/30 transition-all active:scale-[0.98]"
              >
                <div className="aspect-video rounded-lg overflow-hidden bg-white/5 mb-3 border border-white/5 relative">
                  {previewFile ? (
                    <img src={previewFile.url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-700">
                      <FolderOpen size={32} />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-xs font-bold text-white bg-cyan-500 px-3 py-1.5 rounded-full shadow-xl">VIEW CLIPS</span>
                  </div>
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white truncate group-hover:text-cyan-400 transition-colors">{project.title || 'Untitled Project'}</h3>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-zinc-500">{formatDate(project.created_at)}</span>
                    <span className="text-[10px] text-zinc-400 font-medium px-2 py-0.5 rounded bg-white/5 border border-white/5">
                      {project.file_count || project.files?.length || 0} FILES
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProjectVideoCard({ video }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  const handleMouseEnter = () => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
      setPlaying(true);
    }
  };

  const handleMouseLeave = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      setPlaying(false);
    }
  };

  return (
    <div className="group rounded-xl overflow-hidden border border-white/10 bg-white/5 hover:border-cyan-500/30 transition-all">
      <div
        className="relative aspect-[9/16] bg-black cursor-pointer"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <video
          ref={videoRef}
          src={video.video_url || video.url}
          poster={video.actor_url || video.thumbnail_url}
          muted
          playsInline
          preload="metadata"
          className="w-full h-full object-cover"
        />
        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-black/20 transition-colors">
            <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center">
              <Play size={24} className="text-white fill-white ml-1" />
            </div>
          </div>
        )}
      </div>

      <div className="p-3 space-y-2">
        <h3 className="text-xs font-bold text-zinc-200 truncate">{video.title || 'Untitled Clip'}</h3>
        <div className="flex gap-1">
          <a
            href={video.video_url || video.url}
            download
            className="flex-1 flex items-center justify-center gap-1 text-[10px] bg-white/5 hover:bg-white/10 text-zinc-400 py-1.5 rounded-lg transition-colors border border-white/5"
          >
            <Download size={10} /> Save
          </a>
          <a
            href={video.video_url || video.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1 text-[10px] bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 py-1.5 rounded-lg transition-colors border border-cyan-500/20"
          >
            <ExternalLink size={10} /> Link
          </a>
        </div>
      </div>
    </div>
  );
}
