# Validation record — 2026-10-03

## Passed in the cloud workspace

- Node v24.19.0; clean `npm ci --ignore-scripts`
- `npm run build`: TypeScript project checks and Vite production bundle
- `npm run lint`: ESLint with zero warnings
- Frontend API contract tests: CSRF headers, JSON/multipart handling, session restore/expiry, logout clearing, stale response protection and non-JSON error handling
- `npm test`: real local HTTP server and SQLite integration suite using a disposable directory/test-only account
  - Six repository sample projects imported once
  - Anonymous admin access denied; bad login denied; exact Origin checks
  - HttpOnly/SameSite session cookie and token-protected mutations
  - Create/update/delete, cover change and multiple-image upload
  - Invalid/truncated JPEG rejected after local Sharp decode; EXIF-oriented JPEG auto-rotated before metadata stripping
  - Draft uploads inaccessible anonymously; published uploads accessible; unpublish revokes access immediately
  - Imported sample project images also protected after unpublish
  - Logout invalidates sessions; persisted login rate limiting
  - Directory mode 0700 and database mode 0600
  - Static path/traversal probes cannot retrieve backend files or database
  - Process restart retains content; copying the complete stopped data directory into a new location restores metadata/images/sessions
  - Removed/unpublished samples are not reimported on restart
- `npm audit`: zero reported vulnerabilities across production and development dependencies at validation time
- Native Node syntax checks for server and admin-init scripts
- Source inspection: frontend assets and API calls are same-origin; CSP restricts runtime script/font/connect sources to self; no Supabase or Sites runtime integration remains

The review also checked cookie/session design, protected image access, data-directory permissions and upload handling. Identified issues were fixed; this is not a formal penetration test or a guarantee of security.

## Not executed / deployment limits

- Browser interaction suite (`npm run test:ui`) is included, but Chromium failed before opening a page due to process-socket `Operation not permitted`. The supported cloud browser also rejected localhost with `ERR_BLOCKED_BY_CLIENT`. No browser assertions or visual screenshot QA are claimed as passed.
- Docker/Compose CLI is unavailable here. Dockerfile, Compose, proxy example and backup instructions were reviewed statically but no container build/run or real TLS termination was executed.
- SSH to the authorized target 8.152.103.10:22 was retried with the supplied identity and accept-new host-key policy. It returned `Network is unreachable`; no remote commands or deployment occurred. The default environment SSH config additionally has an ownership-permission error, so a clean SSH config was used for the network recheck without disabling host-key checks.
- No production administrator or credentials were created. All test accounts exist only in deleted temporary directories.
- No live content migration, repository push or Sites deployment occurred.

## Run on the target before opening access

Build/start, initialize the real administrator locally, configure exact HTTPS APP_ORIGIN and reverse proxy, then verify the public homepage/works/detail routes and run the included browser suite on a supported host. Test a private draft upload in a separate anonymous session, publish/unpublish it, and test an isolated backup restore. Keep only one app instance writing the same SQLite/uploads directory.

## Video feature validation — 2026-10-03

- Final `npm run build` and `npm run lint`: passed
- Final `npm test`: **23/23 passed**, including 15 real-video integration scenarios (Node 24.19.0, FFmpeg/ffprobe 7.1.5)
- MP4 encoding verified H.264 video/AAC audio, 1920×1080 landscape output, smaller output for the high-bitrate fixture, private file permissions, and faststart `moov` before `mdat`
- WebM converted to MP4 with portrait dimensions preserved and no upscaling; MOV display-matrix rotation produced correctly oriented pixels without retained rotation metadata
- Invalid type, empty body, malformed name, oversized declared body, malformed/truncated containers, excessive dimensions/duration/fps rejected or safely failed
- Originals and partials deleted on success/failure; failed jobs require a new upload
- Anonymous draft access denied for GET/HEAD/Range; published full, prefix/suffix/open-ended ranges, invalid ranges, unpublish and deleted access checked
- CSRF/Origin/admin authorization checked; deletion is project-scoped
- Maximum two concurrent uploads and eight queued/active jobs checked; aborted bodies and deletion during active upload clean originals
- SIGTERM during active encode waited for cleanup before exit; restart cleaned interrupted/orphan source/output files, preserved ready output and continued complete queued uploads
- Frontend API tests cover raw video request body, encoded filename, MIME, CSRF and deletion; browser script now includes video upload/preview, draft preservation, privacy, published metadata loading and deletion flows
- Independent static review found two cancellation/shutdown races; both were fixed and covered by added regression tests

