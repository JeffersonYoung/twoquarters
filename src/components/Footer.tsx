import { SocialLinks, FilingLinks } from "./FooterLinks";
import { useEffect, useState } from "react";
import { getSiteConfig, type PublicSiteConfig } from "../lib/site-config";
import { ArrowUpRight } from "lucide-react";
import { Link, useLocation } from "../router";

export function Footer() {
  const [{ filingItems, socialLinks }, setSiteConfig] = useState<PublicSiteConfig>({ filingItems: [], socialLinks: [] });
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    void getSiteConfig(controller.signal).then(config => {
      if (!controller.signal.aborted) setSiteConfig(config);
    }).finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, []);
  const isEnglish = useLocation().pathname === "/en";

  return (
    <footer className="site-footer" id="contact">
      <div className="footer-kicker">{isEnglish ? "Start a project" : "开始一个项目"}</div>
      <a className="footer-email" href="mailto:info@twoquarters.com.cn">
        <span>info@<wbr />twoquarters.com.cn</span>
        <ArrowUpRight aria-hidden="true" />
      </a>
      <SocialLinks items={socialLinks} isEnglish={isEnglish} />
      <div className="footer-bottom">
        <span>Beijing · Hong Kong · Germany</span>
        <span>+86 10 6500 6833</span>
        <span>© 2026 Twoquarters</span>
        <Link to={isEnglish ? "/" : "/en"}>{isEnglish ? "中文" : "English"}</Link>
      </div>
      <FilingLinks items={filingItems} isEnglish={isEnglish} />
    </footer>
  );
}
