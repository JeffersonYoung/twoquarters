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
