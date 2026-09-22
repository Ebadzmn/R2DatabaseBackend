# Production-Grade Movie Streaming Backend

Build a production-ready backend for a movie/TV-series streaming platform using **Node.js + TypeScript + Express + MongoDB + Cloudflare R2 + FFmpeg**.

The backend will be controlled through a separate Admin Dashboard and consumed by a Flutter mobile application.

## 1. Main Goal

The system must allow an administrator to:

1. Add and manage multiple Cloudflare R2 storage configurations.
2. Test R2 credentials before saving them.
3. Upload large movie/video files, including 2–10+ GB files.
4. Automatically select an available R2 storage based on configured storage capacity.
5. Automatically move to the next R2 storage when the current storage reaches its configured limit.
6. Process uploaded videos into HLS streaming format using FFmpeg.
7. Store HLS files/segments in the selected R2 storage.
8. Store movie metadata and storage information in MongoDB.
9. Provide secure playback information/API for the Flutter application.
10. Never expose R2 secret credentials to the frontend or Flutter app.
11. Support multiple R2 accounts/buckets independently.
12. Provide detailed upload, processing, storage, and error status tracking.

---

# 2. Technology Stack

Use:

* Node.js
* TypeScript
* Express.js
* MongoDB
* Mongoose
* Cloudflare R2 using S3-compatible AWS SDK
* `@aws-sdk/client-s3`
* AWS S3 Presigned URLs where appropriate
* FFmpeg / FFprobe
* JWT authentication
* bcrypt/argon2 for password hashing
* Zod or Joi for request validation
* Helmet
* CORS
* Morgan or Pino logging
* dotenv
* Redis + BullMQ for background video processing
* Docker-ready architecture

Do NOT use rclone inside the production backend.

Rclone may only be used manually for testing or maintenance.

---

# 3. Architecture

Use a clean, modular, production-ready architecture.

Recommended structure:

```text
src/
├── config/
│   ├── env.ts
│   ├── database.ts
│   └── redis.ts
│
├── modules/
│   ├── auth/
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.routes.ts
│   │   ├── auth.validation.ts
│   │   └── auth.model.ts
│   │
│   ├── storage/
│   │   ├── storage.controller.ts
│   │   ├── storage.service.ts
│   │   ├── storage.routes.ts
│   │   ├── storage.validation.ts
│   │   ├── storage.model.ts
│   │   └── r2.service.ts
│   │
│   ├── movies/
│   │   ├── movie.controller.ts
│   │   ├── movie.service.ts
│   │   ├── movie.routes.ts
│   │   ├── movie.validation.ts
│   │   └── movie.model.ts
│   │
│   ├── upload/
│   │   ├── upload.controller.ts
│   │   ├── upload.service.ts
│   │   └── upload.routes.ts
│   │
│   └── processing/
│       ├── processing.service.ts
│       ├── processing.queue.ts
│       └── ffmpeg.service.ts
│
├── middleware/
│   ├── auth.middleware.ts
│   ├── error.middleware.ts
│   ├── rate-limit.middleware.ts
│   └── validation.middleware.ts
│
├── services/
│   ├── encryption.service.ts
│   ├── storage-manager.service.ts
│   └── media-metadata.service.ts
│
├── workers/
│   └── video-processing.worker.ts
│
├── utils/
│
├── app.ts
└── server.ts
```

Keep business logic out of controllers.

Controllers should be thin.

Services should contain business logic.

---

# 4. Storage Account System

Create a `StorageAccount` MongoDB model.

Fields:

```ts
{
  name: string;

  provider: "CLOUDFLARE_R2";

  accountId: string;

  bucketName: string;

  endpoint: string;

  accessKeyId: string;

  secretAccessKey: string;

  maxStorageBytes: number;

  usedStorageBytes: number;

  priority: number;

  status: "ACTIVE" | "INACTIVE" | "FULL" | "ERROR";

  lastCheckedAt?: Date;

  lastError?: string;

  createdAt: Date;

  updatedAt: Date;
}
```

## Credential Security

Never store the R2 secret key as plain text.

Encrypt:

```text
accessKeyId
secretAccessKey
```

before storing them in MongoDB.

Use AES-256-GCM or another secure authenticated encryption mechanism.

