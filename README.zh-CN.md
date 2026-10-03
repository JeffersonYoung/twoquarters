> Database deployment policy: application startup only validates the database. Before first installation, explicitly run `DATA_DIR=... npm run db:init` with the app stopped. Existing installations require a reviewed manual migration (`db:migrate`) and backup. Automatic deployments never initialize or migrate databases. See [database release policy](deploy/database-policy.md).

# Twoquarters 自托管版

保留原作品集的视觉和页面；前台支持 HTTP 和 HTTPS 公开访问，生产环境的后台 `/admin` 及管理操作仅允许配置的 HTTPS 地址，使用您自己创建的用户名和密码。后端为 Node 24 + SQLite，图片保存在服务器本地，不再需要 Supabase、Sites 登录、远程图片/CDN、字体服务或第三方 API。依赖包仅在安装/构建时下载，运行时只访问自己的服务器。

## 内容范围

- 随包提供代码仓库里的 6 个示例项目和图片，仅在手动执行可选初始化命令时导入；没有迁移线上数据库或私人数据
- 原仓库、此前 Sites 版本没有改动
- 项目图片通过权限校验接口读取；草稿图片和管理接口不能匿名访问
- 首页主视觉和 About 页背景是公开装饰图，即使相关示例项目下线，这两张装饰图仍会保留
- 全新数据库正常启动后项目为空；启动或重启从不自动导入示例，也不会重新导入已删除的示例
- 正常启动及手动示例初始化均不创建 `settings` 表，不读取或写入 seed 标记；已有旧表保持不变

## 本地启动

安装 Node 24.x 后，在本目录执行：

    npm ci --ignore-scripts
    npm run build
    npm run admin:init -- your-admin-name
    APP_ORIGIN=http://localhost:3000 npm start

打开 `http://localhost:3000`，后台为 `/admin`。全新安装没有项目，公开作品页显示空状态；后台可点击“新建项目”添加第一个作品。管理员初始化时在终端隐藏输入 14–1024 个字符的独立密码；没有默认生产密码。不要把密码写进命令行、代码、环境变量或聊天。数据默认保存在 `data/`；自定义时，管理员初始化、示例初始化和服务启动必须使用同一个 `DATA_DIR`。

## 服务器部署（Docker Compose）

1. 把本目录上传到服务器；安装官方 Docker Engine 和 Compose
2. 复制 `.env.example` 为 `.env`，把 `APP_ORIGIN` 改成精确的**后台 HTTPS origin**，如 `https://your-domain.com`，不含路径或末尾斜杠；先保留 `TRUSTED_PROXY_IPS` 为空，确认实际代理来源 IP 后再配置，此时前台可访问、后台默认拒绝访问
3. 执行 `docker compose build`
4. 执行 `docker compose run --rm --no-deps portfolio node scripts/admin.mjs your-admin-name`，在您自己的终端隐藏输入密码；管理员初始化不导入示例
5. 可选：如需仓库示例，在服务停止、项目和视频记录及上传目录均为空时，执行 `docker compose run --rm --no-deps portfolio npm run samples:init`，使用同一持久数据卷；如需空作品集，跳过此步
6. 执行 `docker compose up -d`
7. 将 HTTP 和 HTTPS 两个站点配置均反向代理到 `127.0.0.1:3000`；使用 `deploy/nginx.conf.example`，HTTPS 配置有效证书，前台 HTTP 不强制跳转、不添加 HSTS；代理必须用真实 `$scheme` 覆盖 `X-Forwarded-Proto`
8. 按下节方法确认应用实际看到的代理连接 IP，在 `.env` 设置 `TRUSTED_PROXY_IPS`，再执行 `docker compose up -d --force-recreate portfolio`；不要猜测 Docker 网关地址
9. 分别检查 HTTP/HTTPS 公开页面；通过精确的 `APP_ORIGIN` 打开 `/admin`，检查登录、上传草稿、发布/下线和匿名访问权限。HTTP `/admin` 应拒绝访问，HTTP `/api/session` 应显示匿名；未导入示例时，作品页为空属于正常状态

