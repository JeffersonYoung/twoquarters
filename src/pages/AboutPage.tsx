import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Reveal } from "../components/Reveal";
import { responsiveImage } from "../lib/images";
import { Link, useLocation } from "../router";
import { isEnglishLocation } from "../lib/language";

const services = [
  ["01", "商业摄影", "汽车 / 人物 / 静物 / 美妆", "/works?category=automotive"],
  ["02", "CGI 与后期", "三维视觉 / 精修 / 动态图像", "/works"],
  ["03", "创意制作", "概念开发 / 制片 / 全球协作", "/works"],
  ["04", "品牌影像", "视觉系统 / 内容规划 / 资产管理", "/works?category=bts"],
];

export function AboutPage() {
  const english = isEnglishLocation(useLocation());
  const translatedServices = [
    ["Commercial Photography", "Automotive / Portraits / Still Life / Beauty"],
    ["CGI & Post-production", "3D Visuals / Retouching / Motion"],
    ["Creative Production", "Concept Development / Production / Global Collaboration"],
    ["Brand Imagery", "Visual Systems / Content Planning / Asset Management"],
  ];
  return (
    <main className="page-main about-page">
      <section className="page-intro about-intro">
        <span>Independent since 2011</span>
        <h1>{english ? <>Images that<br />go beyond still.</> : <>我们让图像<br />超越静止。</>}</h1>
        <a href="#about-story" aria-label={english ? "Read more" : "继续阅读"}><ArrowDownRight aria-hidden="true" /></a>
      </section>

      <section className="about-story" id="about-story">
        <div className="section-index">01 / Profile</div>
        <Reveal>
          <p className="about-lead">
            {english ? "Founded in 2011, Twoquarters Production Co. Ltd. is a creative production company bringing together photography, branding and marketing." : "Twoquarters Production Co. Ltd. 成立于 2011 年，是一家集摄影、品牌与营销于一体的综合型创意制作机构。"}
          </p>
        </Reveal>
        <div className="about-columns">
          <p>
            {english ? "Established in Hong Kong, we built a collaborative network across Germany and China. For more than a decade, we have connected international photographers, digital artists and local production teams to deliver complete visual services for brands across Europe and Asia." : "我们的总部始于香港，并在德国与中国建立协作网络。十余年来，我们持续连接国际摄影师、数字艺术家和本地制作团队，为欧洲与亚洲的品牌提供完整视觉服务。"}
          </p>
          <p>
            {english ? "Photography is at our core and informs every creative decision. Combining photographic craft, CGI and meticulous post-production, we create a brand language that can be felt, remembered and developed beyond a single image." : "摄影是我们的核心，也是所有创意判断的起点。我们结合实拍经验、CGI 技术与严谨后期，让作品不止于记录产品，而是建立一种能够被感知、记忆和延展的品牌语言。"}
          </p>
        </div>
      </section>

      <section className="about-image-band">
        <img {...responsiveImage("/images/about/grassland-stream.jpg", [480, 960, 1600], "100vw")} alt={english ? "Location scouting photograph of grassland and a stream" : "草原与溪流的环境勘景影像"} loading="lazy" decoding="async" />
        <span>Observe / Build / Refine</span>
      </section>

      <section className="about-services">
        <div className="section-heading">
          <span>02</span>
          <h2>{english ? "What we do" : "我们所做的事"}</h2>
        </div>
        <div className="service-table">
          {services.map(([number, title, description, href], index) => (
            <Reveal key={number}>
              <Link to={href} className="service-link" aria-label={english ? `${translatedServices[index][0]}: View work` : `${title}：查看作品`}>
                <span>{number}</span>
                <h3>{english ? translatedServices[index][0] : title}</h3>
                <p>{english ? translatedServices[index][1] : description}</p>
                <ArrowUpRight aria-hidden="true" />
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="about-numbers">
        <div><strong>2011</strong><span>{english ? "Founded in Hong Kong" : "成立于香港"}</span></div>
        <div><strong>3</strong><span>{english ? "Regional collaboration hubs" : "跨区域协作网络"}</span></div>
        <div><strong>10+</strong><span>{english ? "Years of international production" : "年国际制作经验"}</span></div>
      </section>

      <section className="contact-panel">
        <div>
          <span>03 / Contact</span>
          <h2>{english ? <>Let's talk about<br />your next image.</> : <>让我们谈谈<br />下一个画面。</>}</h2>
        </div>
        <div className="contact-details">
          <p>{english ? <>Room 404, Building 22, No. 4 Workers' Stadium North Road<br />Chaoyang District, Beijing, China · 100027</> : <>中国北京市朝阳区工人体育场北路 4 号<br />建设 22 栋 404 室 · 100027</>}</p>
          <a href="tel:+861065006833">+86 10 6500 6833 <ArrowUpRight aria-hidden="true" /></a>
          <a href="mailto:info@twoquarters.com.cn">info@twoquarters.com.cn <ArrowUpRight aria-hidden="true" /></a>
        </div>
      </section>
    </main>
  );
}