Browser suite was retried, but Chromium still failed before opening a page (`socket() failed: Operation not permitted`). New UI/browser assertions are included but **not executed**; no visual or actual browser playback QA is claimed. Docker/Compose remains unavailable: the FFmpeg package installation, 2 CPU / 2 GiB limits and Nginx changes are statically reviewed only. FFmpeg 5 compatibility is designed into the encoding flags and MOV test fixture, but this workspace executed FFmpeg 7 only. No production credentials/content/server changes or GitHub publication were performed for this feature.

## Storage overview and category validation — 2026-10-03

- Final TypeScript/Vite build and ESLint: passed
- `npm test`: **26/26 passed**, including all 15 real-FFmpeg video scenarios
- Authenticated storage endpoint returns no-store samples; anonymous requests are denied, no host paths exposed, total = used + process-available + reserved, and video admission estimates match shared reserve constants
- Storage unit tests cover BigInt arithmetic, invalid/oversized counters, sparse allocation, hard-link deduplication, symbolic links, nested entries, bounded scans and unavailable paths; unavailable managed-file scans return null
- Same-origin frontend API storage request, abort forwarding and error propagation passed
- All five exact category values accepted for new projects; old fashion creation rejected; an old persisted fashion record migrated on startup to fmcg with images intact and readable
- Browser script includes exact public/admin category order, storage display, refresh failure/recovery and unsaved-draft preservation; **not executed** because Chromium again aborted before opening a page with `socket() failed: Operation not permitted`
- No visual QA or deployment claimed; prior Docker/Compose and production-access limitations still apply

## Configurable footer validation — 2026-10-03

- Final TypeScript/Vite build and ESLint: passed
- `npm test`: **31/31 passed**, including all existing storage/category/auth/image and 15 real-FFmpeg video scenarios
- Config unit tests: empty defaults, ICP/public-security/other entries, extensible social profiles, field allowlisting, secret/path exclusion, bounded file/array/text sizes, malformed JSON/data, missing files, unsafe protocols, credentials and URL-normalization tricks
- Live local HTTP test: anonymous no-store config read, exact allowlisted response, no config file download, unauthorized mutation denied, existing data backup/restart checks still pass
- Frontend request tests: same-origin request with abort signal, defensive URL parsing, offline/non-JSON/error response handling
- React static-render tests: empty rows omitted, literal HTML escaped, plain-text filing entry supported, meaningful accessible labels, external links carry `target="_blank"` and `rel="noopener noreferrer"`
- Node syntax checks for config/server/browser-test scripts passed
- Browser script now covers desktop/mobile footer, Chinese/English accessibility labels, HTML-as-text, empty/error configuration and existing regressions. Chromium failed before opening a page with `socket() failed: Operation not permitted`, including the permitted elevated retry; **no browser assertions, screenshots or visual QA passed**
- Optional Docker bind configuration and permissions reviewed statically only; Docker/Compose CLI remains unavailable
- No database schema changes, actual filing numbers/social accounts, production credentials, deployment or GitHub push for this change

## Manual sample initialization — 2026-10-03

- Startup no longer imports repository samples; new databases have no `settings` table or replacement seed-marker table
- Optional `npm run samples:init` / Docker deployment command imports six samples explicitly; Docker image includes the CLI, and admin hidden-password setup remains independent
- Isolated tests cover repeated empty startup, an explicit successful import, duplicate/nonempty refusal, preservation of an existing admin, and deleting all samples followed by repeated empty startup
- Existing custom project metadata/media and legacy `settings` rows survive the upgrade; the separately approved fashion → fmcg migration still preserves all other fields
- Partial import failures from missing source files and duplicate inserts roll back rows and remove attempt-owned files; retry succeeds. Existing uploads and orphan video records cause a safe refusal
- Concurrent initializer regression confirms one success/one refusal, six project rows, and no extra upload files
- SQLite and filesystem writes are not crash-atomic: abrupt termination/power loss can leave orphan files. The documented recovery requires a stopped app, complete backup and manual inspection; unknown files/settings are never automatically deleted by the initializer
- Existing API/browser fixture setup now explicitly imports sample content instead of depending on server startup
- Browser suite retried after updating fixtures; Chromium still aborts before opening a page with `socket() failed: Operation not permitted`. No browser assertions, screenshots, or visual QA are claimed
- No production database, credentials, server configuration or deployment changed; optional legacy-table cleanup is documentation only

## Public HTTP access with HTTPS-only administration