生产模式要求后台使用 HTTPS，前台仍可使用 HTTP。容器以非 root 用户运行，3000 端口仅绑定回环地址。数据保存在持久卷中；更新代码时保留该卷。**不要执行 `docker compose down -v`，否则会删除数据卷。** TLS 证书、域名与已有服务需要按服务器实际配置处理，本包不会覆盖它们。

## 前台 HTTP 与仅 HTTPS 管理

生产环境的 `APP_ORIGIN` 仍须为精确的 HTTPS 地址，用于后台认证和管理；公开页面、公开只读接口及已发布媒体可通过 HTTP 或 HTTPS 访问。HTTP 内容不加密。应用不发送 HSTS，也不将前台 HTTP 自动跳转到 HTTPS。

生产环境的 `/admin*`、管理接口、登录/退出及所有写操作，必须经过可信的 HTTPS，并且请求 Host 与 `APP_ORIGIN` 完全一致（含非默认端口）。会话 cookie 使用 Secure、HttpOnly 和 SameSite=Strict。即使手动把会话 cookie 重放到 HTTP，请求也按匿名处理：`/api/session` 返回 `admin: false`，草稿图片/视频仍不可访问。HTTP 登录或管理请求会被拒绝，不会带着密码重定向；远程 HTTP 页面通过前端路由进入后台时，会显示“需要 HTTPS”的提示并隐藏密码表单，登录客户端也会在发送凭据前拒绝提交。请直接打开准确的 HTTPS 后台地址。本地开发示例允许回环 HTTP，生产环境不得使用开发模式；生产服务即使面对回环连接也没有 HTTP 管理例外。

HTTPS 由反向代理终止。`TRUSTED_PROXY_IPS` 只接受逗号分隔的**精确 IP 地址**，匹配应用 TCP 连接实际看到的代理来源；不接受 CIDR 网段、主机名或任意转发链。默认空值会拒绝代理后的生产后台访问。代理必须用实际连接协议覆盖用户传入的 `X-Forwarded-Proto`，即 `proxy_set_header X-Forwarded-Proto $scheme;`；HTTP/HTTPS 共用配置不得硬编码 `https`，也不得原样转发客户端提供的值。后端端口仅限回环或受保护的私有网络，不得让不可信客户端直接访问；仅有转发头不能证明连接安全。

宿主机 Nginx 直接连接宿主机 Node 回环端口时，可设置 `TRUSTED_PROXY_IPS=127.0.0.1,::1`。经 Docker 发布端口进入容器时，应用看到的实际来源可能不同；**不要猜测桥接网关，也不要信任整个子网**。保持 allowlist 为空并启动服务，通过真实代理发起前台 HTTP 请求；在服务器上使用已安装的 Docker、`nsenter` 和 `ss` 检查应用容器网络命名空间中的连接：

    container_pid=$(docker inspect --format '{{.State.Pid}}' "$(docker compose ps -q portfolio)")
    sudo nsenter --target "$container_pid" --net ss -tn '( sport = :3000 )'

从真实代理连接的 **Peer Address:Port** 列读取 IP（不含端口）。若连接太短而未看到，发起请求时再检查，不要从空结果猜测。只把确认过的代理 IP 写入 `.env`，使用部署时相同的 Compose 配置重新创建服务，然后验证 HTTPS 登录。无法确认来源时保持 allowlist 为空，先解决网络配置；代理或容器网络变更后再次检查。

在 Nginx 的 80 和 443 两个 server 块使用同一代理 location，不对前台 HTTP 强制跳转，也不添加 HSTS。检查已有代理/CDN 是否独立添加了跳转或 HSTS。浏览器中旧 HSTS 缓存、预加载规则或父域 `includeSubDomains` 策略仍可能强制 HTTPS，需等待相应策略过期或在可行时清除；修改应用不会清除它们。本次代码更新没有修改任何已有服务器部署、证书或代理配置。

## 可选：手动导入示例

可以完全跳过此步骤，直接创建自己的作品。`admin:init` 仅管理管理员账号，`samples:init` 仅导入 6 个仓库示例项目及图片，两者相互独立。

裸 Node：先停止所有使用同一数据目录的应用进程，再执行，最后启动服务：

    npm run samples:init
    APP_ORIGIN=http://localhost:3000 npm start

