import { ArrowUpRight } from "lucide-react";
import { Link, useLocation } from "../router";

export function Footer() {
  const isEnglish = useLocation().pathname === "/en";

  return (
    <footer className="site-footer" id="contact">
      <div className="footer-kicker">{isEnglish ? "Start a project" : "开始一个项目"}</div>
      <a className="footer-email" href="mailto:info@twoquarters.com.cn">
        <span>info@<wbr />twoquarters.com.cn</span>
        <ArrowUpRight aria-hidden="true" />
      </a>
      <div className="footer-bottom">
        <span>Beijing · Hong Kong · Germany</span>
        <span>+86 10 6500 6833</span>
        <span>© 2026 Twoquarters</span>
        <Link to={isEnglish ? "/" : "/en"}>{isEnglish ? "中文" : "English"}</Link>
      </div>
    </footer>
  );
}
