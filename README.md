# Twoquarters · self-hosted portfolio

A standalone migration of the original portfolio UI. React/Vite frontend, Node 24 HTTP server, SQLite metadata and local image/video files. No Supabase, Sites, external authentication, remote image host, CDN, analytics or font service is used at runtime. Public visitors can browse without login. `/admin` uses an owner-created username/password.

Source repository: https://github.com/JeffersonYoung/JeffersonYoung.github.io (original checkout commit `d38724ca15c4194eb7cd768e47d1fc857d27a0de`).

Only the six repository sample projects and their repository images are imported. No live database or private user data has been copied. Existing original/Sites checkouts are unchanged.

## Local run

Requires Node **24.x** (native `node:sqlite`), npm, and local **FFmpeg/ffprobe** with the libx264 and AAC encoders (Docker installs the distro packages). Install/build require access to npm; running the built app does not.

    npm ci --ignore-scripts
    npm run build
    npm run admin:init -- your-admin-name
    APP_ORIGIN=http://localhost:3000 npm start

Open `http://localhost:3000` and `/admin`. The password prompt is hidden and requires 14–1024 characters. No preset username/password or production secret is included. Do not put passwords in shell commands, environment variables, source control or messages. `--stdin` is available for a secure password-manager pipe; command-line password arguments are not supported.

The default bind is loopback. `DATA_DIR` defaults to `./data`, containing `portfolio.sqlite`, its WAL files, and `uploads/`. A first start imports sample projects exactly once; deleting samples and restarting does not reimport them. Sample project images are copied into protected local storage. The home hero and About-page background also exist as public site decoration, independently of project publication; unpublishing a project does not remove those two decorative copies. All project images are served through authorization-checked routes, and unpublished project metadata and uploads are inaccessible to anonymous users.

For frontend development, run the API as above plus `npm run dev`; Vite proxies `/api` to port 3000. Set `APP_ORIGIN` to the exact Vite URL while doing admin development. Production uses the single built server, not Vite preview.

## Deploy with Docker on your server

1. Copy this folder/archive to the server. No GitHub push is required.
2. Install Docker Engine + Compose from their official distribution instructions if needed.
3. Copy `.env.example` to `.env`; set `APP_ORIGIN` to your real exact HTTPS origin.
4. Run `docker compose build`.
5. Run `docker compose run --rm portfolio node scripts/admin.mjs your-admin-name` and enter a unique password locally in the terminal. This initializes the persistent volume; it does not expose an account-creation endpoint.
6. Run `docker compose up -d`.
7. Route your existing HTTPS reverse proxy to `127.0.0.1:3000`. An Nginx location example is included under `deploy/`. Configure your own valid TLS certificate and redirect HTTP to HTTPS. The application refuses production mode with an HTTP origin, and uses Secure cookies under HTTPS.
8. Check `docker compose ps`, visit the public site, log into `/admin`, upload a temporary draft, publish/unpublish it, then remove it. Confirm an anonymous browser cannot access a draft image.

Container port 3000 is bound only to server loopback. The app runs as the unprivileged `node` user, with a read-only root filesystem and a persistent data volume. Preserve that volume on upgrades. **Never run `docker compose down -v` unless you intentionally want to destroy all content and account data.** Docker image pulls and certificate issuance/renewal require network access; app/page operation uses only your server. The server uses the locally installed Sharp image decoder and FFmpeg/ffprobe video tools; there are no remote API or runtime service dependencies.

If installing without Docker, build under Node 24, run as a dedicated non-root OS user, place DATA_DIR in a private writable directory, set `NODE_ENV=production`, `APP_ORIGIN=https://your-domain`, and put the loopback listener behind the same TLS reverse proxy. Use your normal system service manager for restart-on-failure.

## Password reset and access

    docker compose run --rm portfolio node scripts/admin.mjs your-admin-name --reset

For a non-Docker install, use `npm run admin:init -- your-admin-name --reset` with the same DATA_DIR. Resetting revokes all sessions. There is no public signup, email reset, external identity provider or stored cleartext password. Passwords use salted scrypt; sessions expire after eight hours, are stored hashed in SQLite and use HttpOnly + SameSite=Strict cookies. State-changing requests require exact Origin and a session CSRF token. Login throttling is persisted by account and socket IP. Behind the provided reverse proxy the IP limit is intentionally shared across visitors; forwarded client-IP headers are not trusted.

Keep the server and Node patched, use HTTPS, restrict SSH access and protect backups. Auth does not protect against a compromised server/root user. This is a single-owner/single-server app, not a multi-tenant CMS. Concurrent editors use last-saved metadata; simultaneous work should be coordinated.

## Back up and restore

A consistent backup must include **the entire data directory**, including SQLite WAL and uploads, plus this application archive for bundled images. Stop the service for backups to avoid a metadata/upload race. Backups contain password hashes and content: encrypt and restrict access, and keep an off-server copy.

