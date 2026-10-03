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
