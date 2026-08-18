import { useSyncExternalStore } from "react";
import App from "./App.jsx";
import Landing from "./Landing.jsx";
import Legal from "./Legal.jsx";
import { parseRoute } from "./routing";

function subscribe(callback) {
  window.addEventListener("hashchange", callback);
  window.addEventListener("popstate", callback);
  return () => {
    window.removeEventListener("hashchange", callback);
    window.removeEventListener("popstate", callback);
  };
}

function getSnapshot() {
  const hash = window.location.hash;
  const pathname = window.location.pathname.replace(/\/$/, "") || "/";
  const isAppRoute =
    pathname !== "/" && parseRoute(pathname).tab !== "dashboard";
  if (hash === "#legal") return "legal";
  if (
    isAppRoute ||
    hash === "#app" ||
    localStorage.getItem("openshorts_skip_landing") === "1"
  ) {
    return "app";
  }
  return "landing";
}

export default function Root() {
  const view = useSyncExternalStore(subscribe, getSnapshot);

  const handleLaunchApp = () => {
    localStorage.setItem("openshorts_skip_landing", "1");
    window.location.hash = "#app";
  };

  if (view === "legal") return <Legal />;
  if (view === "app") return <App />;
  return <Landing onLaunchApp={handleLaunchApp} />;
}
