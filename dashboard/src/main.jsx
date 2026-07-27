import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Landing from './Landing.jsx'
import Legal from './Legal.jsx'
import { getPathForTab, getTabFromPath } from './routing'

// eslint-disable-next-line react-refresh/only-export-components
function Root() {
  const resolveView = () => {
    const hash = window.location.hash;
    const pathname = window.location.pathname.replace(/\/$/, '') || '/';
    const isAppRoute = pathname !== '/' && getPathForTab(getTabFromPath(pathname)) === pathname;
    if (hash === '#legal') return 'legal';
    if (isAppRoute || hash === '#app' || localStorage.getItem('openshorts_skip_landing') === '1') return 'app';
    return 'landing';
  };

  const [view, setView] = useState(resolveView);

  useEffect(() => {
    const handleHashChange = () => setView(resolveView());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleLaunchApp = () => {
    localStorage.setItem('openshorts_skip_landing', '1');
    window.location.hash = '#app';
    setView('app');
  };

  if (view === 'legal') return <Legal />;
  if (view === 'app') return <App />;
  return <Landing onLaunchApp={handleLaunchApp} />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