Encryption key must come from environment variables.

Never return:

```text
secretAccessKey
```

in API responses.

---

# 5. Storage Capacity Logic

The admin can configure a storage limit.

Example:

```text
R2-01
Limit: 10 GB
Used: 8 GB

R2-02
Limit: 10 GB
Used: 2 GB
```

If a new movie is:

```text
3 GB
```

R2-01 must NOT be selected because:

```text
8 GB + 3 GB > 10 GB
```

Select R2-02 instead.

Create a dedicated service:

```text
StorageManagerService
```

with functions such as:

```ts
getAvailableStorage(fileSize)
selectStorage(fileSize)
reserveStorage(storageId, fileSize)
releaseStorage(storageId, fileSize)
recalculateStorageUsage(storageId)
```

Use database transactions/atomic updates or another concurrency-safe mechanism so two simultaneous uploads cannot exceed the configured limit.

IMPORTANT:

Do not rely only on the stored `usedStorageBytes`.

Provide a way to recalculate actual storage usage from R2 and synchronize MongoDB.

---

# 6. Multiple R2 Support

Each storage account can have completely different:

```text
Cloudflare Account ID
Bucket
Endpoint
Access Key
Secret Key
```

The backend must dynamically create an S3 client for the selected storage.

Example concept:

```ts
createR2Client(storageAccount)
```

Do not hard-code one R2 account.

Do not hard-code:

```text
bucketName
accountId
accessKey
secretKey
```

---

# 7. R2 Connection Test

Admin dashboard must have:

```text
POST /api/admin/storage/test
```

Admin sends R2 configuration.

Backend must:

1. Create temporary S3 client.
2. Verify credentials.
3. Verify bucket access.
4. Verify read/list/write permission if safely possible.
5. Return a clear success/error response.
6. Never persist credentials during a failed test.

Example response:

```json
{
  "success": true,
  "message": "R2 connection successful"
}
```

For failure:

```json
{
  "success": false,
  "message": "R2 connection failed",
  "errorCode": "INVALID_CREDENTIALS"
}
```

Do not expose secret credentials in errors/logs.

---

# 8. Admin Storage APIs

Implement:

```http
GET    /api/admin/storage
POST   /api/admin/storage
POST   /api/admin/storage/test
GET    /api/admin/storage/:id
PATCH  /api/admin/storage/:id
DELETE /api/admin/storage/:id
POST   /api/admin/storage/:id/recalculate
POST   /api/admin/storage/:id/activate
POST   /api/admin/storage/:id/deactivate
```

Dashboard should be able to see:

```text
Storage Name
Bucket
Status
Used Storage
Configured Limit
Available Storage
Usage Percentage
Priority
Last Health Check
```

---

# 9. Large Movie Upload

Movies may be:

```text
500 MB
1 GB
2 GB
5 GB
10 GB+
```

Do NOT upload large files through:

```text
Browser → Express → R2
```

because this unnecessarily consumes backend bandwidth and memory.

Use:

```text
Admin Browser
      ↓
Backend
      ↓
Select R2
      ↓
Generate secure upload URL / multipart upload
      ↓
Browser
      ↓
Direct R2 Upload
```

Use multipart upload for large files.

The backend must support:

```text
upload initialization
upload parts
upload completion
upload abort
upload retry
```

Prefer direct-to-R2 upload architecture.

---

# 10. Upload Session

Create an `UploadSession` model:

```ts
{
  movieId?: ObjectId;

  storageAccountId: ObjectId;

  objectKey: string;

  fileName: string;

  fileSize: number;

  uploadId?: string;

  status:
    | "INITIALIZED"
    | "UPLOADING"
    | "COMPLETING"
    | "UPLOADED"
    | "PROCESSING"
    | "COMPLETED"
    | "FAILED"
    | "ABORTED";

  uploadedBytes: number;

  progress: number;

  error?: string;

  createdAt: Date;

  updatedAt: Date;
}
```

---

# 11. Upload API

Implement:

```http
POST /api/admin/uploads/init
POST /api/admin/uploads/:id/complete
POST /api/admin/uploads/:id/abort
GET  /api/admin/uploads/:id
```

The initialization endpoint must:

