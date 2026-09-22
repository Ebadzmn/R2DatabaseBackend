# Production-Grade Movie Streaming Backend

A complete, production-ready backend for a movie and TV-series streaming platform built with **Node.js, TypeScript, Express, MongoDB/Mongoose, Cloudflare R2 (`@aws-sdk/client-s3`), FFmpeg/FFprobe, Redis + BullMQ, JWT, and Swagger**.

---

## Key Features

1. **Zero-Downtime Dynamic Multi-R2 Storage**:
   - Add new Cloudflare R2 storage accounts (`R2-01`, `R2-02`, `R2-03`, etc.) on the fly via Admin API/Dashboard.
   - Requires **no code changes or server restarts**.
   - Test R2 credentials and bucket permissions before persisting.
   - AES-256-GCM authenticated encryption for all R2 credentials. Secret keys are never returned in responses or logged.

2. **Automatic Storage Rotation & Concurrency-Safe Reservations**:
   - Automatically selects storage accounts ordered by priority that satisfy the configured storage threshold (default: 10 GB limit).
   - Prevents race conditions with atomic MongoDB reservation updates so concurrent uploads never exceed the configured limit.
   - Recalculates actual storage usage directly from Cloudflare R2 bucket objects on demand.

3. **Direct-to-R2 Multipart Uploads**:
   - Presigned S3 multipart uploads bypass the backend server entirely, eliminating memory and bandwidth bottlenecks for 2–10+ GB files.
   - Full lifecycle management: initialization, batch presigned part URLs, completion, and abort with automatic storage reservation release.

4. **Background Video Processing & Multi-Rendition HLS (BullMQ + FFmpeg/FFprobe)**:
   - Automated media probing with FFprobe to extract codecs, duration, bitrate, and resolution.
   - Generates adaptive HLS renditions (1080p, 720p, 480p) with 6-second segment durations and a master playlist `master.m3u8`.
   - Automatically uploads HLS segments and playlists to Cloudflare R2 and marks the movie `READY`.

5. **Flutter Mobile & Web Client Playback API**:
   - Public playback endpoints (`/api/movies/:id/playback`) returning CDN/streaming URLs formatted with `STREAMING_BASE_URL`.
   - Never exposes R2 bucket secrets, storage credentials, or internal server tokens.

6. **Comprehensive Security & Operations**:
   - JWT authentication for Admin APIs with auto-seeded initial admin account.
   - Centralized error handling and structured logging with sensitive field redaction.
   - Comprehensive audit logging (`AuditLog`) for all administrative actions.
   - Interactive Swagger documentation at `/api/docs`.
   - Production Dockerfile and `docker-compose.yml` orchestrating API, background worker, MongoDB, and Redis.

---

## Architecture Overview

```text
src/
├── config/
│   ├── env.ts              # Zod-validated environment config
│   ├── database.ts         # Mongoose connection
│   ├── redis.ts            # Redis connection for BullMQ
│   └── swagger.ts          # OpenAPI 3.0 specification
├── services/
│   ├── encryption.service.ts      # AES-256-GCM credential encryption
│   ├── storage-manager.service.ts # Concurrency-safe capacity selection & reservations
│   └── media-metadata.service.ts  # FFprobe stream inspection
├── modules/
│   ├── auth/               # Admin authentication (JWT + bcrypt)
│   ├── storage/            # Dynamic Cloudflare R2 accounts, client factory, & sync
│   ├── upload/             # Direct-to-R2 presigned multipart uploads
│   ├── movies/             # Movie management & public playback APIs
│   ├── processing/         # FFmpeg HLS conversion & BullMQ queues
│   └── audit/              # Audit logging for admin actions
├── middleware/
│   ├── auth.middleware.ts
│   ├── error.middleware.ts
│   ├── rate-limit.middleware.ts
│   └── validation.middleware.ts
├── workers/
│   ├── index.ts                   # Background worker runner
│   ├── video-processing.worker.ts # FFmpeg HLS transcode worker
│   ├── storage-sync.worker.ts     # R2 usage recalculation worker
│   └── movie-delete.worker.ts     # R2 asset deletion worker
├── utils/
│   ├── logger.ts           # Pino structured logger with redaction
│   ├── errors.ts           # Standard AppError classes and error codes
│   ├── response.ts         # Standard API responses
│   └── slugify.ts          # Slug generation
├── app.ts                  # Express application setup
└── server.ts               # HTTP server bootstrap & graceful shutdown
```

