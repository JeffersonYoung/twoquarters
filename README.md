> Database deployment policy: application startup only validates the database. Before first installation, explicitly run `DATA_DIR=... npm run db:init` with the app stopped. Existing installations require a reviewed manual migration (`db:migrate`) and backup. Automatic deployments never initialize or migrate databases. See [database release policy](deploy/database-policy.md).

# Twoquarters · self-hosted portfolio

A standalone migration of the original portfolio UI. React/Vite frontend, Node 24 HTTP server, SQLite metadata and local image/video files. No Supabase, Sites, external authentication, remote image host, CDN, analytics or font service is used at runtime. Public visitors can browse without login over HTTP or HTTPS. In production, `/admin` and all management operations require the configured HTTPS origin and use an owner-created username/password.

Source repository: https://github.com/JeffersonYoung/JeffersonYoung.github.io (original checkout commit `d38724ca15c4194eb7cd768e47d1fc857d27a0de`).

The six repository sample projects and their repository images are included as an **optional manual import**. Normal startup never imports them. No live database or private user data has been copied. Existing original/Sites checkouts are unchanged.

## Local run

Requires Node **24.x** (native `node:sqlite`), npm, and local **FFmpeg/ffprobe** with the libx264 and AAC encoders (Docker installs the distro packages). Install/build require access to npm; running the built app does not.

    npm ci --ignore-scripts
    npm run build
    npm run admin:init -- your-admin-name
    APP_ORIGIN=http://localhost:3000 npm start

Open `http://localhost:3000` and `/admin`. A fresh installation has no projects: the public portfolio shows its empty state, and admin offers **新建项目** to create the first project. The password prompt is hidden and requires 14–1024 characters. No preset username/password or production secret is included. Do not put passwords in shell commands, environment variables, source control or messages. `--stdin` is available for a secure password-manager pipe; command-line password arguments are not supported.

The default bind is loopback. `DATA_DIR` defaults to `./data`, containing `portfolio.sqlite`, its WAL files, and `uploads/`. Normal startup creates the required application tables with an empty projects collection on a fresh database; it never imports samples. Neither startup nor manual sample initialization creates a `settings` table or reads/writes a seed marker. If you choose the optional import below, sample project images are copied into protected local storage. The home hero and About-page background also exist as public site decoration, independently of project publication; unpublishing a project does not remove those two decorative copies. All project images are served through authorization-checked routes, and unpublished project metadata and uploads are inaccessible to anonymous users.

For frontend development, run the API as above plus `npm run dev`; Vite proxies `/api` to port 3000. Set `APP_ORIGIN` to the exact Vite URL while doing admin development. Production uses the single built server, not Vite preview.

## Deploy with Docker on your server

1. Copy this folder/archive to the server. No GitHub push is required.
2. Install Docker Engine + Compose from their official distribution instructions if needed.
3. Copy `.env.example` to `.env`; set `APP_ORIGIN` to your exact **admin HTTPS origin** (for example, `https://portfolio.example.com`, without a path or trailing slash). Leave `TRUSTED_PROXY_IPS` empty until you verify the proxy socket peer as described below; public browsing works, but production admin access is denied until it is configured.
4. Run `docker compose build`.
5. Run `docker compose run --rm --no-deps portfolio node scripts/admin.mjs your-admin-name` and enter a unique password locally in the terminal. This creates the admin separately from content; it does not import samples or expose an account-creation endpoint.
6. Optional, only if you want the repository samples: while the service is stopped and the projects, video records and uploads directory are empty, run `docker compose run --rm --no-deps portfolio npm run samples:init`. This uses the same persistent data volume. See the safeguards below; otherwise skip this step for an empty portfolio.
7. Run `docker compose up -d`.
8. Route **both HTTP and HTTPS** server blocks through your reverse proxy to `127.0.0.1:3000`, using `deploy/nginx.conf.example`. Configure your valid TLS certificate for HTTPS. Do not redirect public HTTP to HTTPS or add HSTS; see the transport requirements below. The proxy must overwrite `X-Forwarded-Proto` with its actual `$scheme`.
9. Verify the proxy’s exact backend socket peer IP, set `TRUSTED_PROXY_IPS` in `.env`, and run `docker compose up -d --force-recreate portfolio` to apply it. Follow the Docker discovery procedure below rather than guessing the bridge gateway.
10. Check `docker compose ps` and visit the public site over **both** schemes (an empty portfolio is expected if you skipped the optional import). Open `/admin` through the exact `APP_ORIGIN`, log in, upload a temporary draft, publish/unpublish it, then remove it. Verify HTTP `/admin` is denied, HTTP `/api/session` reports anonymous, and an anonymous browser cannot access draft images/videos.

