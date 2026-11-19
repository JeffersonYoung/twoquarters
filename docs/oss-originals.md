# Original image storage

Complete originals and processed videos use a private Standard LRS bucket in Beijing. Thumbnails remain on the existing server. Local original files and processed videos are retained for backup and rollback.

Server environment:

```
OSS_BUCKET=twoquarters-images-1358252277159931
OSS_REGION=oss-cn-beijing
OSS_RAM_ROLE=TwoquartersImageStorageRole
```

The server uses ECS IMDSv2 temporary role credentials and the OSS internal HTTPS endpoint. No permanent AccessKey is stored. Uploads are committed to the project only after OSS accepts the original with Content-MD5 validation. Existing images migrate using `node scripts/migrate-originals-oss.mjs` with the same environment and DATA_DIR; the script is resumable and verifies length and SHA-256 metadata. Original bytes are not recompressed by migration.

`img.twoquarters.com.cn` is shared by both site environments and uses the bucket's public OSS endpoint as an OSS-type CDN origin, with private OSS authorization. CDN must perform remote authentication on **every request**, including cache hits, against `https://staging.twoquarters.com.cn/api/cdn-auth`:

- GET validation request; discard client headers and query arguments.
- Set `X-TQ-Original-Uri=$request_uri` and `X-TQ-Original-Method=$request_method` as custom validation headers.
- Only 200 allows access. 403/404, other status codes, and timeouts reject the request. Set a 3000ms timeout.
- Validation only accepts exact original UUID paths for published projects and GET/HEAD. No queries, thumbnail variants or admin routes.
- Ready videos use exact `/api/videos/<uuid>` paths. Every request (including cached byte ranges) requires a currently published parent project. Queued/failed videos, drafts, deleted rows, queries and other methods are denied.
- Enable authentication and verify it before switching to the private OSS origin. Never disable it while OSS remains the origin.

OSS objects advertise a 24-hour shared cache lifetime and browser revalidation. This does not replace the per-request publication check. Deleting/unpublishing a project revokes CDN access without waiting for cache expiry. Remote auth failure denies access rather than exposing cached drafts. Failed object deletion can leave a private orphan; it cannot be served once the database entry is removed.

Rollback: restore the previous ECS CDN origin and its Host/SNI settings first; the existing server image endpoint and retained local files continue to work. Keep remote authentication enabled through the origin change. Disable the OSS server environment only after the CDN rollback is verified. Do not remove local originals as part of rollback.

## Videos

Extend `TwoquartersImageStorageObjects` only with the same GetObject/PutObject/DeleteObject actions on this bucket's `api/videos/*` prefix. The separate CDN role `AliyunCDNAccessingPrivateOSSRole` also needs GetObject on that prefix in its `TwoquartersCDNReadOriginals` policy; granting only the ECS role leaves CDN origin fetches denied. Enable CDN `range` with `enable=on`; keep private OSS authorization and remote authentication (`all`, reject on failure/timeout) enabled. OSS supplies stable ETag, length and Range/206 responses; objects advertise shared caching for 86400 seconds and browser revalidation.

New processed MP4/WebM files are uploaded using a file path with streaming MD5/SHA-256 checks, then HEAD-verified before the row becomes ready. UUID objects are immutable. Admin previews remain authenticated same-origin requests. Deleting a row revokes access before best-effort private object removal. Failed cleanup can leave a private orphan but cannot expose it through CDN.

Deploy code first with `VIDEO_CDN_ENABLED` unset. Run `node scripts/migrate-videos-oss.mjs` as the service user with the existing DATA_DIR and OSS environment. It migrates **all ready videos, including drafts**, verifies length/type/SHA-256 metadata, skips verified objects on rerun, and retains local files. Only after migration, CDN configuration and authorization checks pass, set `VIDEO_CDN_ENABLED=1` and restart. Public project responses then add the canonical `cdnSrc`; the frontend accepts only that video's exact URL on `img.twoquarters.com.cn`. CSP explicitly allows this media origin. No schema migration is required.

Video-only rollback: unset `VIDEO_CDN_ENABLED` and restart, leaving existing image CDN/OSS settings intact. The player returns to the retained same-origin video endpoint on refresh. Verify cold/warm ranges, seek ranges, 416 handling, and cached-object denial after unpublishing with a disposable fixture; never toggle a user's published project merely to test privacy.