1. Validate file size.
2. Select correct R2 storage.
3. Reserve storage capacity.
4. Generate unique object key.
5. Create upload session.
6. Return required upload information.

Example:

```json
{
  "uploadId": "abc123",
  "storageAccountId": "storage123",
  "objectKey": "movies/reacher/s04/e03/source.mkv",
  "status": "INITIALIZED"
}
```

---

# 12. Movie Processing

After successful upload:

```text
R2 Source File
      ↓
BullMQ Job
      ↓
FFprobe
      ↓
Detect:
- video codec
- audio codec
- resolution
- duration
- bitrate
- frame rate
- audio tracks
- subtitle tracks
      ↓
FFmpeg
      ↓
HLS
      ↓
R2
```

Do not process large videos inside the Express request/response cycle.

Use BullMQ workers.

---

# 13. FFmpeg Processing

The processing worker should generate HLS.

For a 720p source, support:

```text
720p
480p
```

For higher-resolution sources, support:

```text
1080p
720p
480p
```

Use H.264 + AAC where transcoding is required.

Use appropriate HLS segment duration, for example:

```text
6 seconds
```

Generate:

```text
master.m3u8
720p/index.m3u8
720p/segment_000.ts
720p/segment_001.ts

480p/index.m3u8
480p/segment_000.ts
480p/segment_001.ts
```

Do not blindly re-encode if the source codecs are already compatible.

Use FFprobe first.

Where safe, use stream copy/remux to reduce processing time.

---

# 14. HLS Storage Structure

Use predictable object keys:

```text
movies/
  {movieSlug}/
    {movieId}/
      master.m3u8

      1080p/
        index.m3u8
        segment_000.ts
        segment_001.ts

      720p/
        index.m3u8
        segment_000.ts
        segment_001.ts

      480p/
        index.m3u8
        segment_000.ts
        segment_001.ts
```

Do not use the original filename as the only identifier.

---

# 15. Movie Model

Create:

```ts
Movie
```

with fields such as:

```ts
{
  title: string;

  slug: string;

  description?: string;

  poster?: string;

  backdrop?: string;

  type: "MOVIE" | "SERIES";

  releaseYear?: number;

  genres: string[];

  duration?: number;

  sourceStorageId: ObjectId;

  hlsStorageId: ObjectId;

  hlsMasterKey: string;

  sourceObjectKey?: string;

  fileSize?: number;

  videoCodec?: string;

  audioCodec?: string;

  resolution?: string;

  status:
    | "DRAFT"
    | "UPLOADING"
    | "PROCESSING"
    | "READY"
    | "FAILED";

  createdAt: Date;

  updatedAt: Date;
}
```

---

# 16. Movie Admin APIs

Implement:

```http
GET    /api/admin/movies
GET    /api/admin/movies/:id
POST   /api/admin/movies
PATCH  /api/admin/movies/:id
DELETE /api/admin/movies/:id

POST   /api/admin/movies/:id/process
POST   /api/admin/movies/:id/reprocess
GET    /api/admin/movies/:id/status
```

Support:

```text
search
pagination
filter
sort
status
genre
year
```

---

# 17. Public/Flutter APIs

Flutter application must never receive R2 secret credentials.

Implement:

```http
GET /api/movies
GET /api/movies/:id
GET /api/movies/:id/playback
```

Playback response:

```json
{
  "movieId": "...",
  "title": "Example Movie",
  "type": "HLS",
  "url": "https://stream.example.com/movies/abc/master.m3u8"
}
```

If the streaming domain is private, use short-lived signed URLs/tokens.

---

# 18. CDN / Domain Support

Do not expose raw R2 credentials.

Support a configurable streaming base URL:

```env
STREAMING_BASE_URL=https://stream.example.com
```

The backend generates playback URLs using:

```text
STREAMING_BASE_URL + HLS object path
```

Do not hard-code the domain in business logic.

---

# 19. Automatic Storage Rotation

Implement this exact behavior:

```text
Upload requested
      ↓
Calculate file size
      ↓
Find ACTIVE storage sorted by priority
      ↓
Check:
used + fileSize <= configured limit
      ↓
YES → reserve storage → upload
NO
      ↓
Try next storage
      ↓
If none available:
return STORAGE_CAPACITY_EXCEEDED
```

