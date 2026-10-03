# Twoquarters · self-hosted portfolio

A standalone migration of the original portfolio UI. React/Vite frontend, Node 24 HTTP server, SQLite metadata and local image files. No Supabase, Sites, external authentication, remote image host, CDN, analytics or font service is used at runtime. Public visitors can browse without login. `/admin` uses an owner-created username/password.

Source repository: https://github.com/JeffersonYoung/JeffersonYoung.github.io (original checkout commit `d38724ca15c4194eb7cd768e47d1fc857d27a0de`).

Only the six repository sample projects and their repository images are imported. No live database or private user data has been copied. Existing original/Sites checkouts are unchanged.

## Local run

Requires Node **24.x** (native `node:sqlite`) and npm. Install/build require access to npm; running the built app does not.

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

Container port 3000 is bound only to server loopback. The app runs as the unprivileged `node` user, with a read-only root filesystem and a persistent data volume. Preserve that volume on upgrades. **Never run `docker compose down -v` unless you intentionally want to destroy all content and account data.** Docker image pulls and certificate issuance/renewal require network access; app/page operation uses only your server. The server uses the locally installed Sharp image decoder; there are no remote API or runtime service dependencies.

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

## Validation

    npm run build
    npm run lint
    npm test
    npm run test:ui

Backend tests create isolated temporary data and test-only passwords, never production credentials. UI tests require Playwright Chromium (`npx playwright install chromium` if needed). See `VALIDATION.md` for actual executed results and deployment limits.