如有自定义 `DATA_DIR`，请在两条命令中均设置同一路径，并与管理员初始化保持一致；否则会使用默认的 `./data`。

Docker：先构建更新后的镜像，导入时保持服务停止，再启动：

    docker compose stop portfolio
    docker compose run --rm --no-deps portfolio npm run samples:init
    docker compose up -d

使用部署时相同的 Compose 项目、数据卷、环境变量和附加配置文件。导入期间不要让另一应用实例或第二个初始化进程访问该数据目录。

**只要已有任何项目、任何视频记录，或 uploads 目录含任何条目，命令就拒绝导入**；即使项目及上传目录为空，孤立视频记录也会阻止导入。不会覆盖或合并内容。因此成功后再次执行会被拒绝；删除项目后重启服务也不会自动导入。普通导入失败会回滚本次数据库变更，并清理本次创建的文件，清理成功后可安全重试；请先检查错误信息。进程突然终止或断电可能留下孤立文件，因为 SQLite 和文件系统无法组成同一个原子事务。此时先停止应用、备份完整数据目录，再人工检查并决定是否清理；初始化命令不会自动删除未知或孤立文件，上传目录非空时仍会拒绝。

## 旧 `settings` 表：可选人工清理

升级后的数据库可能保留旧示例导入标记。应用不会创建、读取、写入或自动删除该 `settings` 表；保留它不影响使用，也不会触发导入。此次代码更新**没有清理或修改任何生产数据库**。

确需删除旧表时，先停止所有使用该库的应用进程，完整备份数据目录（含 SQLite/WAL 和 uploads），并验证备份。随后使用 SQLite 工具检查真实表结构和全部记录：

    SELECT type, name, sql FROM sqlite_schema WHERE tbl_name = 'settings';
    PRAGMA table_info(settings);
    SELECT key, value FROM settings;

仅当表结构确认为旧版 `settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)`、没有未知索引/触发器或其他用途，且表内为空或只有唯一一条 `key = 'seed'`、`value = 'repository-only-v1'` 的记录时，才可继续。如果存在任何未知设置、结构差异或不确定之处，**保持原表不动**。表不存在则无需处理。完成上述检查和备份后，可选择在事务中删除：

    BEGIN IMMEDIATE;
    DROP TABLE settings;
    COMMIT;

重新启动后检查作品及管理员登录。这只是人工维护选项，不是必需迁移，也不是初始化步骤。

## 密码重置

忘记密码时，在同一数据卷上执行：

    docker compose run --rm portfolio node scripts/admin.mjs your-admin-name --reset

这会重置该管理员密码并注销全部会话。没有公开注册或邮件找回入口。

## 备份

先停止服务，备份完整数据目录（包括 SQLite/WAL 和 uploads），再启动。备份含密码哈希和内容，请加密并保存在服务器外。Docker 示例：

    umask 077
    mkdir -p backups
    chmod 700 backups
    docker compose stop portfolio
    docker compose run --rm --no-deps -T portfolio tar czf - -C /app/data . > backups/portfolio-data.tar.gz
    docker compose start portfolio

恢复到新的空数据卷，不要覆盖运行中的数据库；保留旧卷回滚，恢复文件归属为 UID/GID 1000。完整恢复说明见 `README.md`。恢复不需要执行 `samples:init`，也不依赖 seed 标记；数据库及 uploads 中的恢复内容即为数据来源，启动不会添加示例。后台删除会移除本地记录/上传文件，恢复需要备份。

## 已验证与限制

已通过：干净安装、TypeScript/Vite 构建、ESLint、真实 HTTP 后端测试（登录、CSRF、项目增删改、图片上传/解码、封面、发布/草稿权限、退出、限流）、服务重启和备份副本恢复后的数据持久化。完整 npm 依赖审计为 0 个已知漏洞。

当前云环境无法启动 Chromium 的进程 socket，云浏览器也禁止访问本地测试地址，所以自动化浏览器交互/截图尚未通过实际执行。完整桌面/手机端 UI 测试已包含，可在支持 Chromium 的本地或 CI 执行 `npm run test:ui`。Docker CLI 在当前环境不可用，因此 Docker 构建、容器启动和生产 HTTPS 未实测。

