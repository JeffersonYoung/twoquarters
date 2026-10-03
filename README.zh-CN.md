# Twoquarters 自托管版

保留原作品集的视觉和页面；前台公开访问，后台 `/admin` 使用您自己创建的用户名和密码。后端为 Node 24 + SQLite，图片保存在服务器本地，不再需要 Supabase、Sites 登录、远程图片/CDN、字体服务或第三方 API。依赖包仅在安装/构建时下载，运行时只访问自己的服务器。

## 内容范围

- 导入代码仓库里的 6 个示例项目和图片；没有迁移线上数据库或私人数据
- 原仓库、此前 Sites 版本没有改动
- 项目图片通过权限校验接口读取；草稿图片和管理接口不能匿名访问
- 首页主视觉和 About 页背景是公开装饰图，即使相关示例项目下线，这两张装饰图仍会保留
- 首次启动仅导入一次；重启不会重新导入已删除的示例项目

## 本地启动

安装 Node 24.x 后，在本目录执行：

    npm ci --ignore-scripts
    npm run build
    npm run admin:init -- your-admin-name
    APP_ORIGIN=http://localhost:3000 npm start

打开 `http://localhost:3000`，后台为 `/admin`。初始化时在终端隐藏输入至少 14 个字符的独立密码；没有默认生产密码。不要把密码写进命令行、代码、环境变量或聊天。数据默认保存在 `data/`。

## 服务器部署（Docker Compose）

1. 把本目录上传到服务器；安装官方 Docker Engine 和 Compose
2. 复制 `.env.example` 为 `.env`，把 `APP_ORIGIN` 改成真实 HTTPS 域名，如 `https://your-domain.com`
3. 执行 `docker compose build`
4. 执行 `docker compose run --rm portfolio node scripts/admin.mjs your-admin-name`，在您自己的终端设置密码
5. 执行 `docker compose up -d`
6. 使用现有 HTTPS 反向代理转发到 `127.0.0.1:3000`；Nginx 路由示例在 `deploy/nginx.conf.example`
7. 检查公开页面、登录、上传草稿、发布/下线和匿名访问权限

生产模式要求 HTTPS。容器以非 root 用户运行，3000 端口仅绑定回环地址。数据保存在持久卷中；更新代码时保留该卷。**不要执行 `docker compose down -v`，否则会删除数据卷。** TLS 证书、域名与已有服务需要按服务器实际配置处理，本包不会覆盖它们。

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

恢复到新的空数据卷，不要覆盖运行中的数据库；保留旧卷回滚，恢复文件归属为 UID/GID 1000。完整恢复说明见 `README.md`。后台删除会移除本地记录/上传文件，恢复需要备份。

## 已验证与限制

已通过：干净安装、TypeScript/Vite 构建、ESLint、真实 HTTP 后端测试（登录、CSRF、项目增删改、图片上传/解码、封面、发布/草稿权限、退出、限流）、服务重启和备份副本恢复后的数据持久化。完整 npm 依赖审计为 0 个已知漏洞。

当前云环境无法启动 Chromium 的进程 socket，云浏览器也禁止访问本地测试地址，所以自动化浏览器交互/截图尚未通过实际执行。完整桌面/手机端 UI 测试已包含，可在支持 Chromium 的本地或 CI 执行 `npm run test:ui`。Docker CLI 在当前环境不可用，因此 Docker 构建、容器启动和生产 HTTPS 未实测。

2026-10-03 再次尝试 SSH 连接目标服务器 `8.152.103.10:22`，仍返回 `Network is unreachable`。因此交付的是可部署代码，**尚未部署到您的服务器**，未修改服务器上的任何已有服务或凭据。

更多测试细节见 `VALIDATION.md`。

## 视频上传与压缩

后台支持每次上传一个 MP4、MOV（带 ftyp 的 ISO BMFF）或 WebM，单个最大 250 MiB、最长 10 分钟、最高 4K / 120fps。项目仍需图片封面才能发布。旧版 MOV 如不能识别，请先导出 MP4。裸机需安装 FFmpeg/ffprobe（含 libx264/AAC）；Docker 已加入发行版 FFmpeg。

本站异步队列每次仅处理一个视频：H.264 + AAC MP4，CRF 22、fast preset、AAC 128 kbps，最高 30fps；横屏最高 1920×1080，竖屏最高 1080×1920，方形最高 1080×1080，保持比例，不裁切、不放大。开启 faststart，并支持 Range 分段请求和拖动进度。CRF 不是固定压缩比例，小文件可能变大；HDR 素材不做专用色调映射，建议上传 SDR。

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