Example:

```text
R2-01 → 9.2 / 10 GB
R2-02 → 6.1 / 10 GB
R2-03 → 1.0 / 10 GB

Movie = 2 GB
```

R2-01:

```text
9.2 + 2 = 11.2 GB ❌
```

R2-02:

```text
6.1 + 2 = 8.1 GB ✅
```

Select R2-02.

Do NOT automatically create Cloudflare accounts.

Admin will add new R2 credentials through the dashboard.

---

# 20. Concurrency Protection

This is extremely important.

If two admins upload simultaneously:

```text
Movie A = 2 GB
Movie B = 2 GB

Storage:
8.5 / 10 GB
```

Do not allow both uploads to reserve the same remaining capacity.

Use atomic MongoDB operations / transactions / reservation records.

Concept:

```text
available =
maxStorageBytes
-
usedStorageBytes
-
reservedStorageBytes
```

Add:

```text
reservedStorageBytes
```

to the storage model.

After successful upload:

```text
reservedStorageBytes -= fileSize
usedStorageBytes += actualSize
```

If upload fails:

```text
reservedStorageBytes -= reservedSize
```

---

# 21. Storage Usage Synchronization

Provide:

```http
POST /api/admin/storage/:id/recalculate
```

Worker/service should:

1. List objects from R2.
2. Calculate total size.
3. Update MongoDB.
4. Exclude temporary/incomplete upload data where appropriate.

Also provide optional scheduled synchronization.

---

# 22. Delete Movie

When admin deletes a movie:

```text
Delete Movie
     ↓
Find HLS Storage
     ↓
Delete HLS directory/objects
     ↓
Delete source object if configured
     ↓
Update usedStorageBytes
     ↓
Delete MongoDB record
```

Do not reduce storage usage before successful deletion.

Use background jobs for deleting many HLS segments.

---

# 23. Error Handling

Create centralized error handling.

Standard response:

```json
{
  "success": false,
  "message": "Human readable message",
  "code": "STORAGE_UPLOAD_FAILED"
}
```

Use proper HTTP status codes.

Create error codes such as:

```text
INVALID_REQUEST
UNAUTHORIZED
FORBIDDEN
STORAGE_NOT_FOUND
STORAGE_CONNECTION_FAILED
STORAGE_CAPACITY_EXCEEDED
UPLOAD_NOT_FOUND
UPLOAD_FAILED
PROCESSING_FAILED
MOVIE_NOT_FOUND
```

Never expose:

```text
AWS secret
R2 secret
database credentials
internal stack traces
```

to clients.

---

# 24. Authentication

Create admin authentication.

Use:

```text
POST /api/admin/auth/login
POST /api/admin/auth/logout
GET  /api/admin/auth/me
```

Use JWT access tokens.

Protect every `/api/admin/*` route.

Use role:

```text
ADMIN
```

Keep authentication modular so additional roles can be added later.

---

# 25. Security

Implement:

* Helmet
* CORS whitelist
* Rate limiting
* Request validation
* JWT authentication
* Password hashing
* Secure HTTP headers
* Input sanitization
* MongoDB query protection
* File type validation
* File size validation
* Upload session expiration
* R2 credential encryption
* Audit logs
* No secrets in logs
* No secrets in API responses

Do not trust:

```text
file extension
client-provided MIME type
client-provided file size
```

Validate the uploaded object using server-side metadata/FFprobe where appropriate.

---

# 26. Audit Logs

Create an `AuditLog` model.

Track admin actions:

```text
ADMIN_LOGIN
STORAGE_ADDED
STORAGE_UPDATED
STORAGE_DELETED
STORAGE_TESTED
MOVIE_CREATED
MOVIE_DELETED
MOVIE_REPROCESSED
UPLOAD_STARTED
UPLOAD_COMPLETED
UPLOAD_FAILED
```

Store:

```text
adminId
action
resourceType
resourceId
metadata
createdAt
```

Never store secret keys.

---

# 27. Environment Variables

Create:

```env
NODE_ENV=development

PORT=5000

MONGODB_URI=

JWT_SECRET=

ENCRYPTION_KEY=

REDIS_URL=

STREAMING_BASE_URL=

FFMPEG_PATH=
FFPROBE_PATH=
```