Container port 3000 is bound only to server loopback. The app runs as the unprivileged `node` user, with a read-only root filesystem and a persistent data volume. Preserve that volume on upgrades. **Never run `docker compose down -v` unless you intentionally want to destroy all content and account data.** Docker image pulls and certificate issuance/renewal require network access; app/page operation uses only your server. The server uses the locally installed Sharp image decoder and FFmpeg/ffprobe video tools; there are no remote API or runtime service dependencies.

If installing without Docker, build under Node 24, run as a dedicated non-root OS user, place DATA_DIR in a private writable directory, set `NODE_ENV=production`, `APP_ORIGIN=https://your-domain`, and put the loopback listener behind the same HTTP/HTTPS reverse proxy. When host Nginx connects directly to host Node over loopback, set `TRUSTED_PROXY_IPS=127.0.0.1,::1`. Use your normal system service manager for restart-on-failure.

## Public HTTP and HTTPS-only administration

Production `APP_ORIGIN` is still an exact HTTPS origin for **administration**, not a requirement that public visitors use HTTPS. Public pages, public read APIs and published media can use HTTP or HTTPS. HTTP content is unencrypted. The app emits no HSTS header and does not redirect public HTTP requests.

Production `/admin*`, admin APIs, login/logout and all state-changing requests require verified HTTPS with the request Host exactly matching `APP_ORIGIN` (including any non-default port). Session cookies are Secure, HttpOnly and SameSite=Strict. An HTTP request is treated as anonymous even if a session cookie is manually replayed: `/api/session` reports `admin: false`, and draft media remains inaccessible. Login/management requests sent over HTTP are rejected, not redirected with their credentials. On remote HTTP pages, client-side navigation to admin shows an HTTPS-required notice instead of a password form; the login client also rejects submission before sending credentials. Always open the exact HTTPS admin URL yourself. The local development commands above intentionally permit loopback HTTP; do not use development mode for production.

TLS terminates at your reverse proxy. `TRUSTED_PROXY_IPS` is a comma-separated allowlist of **exact IP addresses** for the proxy as seen by the application's TCP socket; it accepts no CIDRs, hostnames or arbitrary forwarding chains. Its default is empty, which denies proxied production admin access. The proxy must replace client-supplied `X-Forwarded-Proto` with the actual connection scheme, as in `proxy_set_header X-Forwarded-Proto $scheme;`. Never hardcode `https` in a location shared by HTTP and HTTPS, and never pass through a client-supplied value. Keep the backend port loopback-only/private and inaccessible to untrusted clients; the header alone is not proof of TLS.

For host Nginx → host Node over loopback, the peer is `127.0.0.1` or `::1`. For host Nginx → the Docker-published loopback port, Docker's network translation can expose a different peer inside the container. **Do not copy a presumed bridge gateway or trust a whole subnet.** With the service running and `TRUSTED_PROXY_IPS` still empty, send public HTTP requests through the real proxy. On the server, use the installed Docker, `nsenter` and `ss` tools to inspect connections in the app container’s network namespace:

    container_pid=$(docker inspect --format '{{.State.Pid}}' "$(docker compose ps -q portfolio)")
    sudo nsenter --target "$container_pid" --net ss -tn '( sport = :3000 )'

Read the **Peer Address:Port** column for the real proxy's connection, and record only its IP address. Repeat the inspection while making requests if no active connection is visible; do not infer an address from an empty result. Configure only verified proxy IPs in `.env`, then recreate the service using the same Compose files and verify HTTPS login. If you cannot identify the peer confidently, leave the allowlist empty and resolve the network configuration before enabling admin access. Recheck it after proxy/network changes.

Configure the shared Nginx location in both port-80 and port-443 server blocks, without an HTTP-to-HTTPS redirect or HSTS on this host. Existing reverse proxies/CDNs may add either independently; check them too. A browser's cached HSTS policy, a preload entry, or a parent domain's `includeSubDomains` policy can still force HTTPS until that policy expires or is cleared where possible; changing this app cannot undo it. No existing server, TLS certificate or deployment has been changed by this code update.

## Optional manual sample initialization

Skip this step to start with your own content. Admin account initialization and sample initialization are independent: `admin:init` only manages the admin account, and `samples:init` only imports the six bundled projects and their images.

