import { ArrowUpRight, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "../router";

const zhNav = [
  { to: "/", label: "首页" },
  { to: "/works", label: "作品" },
  { to: "/about", label: "关于 / 联系" },
];

export function Header() {
  const location = useLocation();
  const isEnglish = location.pathname === "/en";
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === location.pathname;

  useEffect(() => {
    document.documentElement.lang = isEnglish ? "en" : "zh-CN";
  }, [isEnglish]);

  return (
    <header className={`site-header ${open ? "menu-open" : ""}`}>
      <Link className="wordmark" to={isEnglish ? "/en" : "/"} aria-label="Twoquarters home">
        TWOQUARTERS
      </Link>

      <nav className="desktop-nav" aria-label={isEnglish ? "Primary navigation" : "主导航"}>
        {isEnglish ? (
          <>
            <a href="#work">Work</a>
            <a href="#capabilities">Capabilities</a>
            <a href="#contact">Contact</a>
          </>
        ) : (
          zhNav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}>
              {item.label}
            </NavLink>
          ))
        )}
      </nav>

      <Link className="locale-link" to={isEnglish ? "/" : "/en"}>
        {isEnglish ? "中文" : "EN"}
        <ArrowUpRight size={15} aria-hidden="true" />
      </Link>

      <button
        className="menu-button"
        type="button"
        aria-label={open ? "关闭菜单" : "打开菜单"}
        aria-expanded={open}
        onClick={() => setOpenPath(open ? null : location.pathname)}
      >
        {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </button>

      <div className="mobile-menu" aria-hidden={!open}>
        <nav aria-label={isEnglish ? "Mobile navigation" : "移动端导航"}>
          {isEnglish ? (
            <>
              <a href="#work" onClick={() => setOpenPath(null)}>Work</a>
              <a href="#capabilities" onClick={() => setOpenPath(null)}>Capabilities</a>
              <a href="#contact" onClick={() => setOpenPath(null)}>Contact</a>
            </>
          ) : (
            zhNav.map((item, index) => (
              <NavLink key={item.to} to={item.to} end={item.to === "/"} onClick={() => setOpenPath(null)}>
                <span>0{index + 1}</span>{item.label}
              </NavLink>
            ))
          )}
        </nav>
        <Link className="mobile-locale" to={isEnglish ? "/" : "/en"} onClick={() => setOpenPath(null)}>
          {isEnglish ? "切换至中文" : "English homepage"}
          <ArrowUpRight aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