2026-10-03 再次尝试 SSH 连接目标服务器 `8.152.103.10:22`，仍返回 `Network is unreachable`。因此交付的是可部署代码，**尚未部署到您的服务器**，未修改服务器上的任何已有服务或凭据。

更多测试细节见 `VALIDATION.md`。

## 视频上传与压缩

已发布项目只要包含可播放视频，索引点击后就会在原 `/works/:slug` 地址直接打开播放页：主播放器在前，标题、简介、Credits 和延迟加载的补充图片在后。此行为取决于视频是否就绪，与“视频”等项目分类无关；纯图片项目保留原封面详情布局。保留浏览器原生播放控件，不强制自动播放。

多个就绪视频通过同页列表切换，始终只加载一个播放器。`/works/:slug?video=<视频ID>` 可直达指定版本，浏览器前进、后退恢复对应选择。不存在、已删除或未就绪的 ID 回退至第一个可播放视频；查询值不会直接拼成媒体地址，其他查询参数在切换时保留。无需更改后端接口、数据库或登录权限。

后台支持每次上传一个 MP4、MOV（带 ftyp 的 ISO BMFF）或 WebM，单个最大 250 MiB、最长 10 分钟、最高 4K / 120fps。项目仍需图片封面才能发布。旧版 MOV 如不能识别，请先导出 MP4。裸机需安装 FFmpeg/ffprobe（含 libx264/AAC）；Docker 已加入发行版 FFmpeg。

选择文件之前，可选择「服务器处理」（默认，上传原文件）或「浏览器压缩」（仅上传本地压缩成功的结果）。浏览器模式使用打包在本站的固定版本 Mediabunny + WebCodecs Worker，面向 Windows / macOS 当前版 Chrome，按实际编解码能力检查，不依赖浏览器名称。需要安全上下文、Worker、OffscreenCanvas、WebCodecs 和 OPFS 本地存储；独立的有界容器轨道检查会拒绝字幕、数据、未知或被解封装库遗漏的轨道，避免悄悄丢失内容；不支持的容器结构（例如 Segment 之外大小未知的 WebM 子元素）需手动选服务器模式。不加载 CDN、远程压缩服务或额外在线编码器。不支持、解码/编码失败或本地取消时，不上传视频，不自动上传原片，也不自动切换服务器模式；需要手动切换后重新选择文件。

本地压缩以流式方式写入独立 OPFS 临时文件，不把整段原片/输出缓存到内存；输出目标 H.264 最高约 4 Mbps、可选 AAC 双声道 128 kbps / 48 kHz，最高 30fps 与下述横竖屏限制。此码率目标与服务器 CRF 22 不等价，不保证相同质量或体积。上传完成、失败或取消后清理浏览器临时输出；权限、配额不足会明确失败。浏览器或系统崩溃可能阻止异步清理；如有遗留临时文件，可清理本站本地存储。取消上传时，服务器可能已收完文件，应查看列表并按需删除对应记录。母版请自行保存。

**本功能需要手动数据库发布：** schema v2 新增 `videos.compression_mode`，用于重启后保留处理策略。启动不会改库。按 `deploy/database-policy.md` 停止应用及工作任务、制作一致备份，在正确 `DATA_DIR` 下执行 `npm run db:migrate` 和 `npm run db:check`，然后启动审核后的版本。CI 数据库策略会阻止自动部署此更改，不应绕过；全新环境须显式执行 `npm run db:init`。

**服务器检查所有实际上传文件，不信任前端标记。** 符合条件的 MP4（H.264/yuv420p、可选 AAC、方形像素且无变换元数据、长边≤1920/短边≤1080、≤30fps、视频≤4.5 Mbps、音频≤160 kbps，以及文件大小和时长限制）仅无损整理封装为 faststart 并验证解码，不再有损压缩；即使原片未经前端压缩也一样。码率阈值用于浏览器输出准入和免转码判断，不是 CRF 服务器输出的硬性平均码率上限（短而复杂的片段平均码率可能更高）。缺失或不安全的元数据不能直接跳过处理。不合规输入在服务器模式下转码，在浏览器模式下拒绝，绝不悄悄转码。请求头 `X-Video-Compression: browser|server` 只选择处理策略，缺省为 server，重启后保留队列模式。