Docker backup (run in this project directory):

    umask 077
    mkdir -p backups
    chmod 700 backups
    docker compose stop portfolio
    docker compose run --rm --no-deps -T portfolio tar czf - -C /app/data . > backups/portfolio-data.tar.gz
    docker compose start portfolio

Do not start a second application instance during backup. The command runs as the normal unprivileged service user, and the host writes the archive under a restrictive umask. Verify the archive with `tar tzf backups/portfolio-data.tar.gz` and test restore on an isolated host/volume.

Restore into an **empty new volume or private staging directory**, not over a running database. Stop the application, preserve the current volume as rollback, copy the archive into the new volume, extract under `/app/data`, and ensure UID/GID 1000 owns the restored files. Point Compose at the restored volume, start the app and verify project counts/images and admin login. Reset the admin password after recovery to revoke backed-up sessions. For bare Node, stop the process, archive the complete DATA_DIR with `tar`, and restore to an empty directory owned by the service user.

Uploads are decoded and re-encoded locally, stripping metadata and rejecting malformed images and excessive dimensions/frame counts. Uploaded images removed through admin are deleted from disk. Project deletion permanently removes that project's metadata/uploads from the active store; use backups for recovery. Bundled sample image files are never removed from the application.

## Video uploads and local compression

Admin projects accept one MP4, MOV (ISO BMFF/`ftyp` container), or WebM per upload, up to **250 MiB**, **10 minutes**, **4K (long edge ≤4096; ≤8,847,360 pixels)** and **120 input fps**. Older QuickTime MOV files without an `ftyp` header must be exported as MP4 first. Uploads stream to a private temporary file, rather than buffering the whole video in Node memory. The project still needs an image cover before publication; ready videos appear on its detail page and in admin previews.

The SQLite-backed queue runs **one local FFmpeg encode at a time** (two codec threads, one filter thread). Container signatures and ffprobe metadata are checked; actual decoding/encoding must succeed. Explicit MOV/Matroska demuxers and file-only protocols prevent playlist/network input. Output is H.264 (`libx264`, **CRF 22**, **fast** preset, `yuv420p`) plus optional AAC stereo **128 kbps / 48 kHz**, with metadata/chapters/subtitles removed and MP4 **faststart**. Output frame rate is capped at 30 fps. Landscape fits 1920×1080, portrait fits 1080×1920, square fits 1080×1080; aspect ratio/orientation are preserved without cropping or upscaling (dimensions rounded to even pixels). CRF is a quality target, not a promised size reduction; a tiny or already highly compressed source can become larger. HDR/10-bit footage is converted to 8-bit without a dedicated tone-mapping workflow; export SDR footage for predictable colors.

**Originals are never retained after processing**, whether it succeeds, fails, times out, or is cancelled. Partial outputs are also removed; only a validated, atomically renamed compressed MP4 becomes playable. Failed records retain a readable error, but retry requires a fresh upload. Interrupted uploads/encodes become failed and their temporary files are removed at startup; complete queued uploads continue processing after restart. Orphan video files are cleaned at startup. Keep your own original master files elsewhere before uploading.

Limits: at most **two simultaneous uploads**, **eight active/queued jobs**, **250 MiB output**, **30 seconds per probe** and **15 minutes per encode**. New jobs reserve **1 GiB free disk plus 500 MiB per active/new job** conservatively; admission is rejected when the filesystem is below this threshold. These checks reduce exhaustion risk but cannot reserve space against other host processes, so monitor disk usage. Deleting a video/project removes its compressed file and any staged input. Draft video metadata and bytes require the admin session; new anonymous requests are denied immediately on unpublish, including GET, HEAD and Range requests. Sources are never exposed through public routes.

Browsers receive only the normalized MP4; H.264/AAC playback still depends on browser/OS codec support (some Chromium/Linux builds omit proprietary codecs). Input codec support depends on the installed FFmpeg build. There is no remote storage, transcoding, CDN or streaming service, and no adaptive-bitrate/HLS rendition. Byte-range streaming supports seeking without loading the entire file into server memory.

Docker now installs FFmpeg and allows **2 CPU / 2 GiB RAM** for the service; provision at least that much plus OS/reverse-proxy overhead, and more storage for published videos. Keep FFmpeg and Node patched. For bare-metal installs, apply equivalent CPU/memory/process limits with your service manager. Use the updated Nginx example (`250m` body limit, streaming request buffering disabled, 600-second timeouts) so the proxy neither rejects videos nor stores another temporary original. The sample Compose file was statically reviewed, not built in this workspace.

## Validation

    npm run build
    npm run lint
    npm test
    npm run test:ui

Backend tests create isolated temporary data and test-only passwords, never production credentials. UI tests require Playwright Chromium (`npx playwright install chromium` if needed). See `VALIDATION.md` for actual executed results and deployment limits.