- Public pages, site configuration, published project lists, published images and videos return 200 over ordinary HTTP and trusted-proxy HTTPS, without app-generated redirects or HSTS.
- In production, HTTP admin pages, login/logout and mutations are denied before handling credentials. HTTP session reads are anonymous; manually replaying an admin cookie does not expose draft images or videos.
- HTTPS proxy trust is opt-in through exact `TRUSTED_PROXY_IPS` socket peers. Integration tests reject a spoofed HTTPS header from `127.0.0.2` when only `127.0.0.1` is trusted, reject combined protocol values and wrong Host, and verify Secure login cookies.
- Same-origin CSRF checks remain in place. Public HTTP Origin cannot submit HTTPS admin login.
- The client hides the remote-HTTP admin form behind an HTTPS-required notice and rejects login before fetch; localhost HTTP remains available for development. Production server enforcement has no localhost bypass.
- Targeted verification: `node --test tests/transport.test.mjs tests/frontend-api.test.mjs` passed 10 tests, and `npm run build` passed. This validates application behavior locally; no real proxy, TLS certificate, firewall or remote server was configured or changed.

## Final combined validation — manual samples and public HTTP

- `npm run build`, `npm run lint`, and syntax checks for all server/scripts/tests `.mjs` files passed
- Final `npm test`: **40/40 passed**, including six sample-initialization scenarios, production transport and browser-fetch credential guards, and all existing video/storage/footer/auth/image regressions
- Final `npm run test:ui` retry remains blocked before any page/assertion by Chromium process-socket permission failure; no visual or actual browser playback QA passed
- Docker/Compose and real TLS/reverse-proxy deployment were not executed; no live server configuration or production data was changed

## Responsive image optimization — 2026-10-03

- Before: cards used the same original URL as detail/lightbox, with no responsive image variants
- Added protected local WebP variants at fixed 480/960/1600 widths; new uploads precompute, existing uploads/sample images generate on demand with two encodes/32 waiting jobs and per-variant coalescing. Explicit `images:prepare` warmup ran twice against 27 isolated sample images: 108 original/variant files, project rows unchanged
- New tests cover smaller dimensions/bytes, no upscaling, EXIF orientation, preserved originals, file permissions, cache reuse, overlapping-width generation/deletion, private/draft denial, ETag 304 with visibility revalidation, unpublish, delete cleanup, HEAD, rejected arbitrary/duplicate widths, and public-HTTP draft protection
- React-render/helper tests verify responsive sources/sizes, eager hero, lazy below-fold/gallery/admin images, optional dimensions, and full-size originals only in the opened lightbox. These are markup tests, not actual browser network/layout measurements
- Measured six bundled sample covers: original total 2,821,810 bytes; 480px WebP 115,082 bytes (95.9% smaller); 960px WebP 402,706 bytes (85.7% smaller), using quality 80. This measures encoded payload reduction only; no page-load timing claim is made
- `npm run test:ui` retried; Chromium still aborts before any page/assertion with `socket() failed: Operation not permitted`. No browser screenshots, image-quality visual signoff, network-selection timing, Docker deployment or real TLS/proxy tests passed in this environment
- No live server, remote repository, credentials or production data changed in this task
- Final combined `npm run build`, `npm run lint`, syntax checks, and `npm test` passed: **52/52 tests**. Independent review reran the overlapping-width deletion regression 30 times without orphan derivatives


## Direct video watch pages — 2026-10-03

- Existing index/card and project URLs now open a single primary native player when the public project contains ready videos; no intermediate cover/intro screen. Title, introduction and credits follow the player, then lazy supplemental photographs. Image-only details and responsive card thumbnails remain unchanged
- Media availability, not category, determines the layout. Multi-video selection uses `?video=<id>`, preserves other query parameters and replaces the keyed player without accumulating players; clicking the current selection does not add duplicate history. Project-path changes reset image-lightbox state
- Only ready canonical local video URLs in the current public project are selectable. Unknown/non-ready/deleted/query-injected IDs fall back to the first ready video. No backend/auth changes or migration; existing draft/visibility/byte-range protections remain in place
- Final build/TypeScript, ESLint, all `.mjs` syntax checks and `npm test` passed: **57/57 tests**, including five new markup/helper regressions covering every category, direct card links, player-first ordering, native controls/no autoplay, portrait aspect ratios, one-player selection, safe ID lookup and image-only fallback
- Updated browser suite includes index → player, actual fixture playback, multi-video deep links, repeated-current clicks, Back/Forward, desktop/mobile overflow and supplemental photo lightbox. `npm run test:ui` was attempted but Chromium aborted before opening a page with `socket() failed: Operation not permitted`. **No browser assertions, screenshots, visual responsive QA or actual playback passed** in this environment; markup/helper checks are not browser QA
- No staging/production writes, server deployment, remote GitHub publication, or MCP implementation performed as part of this change
