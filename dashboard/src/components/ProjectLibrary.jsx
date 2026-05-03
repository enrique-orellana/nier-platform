import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, FileText, FolderOpen, Image, Loader2, Pencil, RefreshCw, Trash2, Search } from 'lucide-react';
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
              <p className="text-sm text-zinc-500">Browse saved thumbnail projects in MinIO or S3, edit text files, and delete folders when they are no longer needed.</p>
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
          placeholder="Search by title, slug, session id, or description"
          className="input-field flex-1 text-sm"
        />
        <div className="text-xs text-zinc-500 md:text-right md:min-w-[120px]">
          {filteredProjects.length} / {projects.length} projects
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-300">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="glass-panel p-8 flex items-center gap-3 text-zinc-400">
          <Loader2 size={18} className="animate-spin text-cyan-400" />
          Loading saved projects...
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="glass-panel p-8 text-zinc-500">
          No saved projects found yet.
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredProjects.map((project) => {
            const previewFile = project.selected_thumbnail
              ? { url: project.selected_thumbnail, name: 'Selected thumbnail' }
              : (project.files || []).find((file) => file.kind === 'image' && file.url);
            const fileCount = project.file_count ?? (project.files?.length ?? 0);

            return (
              <div key={`${project.session_id}/${project.project_slug}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
                <div className="flex flex-col xl:flex-row gap-4">
                  <div className="w-full xl:w-60 shrink-0">
                    {previewFile ? (
                      <img
                        src={previewFile.url}
                        alt={project.title || 'Project preview'}
                        className="w-full aspect-video rounded-xl object-cover border border-white/10"
                      />
                    ) : (
                      <div className="w-full aspect-video rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-600">
                        <Image size={28} />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-4">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-lg font-semibold text-white truncate">{project.title || 'Untitled Project'}</h2>
                        <p className="text-xs text-zinc-500 break-all mt-1">{project.project_slug}</p>
                        <p className="text-[11px] text-zinc-600 break-all mt-1">Session: {project.session_id}</p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleRenameProject(project)}
                          className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-zinc-300 flex items-center gap-2 transition-colors"
                        >
                          <Pencil size={12} />
                          Rename
                        </button>
                        <button
                          onClick={() => handleEditProjectDescription(project)}
                          className="px-3 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-xs text-cyan-300 flex items-center gap-2 transition-colors"
                        >
                          <FileText size={12} />
                          Description
                        </button>
                        {project.url && (
                          <a
                            href={project.url}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-zinc-300 flex items-center gap-2 transition-colors"
                          >
                            <ExternalLink size={12} />
                            Manifest
                          </a>
                        )}
                        <button
                          onClick={() => handleDeleteProject(project)}
                          className="px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-xs text-red-300 flex items-center gap-2 transition-colors"
                        >
                          <Trash2 size={12} />
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-4 gap-3 text-xs">
                      <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
                        <div className="text-zinc-500 uppercase tracking-wider text-[10px]">Files</div>
                        <div className="text-zinc-200 mt-1 font-medium">{fileCount}</div>
                      </div>
                      <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
                        <div className="text-zinc-500 uppercase tracking-wider text-[10px]">Thumbnail Count</div>
                        <div className="text-zinc-200 mt-1 font-medium">{project.thumbnail_count ?? 0}</div>
                      </div>
                      <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
                        <div className="text-zinc-500 uppercase tracking-wider text-[10px]">Created</div>
                        <div className="text-zinc-200 mt-1 font-medium">{formatDate(project.created_at)}</div>
                      </div>
                      <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
                        <div className="text-zinc-500 uppercase tracking-wider text-[10px]">Language</div>
                        <div className="text-zinc-200 mt-1 font-medium">{project.language || 'en'}</div>
                      </div>
                    </div>

                    {project.description && (
                      <div className="rounded-xl bg-black/20 border border-white/5 p-3 text-sm text-zinc-300 leading-relaxed">
                        {project.description}
                      </div>
                    )}

                    <div className="max-h-64 overflow-y-auto pr-1 space-y-2 custom-scrollbar">
                      {(project.files || []).map((file) => (
                        <div key={file.key} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-zinc-200 truncate">{file.name}</span>
                              <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] uppercase tracking-wider text-zinc-500">
                                {file.kind || 'file'}
                              </span>
                            </div>
                            <p className="text-[10px] text-zinc-500 mt-1">
                              {file.size ? `${(file.size / 1024).toFixed(1)} KB` : 'file'}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {file.editable && (
                              <button
                                onClick={() => handleEditProjectFile(project, file)}
                                className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-zinc-300 flex items-center gap-1.5 transition-colors"
                              >
                                <Pencil size={11} />
                                Edit
                              </button>
                            )}
                            {file.url && (
                              <a
                                href={file.url}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2.5 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-[11px] text-cyan-300 flex items-center gap-1.5 transition-colors"
                              >
                                <ExternalLink size={11} />
                                Open
                              </a>
                            )}
                            {file.deletable && (
                              <button
                                onClick={() => handleDeleteProjectFile(project, file)}
                                className="px-2.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-[11px] text-red-300 flex items-center gap-1.5 transition-colors"
                              >
                                <Trash2 size={11} />
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
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
