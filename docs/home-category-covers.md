# Homepage category covers

Manage the five independent covers in `/admin/home` → 栏目封面. Upload/replacement
publishes immediately; clearing a cover leaves a plain category card. These
operations do not modify projects, their covers, or homepage carousel slides.

Configuration is atomically stored in `DATA_DIR/home-categories.json`, with an
optimistic revision for concurrent editors. No SQLite schema changes are needed.
Include this file and `uploads/` in the normal full DATA_DIR backup. At first
startup only, current published category covers are copied into new independent
image assets; later project edits, deletion, or unpublication cannot change them.
Empty categories stay empty until a cover is uploaded. Clearing a cover never
reimports it from projects.

- `GET /api/home-categories`: public covers.
- `GET /api/admin/home-categories`: authenticated editor state.
- `POST /api/admin/home-categories/:category`: raw JPEG/PNG/WebP bytes,
  `X-Upload-Name` (URL-encoded filename), `X-Config-Revision` (current revision).
- `DELETE /api/admin/home-categories/:category`: JSON `{revision}`.

Writes require the existing administrator session, same-origin Origin and CSRF
token. A 409 requires reloading and reviewing the other editor's changes. Limits
are 40 MiB / 80 million pixels; static images only. The shared homepage image
pipeline strips metadata and creates 480/1280/2560px sRGB WebP variants without
upscaling, retaining local files and uploading to the existing private OSS bucket.
The frontend requests canonical variant URLs through the shared image CDN and
falls back to same-origin on failure. CDN authorization permits only currently
configured covers. Replacing or clearing a cover revokes the previous IDs before
cleanup; failure to upload or persist leaves the previous configuration intact.