For local Node, stop every application process using this data directory, then run the following **before** starting the app again:

    npm run samples:init
    APP_ORIGIN=http://localhost:3000 npm start

If you use a custom data directory, set the **same `DATA_DIR`** for `admin:init`, `samples:init`, and `npm start`; otherwise the command targets the default `./data` directory.

For Docker, build the updated image first and keep the service stopped during initialization:

    docker compose stop portfolio
    docker compose run --rm --no-deps portfolio npm run samples:init
    docker compose up -d

Use the same Compose project, volume, environment and overrides as your deployment. Do not run another application instance or a second initializer against that data directory during the import.

The initializer refuses to proceed if **any project or video record exists, or the uploads directory contains any entry**. This includes orphaned video records even if projects and uploads are empty. It does not overwrite or merge content. A second run after a successful import therefore refuses; deleting projects and restarting the server never imports them again. An ordinary import failure rolls back its database changes and cleans up files created by that attempt, allowing a retry once that cleanup succeeds. Check the reported failure before retrying. Abrupt termination or power loss can leave orphan files because SQLite and filesystem changes cannot be one atomic transaction. In that case, stop the app, back up the complete data directory and manually inspect it before any cleanup; the initializer does not automatically delete unknown or orphan files and will refuse a nonempty uploads directory.

## Existing legacy `settings` table (optional manual cleanup)

Upgraded databases may still contain the old sample-import marker in `settings`. The application leaves that table unchanged: it does not create it, use its marker, or automatically delete it. Keeping the table is harmless and does not cause sample imports. **No production database has been modified as part of this change.**

If you deliberately want to remove the legacy table, first stop all application processes using the database and make a complete, verified backup of the data directory, including SQLite/WAL and uploads. Use a SQLite tool to inspect the actual schema and all rows before making changes:

    SELECT type, name, sql FROM sqlite_schema WHERE tbl_name = 'settings';
    PRAGMA table_info(settings);
    SELECT key, value FROM settings;

Proceed only if this is exclusively the known legacy schema `settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)`, with no unfamiliar indexes/triggers or other use, and its rows are either empty or exactly the single pair `key = 'seed'`, `value = 'repository-only-v1'`. If there are any unknown settings, schema differences or doubts, **leave the table untouched**. If the table is absent, there is nothing to remove. Only after that inspection and backup, optional removal is:

    BEGIN IMMEDIATE;
    DROP TABLE settings;
    COMMIT;

Restart the application and verify your projects and admin login. This is a manual maintenance option, not a required migration or an initialization step.

## Password reset and access

    docker compose run --rm portfolio node scripts/admin.mjs your-admin-name --reset

For a non-Docker install, use `npm run admin:init -- your-admin-name --reset` with the same DATA_DIR. Resetting revokes all sessions. There is no public signup, email reset, external identity provider or stored cleartext password. Passwords use salted scrypt; sessions expire after eight hours, are stored hashed in SQLite and use HttpOnly + SameSite=Strict cookies. State-changing requests require exact Origin and a session CSRF token. Login throttling is persisted by account and socket IP. Behind the provided reverse proxy the IP limit is intentionally shared across visitors; forwarded client-IP headers are not trusted.

Keep the server and Node patched, use HTTPS for administration, restrict SSH access and protect backups. Auth does not protect against a compromised server/root user. This is a single-owner/single-server app, not a multi-tenant CMS. Concurrent editors use last-saved metadata; simultaneous work should be coordinated.

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

Restore into an **empty new volume or private staging directory**, not over a running database. Stop the application, preserve the current volume as rollback, copy the archive into the new volume, extract under `/app/data`, and ensure UID/GID 1000 owns the restored files. Point Compose at the restored volume, start the app and verify project counts/images and admin login. Restoring does not require `samples:init` or any seed marker: the restored database and uploads are the content source, and startup does not add sample projects. Reset the admin password after recovery to revoke backed-up sessions. For bare Node, stop the process, archive the complete DATA_DIR with `tar`, and restore to an empty directory owned by the service user.

Uploads are decoded and re-encoded locally, stripping metadata and rejecting malformed images and excessive dimensions/frame counts. Uploaded images removed through admin are deleted from disk. Project deletion permanently removes that project's metadata/uploads from the active store; use backups for recovery. Bundled sample image files are never removed from the application.

## Video uploads and local compression

