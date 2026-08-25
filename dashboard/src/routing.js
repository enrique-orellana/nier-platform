const TAB_PATHS = {
  dashboard: "/",
  saasshorts: "/ai-shorts",
  "ai-agent": "/ai-agent",
  "ugc-gallery": "/ugc-gallery",
  thumbnails: "/thumbnails",
  editor: "/editor",
  highlights: "/highlights",
  projects: "/projects",
  performance: "/performance",
  settings: "/settings",
};

export const getPathForTab = (tab) => TAB_PATHS[tab] || TAB_PATHS.dashboard;

export const getTabFromPath = (pathname) => {
  const normalizedPath = pathname.replace(/\/$/, "") || "/";
  if (normalizedPath === "/projects" || normalizedPath.startsWith("/projects/"))
    return "projects";
  const entry = Object.entries(TAB_PATHS).find(
    ([, path]) => path === normalizedPath,
  );
  return entry?.[0] || "dashboard";
};

export const buildProjectPath = (projectId) =>
  `/projects/${encodeURIComponent(projectId)}`;

export const buildEditorPath = (projectId, clipIndex, versionId = null) => {
  const path = `${buildProjectPath(projectId)}/clips/${encodeURIComponent(clipIndex)}/editor`;
  return versionId ? `${path}?version=${encodeURIComponent(versionId)}` : path;
};

export const parseRoute = (input = window.location.href) => {
  const url = new URL(input, window.location.origin);
  const segments = url.pathname.split("/").filter(Boolean);
  const isProjectsRoute = segments[0] === "projects";
  const isEditorRoute =
    isProjectsRoute && segments[2] === "clips" && segments[4] === "editor";
  const hasProjectId = isProjectsRoute && segments.length >= 2;

  return {
    tab: getTabFromPath(url.pathname),
    projectId: hasProjectId ? decodeURIComponent(segments[1]) : null,
    clipIndex:
      isEditorRoute && /^\d+$/.test(segments[3]) ? Number(segments[3]) : null,
    editor: isEditorRoute,
    versionId: isEditorRoute ? url.searchParams.get("version") : null,
  };
};