---

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- MongoDB
- Redis (for BullMQ queues)
- FFmpeg & FFprobe (or use Docker / pre-installed binaries)

### 1. Environment Setup

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Key environment settings:
```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/movie_streaming_db
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=your_strong_jwt_secret_key
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
STREAMING_BASE_URL=http://localhost:5000/stream
INITIAL_ADMIN_EMAIL=admin@movieplatform.com
INITIAL_ADMIN_PASSWORD=AdminSecurePassword123!
```

### 2. Development

Start API server:
```bash
npm run dev
```

Start background worker:
```bash
npm run worker
```

### 3. Running Tests

```bash
npm test
```

### 4. Docker Deployment

Launch all services (API, worker, MongoDB, and Redis) with Docker Compose:

```bash
docker-compose up --build -d
```

---

## API Reference & Interactive Swagger

Visit **`http://localhost:5000/api/docs`** for the complete Swagger UI documentation.

### Admin Authentication
- `POST /api/admin/auth/login`: Admin login (returns JWT token)
- `POST /api/admin/auth/logout`: Admin logout
- `GET /api/admin/auth/me`: Current admin profile

### Storage Management
- `GET /api/admin/storage`: List storage accounts with free capacity & usage %
- `POST /api/admin/storage`: Add new R2 account (credentials encrypted in DB)
- `POST /api/admin/storage/test`: Test R2 credentials & bucket access without saving
- `GET /api/admin/storage/:id`: Get storage account details
- `PATCH /api/admin/storage/:id`: Update storage account
- `DELETE /api/admin/storage/:id`: Delete empty storage account
- `POST /api/admin/storage/:id/recalculate`: Query R2 bucket and synchronize actual usage
- `POST /api/admin/storage/:id/activate`: Activate storage account
- `POST /api/admin/storage/:id/deactivate`: Deactivate storage account

### Uploads (Direct-to-R2 Multipart)
- `POST /api/admin/uploads/init`: Selects & reserves storage, initiates R2 multipart upload, returns presigned part URLs
- `GET /api/admin/uploads/:id/part-urls`: Fetch additional batch of presigned part URLs
- `POST /api/admin/uploads/:id/complete`: Complete multipart upload and dispatch BullMQ video processing job
- `POST /api/admin/uploads/:id/abort`: Cancel upload and release reserved storage
- `GET /api/admin/uploads/:id`: Query upload status and progress

### Movies
- `GET /api/admin/movies`: List movies with search, filter (status, genre, year), sort, and pagination
- `POST /api/admin/movies`: Create movie record
- `GET /api/admin/movies/:id`: Get movie details
- `PATCH /api/admin/movies/:id`: Update movie
- `DELETE /api/admin/movies/:id`: Delete movie and clean up R2 HLS segments and source video in the background
- `POST /api/admin/movies/:id/process`: Trigger video processing
- `POST /api/admin/movies/:id/reprocess`: Re-trigger video processing
- `GET /api/admin/movies/:id/status`: Check processing progress and metadata

### Public / Flutter Endpoints
- `GET /api/movies`: Public movie catalog with search & genre filtering
- `GET /api/movies/:id`: Public movie details
- `GET /api/movies/:id/playback`: Get HLS streaming URL (`master.m3u8`) formatted with `STREAMING_BASE_URL`
