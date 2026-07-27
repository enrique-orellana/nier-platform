const TAB_PATHS = {
  dashboard: '/',
  saasshorts: '/ai-shorts',
  'ai-agent': '/ai-agent',
  'ugc-gallery': '/ugc-gallery',
  thumbnails: '/thumbnails',
  projects: '/projects',
  settings: '/settings',
};

export const getPathForTab = (tab) => TAB_PATHS[tab] || TAB_PATHS.dashboard;

export const getTabFromPath = (pathname) => {
  const normalizedPath = pathname.replace(/\/$/, '') || '/';
  const entry = Object.entries(TAB_PATHS).find(([, path]) => path === normalizedPath);
  return entry?.[0] || 'dashboard';
};
