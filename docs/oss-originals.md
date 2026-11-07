# Original image storage

Complete originals use a private Standard LRS bucket in Beijing. Thumbnails and videos remain on the existing server. Local original files are retained for backup and rollback.

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
- Enable authentication and verify it before switching to the private OSS origin. Never disable it while OSS remains the origin.

OSS objects advertise a 24-hour shared cache lifetime and browser revalidation. This does not replace the per-request publication check. Deleting/unpublishing a project revokes CDN access without waiting for cache expiry. Remote auth failure denies access rather than exposing cached drafts. Failed object deletion can leave a private orphan; it cannot be served once the database entry is removed.

Rollback: restore the previous ECS CDN origin and its Host/SNI settings first; the existing server image endpoint and retained local files continue to work. Keep remote authentication enabled through the origin change. Disable the OSS server environment only after the CDN rollback is verified. Do not remove local originals as part of rollback.