## Admin storage and categories

After login, the admin page shows the filesystem containing `DATA_DIR`: total, used by **all** applications, available to the app process (`bavail`, not `bfree`), and system-reserved free space. It also shows an estimated allocated-block total for the site's SQLite/WAL/SHM and flat `uploads/` files, including in-progress video files. This is separate from whole-filesystem usage; it excludes source code, backups and unrelated directories. Sparse files use allocated blocks rather than apparent length; hard links are counted once. No file contents are read and symlink/nested entries are not followed. A scan is bounded to 10,000 entries and a 250 ms cooperative budget; failures, unexpected entries or interrupted scans display “unavailable”, not zero. Scans are non-atomic estimates while uploads, SQLite or other filesystem users change files.

Use **刷新空间** or reload to refresh the sample without saving/discarding a project draft. The authenticated, no-store `GET /api/admin/storage` exposes numeric totals only, never host paths; unavailable filesystem statistics produce a generic error. This is not a per-container quota report: filesystem reporting can differ from hosting quotas, Docker writable-layer limits and actual ability to write. If `uploads/` is on a separate mount, its available bytes are shown separately for video admission. One new video requires 1 GiB reserve plus 500 MiB for each active job and the new job; displayed eligibility is only the space check, and upload-time checks and queue/concurrency limits remain authoritative.

Selectable project categories, in order: **汽车、CG&AI、快消、视频、幕后影像**. Existing `automotive` and `bts` records retain their identities; the user-approved `fashion` → `fmcg` migration runs on startup and preserves all other project metadata and image references. New sample content uses `fmcg`. Uploading a video does not change its project's category. Back up the data directory before upgrading as usual.

## Footer filing information and social links (runtime configuration)

The footer supports ICP and public-security filing numbers, additional filing text/verification links, and any number of named social profiles (up to 20). No actual filing numbers or social accounts are supplied. Labels appear as configured on both Chinese and English pages. Empty numbers/labels are hidden; an additional filing item may be plain text. A social item requires both a label and a URL. No icons, SDKs or external services are loaded: external websites are visited only when the visitor clicks a link.

The optional server-side JSON file is read **once at startup** via `SITE_CONFIG_FILE`. Without that environment variable, the footer has no filing or social entries. Edits require a server restart/recreation, **not a frontend rebuild**. The public, read-only `GET /api/site-config` returns only normalized `filingItems` and `socialLinks`, never the original config, extra keys, filesystem paths, or credentials. Keep this file outside `public/` and `dist/`; do not put secrets in it. Fetch errors/timeouts hide these optional rows without breaking browsing. An explicitly configured missing, unreadable, oversized (>64 KiB), malformed or invalid file fails server startup with a generic error rather than silently omitting required filing information.

Copy the empty template without overwriting an existing config:

    mkdir -p config
    test -e config/site.json || cp config/site.example.json config/site.json
    chmod 755 config
    chmod 644 config/site.json

Edit `config/site.json` locally. This public-information file must be readable by the unprivileged container user (UID 1000); it is excluded from Git and Docker build context. Schema:

- `filing.icp`: `{ "number": "", "url": "https://beian.miit.gov.cn/" }`
- `filing.publicSecurity`: `{ "number": "", "url": "https://beian.mps.gov.cn/" }`
- `filing.other`: array of `{ "label": "", "url": "" }` (up to 20)
- `socialLinks`: array of `{ "label": "", "url": "" }` (up to 20)

Fill in only your real approved registration text and official verification URLs; for public-security registration, use the full verification URL provided for your registration. Social labels can be 小红书, 微博, 抖音, Instagram, or any custom name; add the real profile URL yourself. Empty strings in this documentation are intentional. Labels/numbers are limited to 200 characters; URLs to 2048. Links must be absolute `http://` or `https://` URLs without credentials, whitespace, control characters or backslashes; prefer HTTPS. HTML is rendered as text, never executed. All external links use `noopener noreferrer`.

Docker opt-in (base Compose still works with no config file):

    docker compose -f compose.yaml -f compose.filing.yaml up -d --build

The override mounts **only** `config/site.json`, read-only, and refuses to auto-create a missing host path. It does not mount or expose the containing directory. After editing/replacing the file, run `docker compose -f compose.yaml -f compose.filing.yaml up -d --force-recreate portfolio` to ensure the new bind-mounted file is read. Use both Compose files for subsequent lifecycle commands. Keep a copy of this config alongside your deployment backups; it is not in the data volume.

Bare Node:

    SITE_CONFIG_FILE=/absolute/path/to/site.json APP_ORIGIN=http://localhost:3000 npm start

A static-only frontend host has no server config endpoint and will show no optional footer entries; deploy the included same-origin Node server for this feature.
