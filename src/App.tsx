import { adminTransportAllowed } from "./lib/projects";
import { useEffect } from "react";
import { useProjects } from "./ProjectsContext";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { AboutPage } from "./pages/AboutPage";
import { AdminPage } from "./pages/AdminPage";
import { HomePage } from "./pages/HomePage";
import { ProjectPage } from "./pages/ProjectPage";
import { WorksPage } from "./pages/WorksPage";
import { Navigate, useLocation } from "./router";

function ScrollManager() {
  const location = useLocation();

  useEffect(() => {
    if (location.hash) {
      requestAnimationFrame(() => document.querySelector(location.hash)?.scrollIntoView());
    } else {
      window.scrollTo(0, 0);
    }
  }, [location.pathname, location.hash]);

  return null;
}

export function App() {
  const location = useLocation();
  const { error, refresh } = useProjects();

  if (location.pathname.startsWith("/admin")) {
    if (!adminTransportAllowed()) return <main className="portfolio-error" role="alert">请使用已配置的 HTTPS 管理地址登录。公开页面仍可通过 HTTP 浏览。</main>;
    return location.pathname === "/admin" ? <AdminPage /> : <Navigate to="/admin" replace />;
  }

  let page: React.ReactNode;
  if (location.pathname === "/") page = <HomePage />;
  else if (location.pathname === "/works") page = <WorksPage />;
  else if (/^\/works\/[^/]+$/.test(location.pathname)) page = <ProjectPage key={location.pathname} />;
  else if (location.pathname === "/about") page = <AboutPage />;
  else if (location.pathname === "/en") page = <HomePage english />;
  else page = <Navigate to="/" replace />;

  return (
    <>
      <ScrollManager />
      <Header />
      {error && <div role="alert" className="portfolio-error">{error} <button onClick={() => void refresh()}>重试</button></div>}
      {page}
      <Footer />
    </>
  );
}
