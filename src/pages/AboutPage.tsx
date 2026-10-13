import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Reveal } from "../components/Reveal";
import { responsiveImage } from "../lib/images";
import { Link } from "../router";

const services = [
  ["01", "商业摄影", "汽车 / 人物 / 静物 / 美妆", "/works?category=automotive"],
  ["02", "CGI 与后期", "三维视觉 / 精修 / 动态图像", "/works"],
  ["03", "创意制作", "概念开发 / 制片 / 全球协作", "/works"],
  ["04", "品牌影像", "视觉系统 / 内容规划 / 资产管理", "/works?category=bts"],
];

export function AboutPage() {
  return (
    <main className="page-main about-page">
      <section className="page-intro about-intro">
        <span>Independent since 2011</span>
        <h1>我们让图像<br />超越静止。</h1>
        <a href="#about-story" aria-label="继续阅读"><ArrowDownRight aria-hidden="true" /></a>
      </section>

      <section className="about-story" id="about-story">
        <div className="section-index">01 / Profile</div>
        <Reveal>
          <p className="about-lead">
            Twoquarters Production Co. Ltd. 成立于 2011 年，是一家集摄影、品牌与营销于一体的综合型创意制作机构。
          </p>
        </Reveal>
        <div className="about-columns">
          <p>
            我们的总部始于香港，并在德国与中国建立协作网络。十余年来，我们持续连接国际摄影师、数字艺术家和本地制作团队，为欧洲与亚洲的品牌提供完整视觉服务。
          </p>
          <p>
            摄影是我们的核心，也是所有创意判断的起点。我们结合实拍经验、CGI 技术与严谨后期，让作品不止于记录产品，而是建立一种能够被感知、记忆和延展的品牌语言。
          </p>
        </div>
      </section>

      <section className="about-image-band">
        <img {...responsiveImage("/images/about/grassland-stream.jpg", [480, 960, 1600], "100vw")} alt="草原与溪流的环境勘景影像" loading="lazy" decoding="async" />
        <span>Observe / Build / Refine</span>
      </section>

      <section className="about-services">
        <div className="section-heading">
          <span>02</span>
          <h2>我们所做的事</h2>
        </div>
        <div className="service-table">
          {services.map(([number, title, description, href]) => (
            <Reveal key={number}>
              <Link to={href} className="service-link" aria-label={`${title}：查看作品`}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
                <ArrowUpRight aria-hidden="true" />
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="about-numbers">
        <div><strong>2011</strong><span>成立于香港</span></div>
        <div><strong>3</strong><span>跨区域协作网络</span></div>
        <div><strong>10+</strong><span>年国际制作经验</span></div>
      </section>

      <section className="contact-panel">
        <div>
          <span>03 / Contact</span>
          <h2>让我们谈谈<br />下一个画面。</h2>
        </div>
        <div className="contact-details">
          <p>中国北京市朝阳区工人体育场北路 4 号<br />建设 22 栋 404 室 · 100027</p>
          <a href="tel:+861065006833">+86 10 6500 6833 <ArrowUpRight aria-hidden="true" /></a>
          <a href="mailto:info@twoquarters.com.cn">info@twoquarters.com.cn <ArrowUpRight aria-hidden="true" /></a>
        </div>
      </section>
    </main>
  );
}