R2 credentials should NOT be stored globally in `.env` if multiple R2 accounts are supported.

They belong in the encrypted `StorageAccount` records.

---

# 28. API Documentation

Use Swagger/OpenAPI.

Document every API:

```text
Authentication
Storage Management
Upload Management
Movie Management
Playback
```

Include request/response examples.

---

# 29. Logging

Use structured logging.

Log:

```text
request ID
admin ID
movie ID
upload ID
storage ID
operation
duration
status
error code
```

Never log:

```text
secretAccessKey
JWT secrets
passwords
encryption keys
```

---

# 30. Background Jobs

Use BullMQ queues:

```text
video-processing
storage-sync
movie-delete
upload-cleanup
```

Example:

```text
Upload completed
       ↓
video-processing queue
       ↓
FFprobe
       ↓
FFmpeg
       ↓
HLS upload
       ↓
Movie READY
```

Provide retry handling.

Failed jobs should have controlled retries and useful error information.

---

# 31. Docker

Provide:

```text
Dockerfile
docker-compose.yml
```

Services:

```text
api
worker
mongodb
redis
```

FFmpeg must be available inside the worker container.

---

# 32. Important Production Requirement

Do not build a fake/demo implementation.

All important flows must actually work:

```text
Admin login
     ↓
Add R2
     ↓
Test R2
     ↓
Save encrypted credentials
     ↓
Upload large movie
     ↓
Automatically select storage
     ↓
Create upload session
     ↓
Upload to R2
     ↓
Queue processing
     ↓
FFprobe
     ↓
FFmpeg
     ↓
Generate HLS
     ↓
Upload HLS to R2
     ↓
Update MongoDB
     ↓
Movie READY
     ↓
Flutter requests playback URL
     ↓
HLS streaming
```

---

# 33. Development Rules

Before writing code:

1. Analyze the entire architecture.
2. Create database schemas.
3. Create API contracts.
4. Create service interfaces.
5. Create storage abstraction.
6. Implement R2 provider.
7. Implement storage selection/reservation.
8. Implement upload system.
9. Implement BullMQ worker.
10. Implement FFmpeg processing.
11. Implement movie APIs.
12. Implement authentication/security.
13. Add Swagger.
14. Add tests.
15. Add Docker configuration.

Do not put everything into one file.

Do not duplicate R2 logic across controllers.

Create reusable abstractions.

---

# 34. Testing Requirements

Create tests for:

### Storage

```text
R2 connection success
R2 invalid credentials
Storage selection
Storage capacity exceeded
Storage rotation
Concurrent reservations
Storage recalculation
```

### Upload

```text
Initialize upload
Complete upload
Abort upload
Large file handling
Failed upload
Retry
```

### Movies

```text
Create movie
Update movie
Delete movie
Process movie
Reprocess movie
Playback URL
```

### Security

```text
Unauthorized admin
Invalid JWT
Forbidden route
Invalid input
Secret leakage prevention
```

---

# 35. Final Deliverables

Generate a complete working backend with:

```text
✓ TypeScript
✓ Express
✓ MongoDB/Mongoose
✓ JWT Admin Auth
✓ Cloudflare R2 S3 integration
✓ Multiple R2 storage accounts
✓ Encrypted R2 credentials
✓ Automatic storage selection
✓ 10 GB configurable storage threshold
✓ Storage reservation/concurrency protection
✓ Large-file multipart upload
✓ Direct-to-R2 upload architecture
✓ FFprobe
✓ FFmpeg
✓ HLS generation
✓ BullMQ/Redis workers
✓ Movie management
✓ Playback API
✓ Storage usage synchronization
✓ Audit logs
✓ Validation
✓ Error handling
✓ Security
✓ Swagger
✓ Docker
✓ Environment configuration
✓ Automated tests
```

Most importantly, the backend must be designed so that **adding R2-02, R2-03, R2-04, etc. from the Admin Dashboard requires no code change or server redeployment**.

The Admin Dashboard should simply add the new R2 configuration, test it, activate it, assign priority, and the Storage Manager should automatically use it when previous storage reaches its configured capacity.