Published projects with at least one ready video open directly as a watch page at the existing `/works/:slug` URL: one native player first, then title, introduction, credits and lazy supplemental photos. This is based on media availability, independent of the project category. Image-only projects keep their cover/detail layout. Playback starts only after a visitor chooses to play; no forced autoplay.

For multiple ready videos, the selector changes the single player in place. Share `/works/:slug?video=<video-id>` to link to a specific version; Back/Forward restores the selected video. Unknown, removed or non-ready IDs safely fall back to the first ready video, and query values never become media URLs. Other query parameters are preserved on selection. The watch-page selector itself does not alter authentication or media permissions.

Admin projects accept one MP4, MOV (ISO BMFF/`ftyp` container), or WebM per upload, up to **250 MiB**, **10 minutes**, **4K (long edge ≤4096; ≤8,847,360 pixels)** and **120 input fps**. Older QuickTime MOV files without an `ftyp` header must be exported as MP4 first. Uploads stream to a private temporary file, rather than buffering the whole video in Node memory. The project still needs an image cover before publication; ready videos appear on its detail page and in admin previews.

Before selecting a file, choose **Server processing** (the default, uploads the original) or **Browser compression** (uploads only the completed local result). Browser compression uses a locally bundled, pinned Mediabunny/WebCodecs worker, with native codec checks rather than user-agent detection. It targets current Chrome on Windows/macOS and requires a secure context, Workers, OffscreenCanvas, WebCodecs and origin-private file storage (OPFS). Missing capabilities, unsupported input, decode/encode failure or cancellation stop the operation: **no video upload and no automatic fallback**. To use the server instead, explicitly select server processing and choose the file again. A bounded independent container inventory rejects subtitle/data/unknown or omitted tracks instead of silently losing them. Unsupported container structures (including unknown-size WebM children other than the Segment) require manually selecting server mode. No codec extension, CDN or remote compression service is loaded.

Browser output is streamed to a unique OPFS temporary file; decoded media is processed in bounded pipelines instead of retaining full videos in memory. It targets H.264 at up to 4 Mbps and optional AAC stereo 128 kbps / 48 kHz, at most 30 fps and the same 1080p-oriented bounds below. Bitrate targeting is not equivalent to FFmpeg CRF 22 and does not promise identical size or quality. Temporary browser output is disposed after upload/failure/cancel; browser storage denial/quota failure is an explicit failure. A browser/OS crash can prevent asynchronous cleanup; clear this site’s local storage if an abandoned temporary file remains. Keep a local master; closing the page stops the attempt. An aborted upload may already have been completely received; refresh the video list and delete its record if needed.

**Manual database release required:** this feature adds schema version 2 (`videos.compression_mode`) to persist the selected policy across restarts. Startup does not alter the database. Follow `deploy/database-policy.md`: stop the app/workers, take a consistent backup, run `npm run db:migrate` with the intended `DATA_DIR`, run `npm run db:check`, then start the reviewed release. The CI database-policy gate intentionally prevents automatic deployment of this change; it must not be bypassed. Fresh disposable installations use explicit `npm run db:init`.

**Every upload is inspected regardless of the chosen mode.** A conforming MP4 (H.264/yuv420p, optional AAC, square pixels/no transform metadata, within 1920-long/1080-short edges, ≤30 fps, ≤4.5 Mbps video and ≤160 kbps audio plus file/duration limits) is losslessly remuxed with faststart and decode-validated, without another lossy encode. This includes originals that were never browser-compressed. Missing/unsafe metadata does not grant the fast path. These bitrate caps determine browser acceptance and lossless-copy eligibility, not a hard cap on a CRF-encoded server result (short detailed clips can have high average rates). Nonconforming server-mode input follows the existing transcode; nonconforming browser-mode input is rejected, never silently transcoded. `X-Video-Compression: browser|server` selects the policy, **not a trust signal**; omission means server mode for old clients. The selected mode persists in the queue across restart.

The SQLite-backed queue runs **one local FFmpeg processing job at a time** (two codec threads, one filter thread). Container signatures and ffprobe metadata are checked; actual decoding/encoding must succeed. Explicit MOV/Matroska demuxers and file-only protocols prevent playlist/network input. When transcoding is needed, output is H.264 (`libx264`, **CRF 22**, **fast** preset, `yuv420p`) plus optional AAC stereo **128 kbps / 48 kHz**, with metadata/chapters/subtitles removed and MP4 **faststart**. Output frame rate is capped at 30 fps. Landscape fits 1920×1080, portrait fits 1080×1920, square fits 1080×1080; aspect ratio/orientation are preserved without cropping or upscaling (dimensions rounded to even pixels). CRF is a quality target, not a promised size reduction; a tiny or already highly compressed source can become larger. HDR/10-bit footage is converted to 8-bit without a dedicated tone-mapping workflow; export SDR footage for predictable colors.

