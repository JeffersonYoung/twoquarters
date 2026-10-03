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