Mediabunny 1.61.0 使用 MPL-2.0；本站随构建提供许可证和原始源码获取说明，见 `public/licenses/mediabunny-NOTICE.txt`。

本站异步队列每次仅处理一个视频；确需转码时输出 H.264 + AAC MP4，CRF 22、fast preset、AAC 128 kbps，最高 30fps；横屏最高 1920×1080，竖屏最高 1080×1920，方形最高 1080×1080，保持比例，不裁切、不放大。开启 faststart，并支持 Range 分段请求和拖动进度。CRF 不是固定压缩比例，小文件可能变大；HDR 素材不做专用色调映射，建议上传 SDR。

按照配置策略，原片在成功、失败、超时、取消后都会删除，失败不能直接重试，需要重新上传。只保留成功压缩的 MP4；临时输出会清理。重启时中断的上传/压缩会标为失败并清理，已完整上传的等待任务继续处理。请自行保存母版。未发布的视频仅管理员可见，原片从不公开。

最多同时上传 2 个、排队/处理合计 8 个。输出上限 250 MiB，探测最长 30 秒，压缩最长 15 分钟。磁盘要求保留 1 GiB，加每个现有/新任务 500 MiB 的保守余量；其他服务器进程仍可能占用磁盘，需监控存储。Docker 限额更新为 2 CPU / 2 GiB RAM，宿主机需预留系统额外开销。Nginx 示例更新为 250m 上传限制、600 秒超时、关闭请求缓冲以避免重复临时文件。

播放依赖浏览器/系统的 H.264/AAC 支持（部分 Linux Chromium 不含专利编解码器）。无云转码、远程存储、CDN 或外部运行时服务。现有图片和数据库无需手工迁移。

## 管理端存储空间与分类

登录后，管理页面会显示网站数据目录所在文件系统的总容量、所有应用合计已用空间、当前进程可用空间（`bavail`）及系统保留空间；另行显示本站数据库、WAL/SHM 和上传目录内文件的已分配磁盘块占用估算，含处理中视频临时文件，不含代码、备份和其他目录。稀疏文件按实际分配块计量，硬链接去重；不读取文件内容，不递归子目录或跟随符号链接。扫描最多 10,000 个条目，采用 250ms 协作式时间预算；异常、目录结构不符或超出限制时显示“暂不可用”，不会误报为零。上传、压缩及数据库写入期间统计不是原子快照。

点击“刷新空间”或重新加载页面更新数据；刷新空间不会影响未保存的项目资料。`GET /api/admin/storage` 仅管理员可访问，禁止缓存且不返回主机路径。文件系统统计失败时显示可重试错误。磁盘容量不等同于主机商配额或容器独立额度；若上传目录单独挂载，另显该盘的视频可用空间。视频上传至少保留 1GiB，另为每个活动任务和新任务各留 500MiB。界面仅显示采样时空间条件，实际上传还会再次检查空间以及队列、并发限制。

项目分类依次为：**汽车、CG&AI、快消、视频、幕后影像**。按已确认要求，启动时自动将旧 `fashion`（时尚与美妆）归入 `fmcg`（快消），保留其他资料和图片引用；新示例也使用快消。原汽车和幕后影像数据保持原分类标识。上传视频不会自动改变项目分类。升级前请照常备份完整数据目录。

## 页脚备案信息与社交媒体链接（运行时配置）

备案号和社交账号由服务端 JSON 文件决定，不预置任何真实备案号或账号。支持 ICP、公安备案、其他备案项目，以及小红书、微博、抖音、Instagram 等任意自定义社交链接。中英文页面均显示配置的文字。备案文字为空则隐藏，可只显示文字、不设链接；社交项目必须同时有名称和链接才显示。不会加载外部图标、SDK 或服务，只有访客点击时才打开外部网页。