**Originals are never retained after processing**, whether it succeeds, fails, times out, or is cancelled. Partial outputs are also removed; only a validated, atomically renamed compressed MP4 becomes playable. Failed records retain a readable error, but retry requires a fresh upload. Interrupted uploads/encodes become failed and their temporary files are removed at startup; complete queued uploads continue processing after restart. Orphan video files are cleaned at startup. Keep your own original master files elsewhere before uploading.

Limits: at most **two simultaneous uploads**, **eight active/queued jobs**, **250 MiB output**, **30 seconds per probe** and **15 minutes per encode**. New jobs reserve **1 GiB free disk plus 500 MiB per active/new job** conservatively; admission is rejected when the filesystem is below this threshold. These checks reduce exhaustion risk but cannot reserve space against other host processes, so monitor disk usage. Deleting a video/project removes its compressed file and any staged input. Draft video metadata and bytes require the admin session; new anonymous requests are denied immediately on unpublish, including GET, HEAD and Range requests. Sources are never exposed through public routes.

Browsers receive only the normalized MP4; H.264/AAC playback still depends on browser/OS codec support (some Chromium/Linux builds omit proprietary codecs). Input codec support depends on the installed FFmpeg build. There is no remote storage, transcoding, CDN or streaming service, and no adaptive-bitrate/HLS rendition. Byte-range streaming supports seeking without loading the entire file into server memory.

Docker now installs FFmpeg and allows **2 CPU / 2 GiB RAM** for the service; provision at least that much plus OS/reverse-proxy overhead, and more storage for published videos. Keep FFmpeg and Node patched. For bare-metal installs, apply equivalent CPU/memory/process limits with your service manager. Use the updated Nginx example (`250m` body limit, streaming request buffering disabled, 600-second timeouts) so the proxy neither rejects videos nor stores another temporary original. The sample Compose file was statically reviewed, not built in this workspace.

Mediabunny 1.61.0 is MPL-2.0 licensed; its unmodified source and license notices are documented in `public/licenses/mediabunny-NOTICE.txt` and shipped with the site.

Implementation references: [Mediabunny conversion](https://mediabunny.dev/guide/converting-media-files), [codec availability](https://mediabunny.dev/guide/supported-formats-and-codecs), and [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API). Platform support is verified at runtime; see the validation record for platforms actually tested.

## Validation

    npm run build
    npm run lint
    npm test
    npm run test:ui
    npm run test:browser-video

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

## Responsive images

Project cards and admin previews request local WebP thumbnails; detail pages use larger responsive images, and opening the lightbox requests the retained original. Fixed widths are 480, 960 and 1600 pixels, with no upscaling, automatic EXIF orientation and stripped metadata. Animated uploads retain their original animation; thumbnails show the first frame. Uploads are still decoded/re-encoded before storage, then the three variants are prepared. Home/About decorative image variants are generated by `npm run build` (`prebuild`), with no external image service.

Existing uploaded/sample images work without reimporting or changing project records: missing variants are generated on first request, with two encodes at a time, a maximum of 32 waiting jobs, per-variant request coalescing and an on-disk cache. Only the three fixed sizes are accepted. A busy queue returns 503 for retry. To avoid first-visit generation on an existing installation, stop the app, back up `DATA_DIR`, then run `npm run images:prepare` with the same data directory (Docker: `docker compose run --rm portfolio npm run images:prepare`). This idempotent command does not seed, publish or edit projects. It is also safe after an explicit sample import; do not rerun `samples:init` on an existing site.

Variants are flat `uploads/image-<id>-w<width>.webp` files, included in backups and managed storage usage, and deleted with the image/project. Budget extra disk space for these derivatives. Missing variants regenerate from retained originals. Original and thumbnail URLs share the same publication/session authorization, including HTTP restrictions. Authenticated images use `private, no-store`; anonymous published images use ETags and `public, max-age=0, must-revalidate`, so even a cached request must recheck visibility before a 304. Do not configure a proxy/CDN to override this with long-lived public caching: unpublishing must take effect immediately. Already downloaded images cannot be recalled from a visitor's device.