未设置 `SITE_CONFIG_FILE` 时完全隐藏这些可选内容。文件在服务启动时读取，修改后需重启/重新创建容器，**不需要重建前端**。公开只读接口 `/api/site-config` 仅返回经校验的 `filingItems` 和 `socialLinks`，不会返回原始配置、其他字段、路径或凭据。配置应放在 `public/`、`dist/` 之外，不要写入秘密信息。前端请求失败或超时不会影响浏览。显式指定的配置文件不存在、不可读、超过 64 KiB、JSON 或字段无效时，服务会启动失败并输出不包含路径/内容的通用错误，避免备案配置错误被静默忽略。

初次创建，不覆盖已有文件：

    mkdir -p config
    test -e config/site.json || cp config/site.example.json config/site.json
    chmod 755 config
    chmod 644 config/site.json

本文件仅存公开展示信息，须允许容器内非 root 用户（UID 1000）读取。`config/site.json` 已从 Git 和 Docker 构建上下文排除。编辑结构：

- `filing.icp`：`{ "number": "", "url": "https://beian.miit.gov.cn/" }`
- `filing.publicSecurity`：`{ "number": "", "url": "https://beian.mps.gov.cn/" }`
- `filing.other`：`{ "label": "", "url": "" }` 数组，最多 20 项
- `socialLinks`：`{ "label": "", "url": "" }` 数组，最多 20 项

请填写实际获批的备案文字及对应官方查询链接；公安备案请使用您的完整查询链接。社交媒体 `label` 可填“小红书”等任意名称，`url` 填自己的真实主页。示例空值是刻意保留的，不代表实际备案。文字最多 200 字符、链接最多 2048 字符。链接只接受完整 HTTP(S) URL，禁止用户名/密码、空白、控制字符和反斜杠，建议 HTTPS。文字中的 HTML 不会执行；外链使用 `noopener noreferrer`。

Docker 可选启用（原始 Compose 无配置文件也能运行）：

    docker compose -f compose.yaml -f compose.filing.yaml up -d --build

附加文件只读挂载单个 `config/site.json`，不会挂载整个目录，也不会自动创建缺失的宿主路径。编辑/替换文件后执行 `docker compose -f compose.yaml -f compose.filing.yaml up -d --force-recreate portfolio`，保证读取新文件；后续管理命令也使用这两个 Compose 文件。配置文件不在数据卷内，请单独随部署备份。

裸 Node 启动：

    SITE_CONFIG_FILE=/absolute/path/to/site.json APP_ORIGIN=http://localhost:3000 npm start

仅托管静态前端时没有此配置接口，可选页脚内容不会显示；请使用项目自带的同源 Node 服务。

## 缩略图与响应式图片

索引卡片及后台预览使用本地 WebP 缩略图，详情页按屏幕选择较大尺寸，只有打开灯箱才请求保留的原图。固定宽度为 480、960、1600 像素，不放大小图，自动修正 EXIF 方向并去除元数据。动图缩略图为首帧，原图保留动画。新上传先安全解码、重新编码，再生成三档尺寸；首页及关于页的静态图由 `npm run build` 的 prebuild 自动生成，无外部图片服务。

现有图片无需重新导入或重新发布：首次请求时按需生成缺少的尺寸，并缓存到磁盘；同时最多处理 2 个任务、排队 32 个任务，同一尺寸并发请求合并，繁忙时返回 503。仅允许上述固定尺寸。若希望提前生成以避免首访等待，请先停止应用、备份数据，再用相同 DATA_DIR 执行 `npm run images:prepare`；Docker 使用 `docker compose run --rm portfolio npm run images:prepare`。该命令可重复执行，不会导入样例、发布或修改项目。显式导入样例后也可以运行它；已有内容时不要再次运行 samples:init。

缩略图位于 uploads 的平面文件中：`image-<id>-w<width>.webp`，包含在备份和后台存储统计中，删除图片或项目时一并清理。请预留额外磁盘空间。原图和缩略图使用相同访问控制；登录态响应不缓存，公开图片使用 ETag 且每次必须重新验证，下架后不能靠旧 ETag 获取 304。不要让代理/CDN 覆盖成长期公共缓存；用户已经下载到设备上的文件无法撤回。
