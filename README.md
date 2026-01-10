# Media-Bot

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-18+-green?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Prisma-5.7-2D3748?logo=prisma&logoColor=white" alt="Prisma" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/pnpm-Workspace-F69220?logo=pnpm&logoColor=white" alt="pnpm" />
  <img src="https://img.shields.io/badge/License-Private-red" alt="License" />
</p>

A production-grade media automation system for audio-video synchronization, processing, and distribution. Designed for internal media processing pipelines with support for multi-source acquisition, professional sync analysis, and automated workflow management.

---

**Private Use Only** - This system is designed for internal media processing pipelines. Unauthorized use is prohibited.

---

## Table of Contents

- [Features](#features)
- [Technical Specifications](#technical-specifications)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Telegram Bot Commands](#telegram-bot-commands)
- [CLI Commands](#cli-commands)
- [API Reference](#api-reference)
- [Job State Machine](#job-state-machine)
- [Core Principles](#core-principles)
- [Database Schema](#database-schema)
- [Configuration](#configuration)
- [Development](#development)
- [Binary Configuration](#binary-configuration)
- [Testing](#testing)
- [Monitoring](#monitoring)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### Audio-Video Synchronization Engine

- **FPS Detection** - Automatic detection of 24/25/23.976 fps patterns
- **Tempo Correction** - Precise atempo filtering with filter chain support for factors outside 0.5-2.0 range
- **Delay Adjustment** - Frame-accurate delay compensation using adelay filter
- **Cross-Correlation Analysis** - Professional waveform comparison for precise sync detection
- **Peak/Transient Matching** - Anchor point alignment for structural analysis
- **Audio Fingerprinting** - Source verification to confirm audio track origins
- **Silence Detection** - Boundary detection for segment identification
- **Multi-Segment Analysis** - Drift and cut detection across file duration
- **Confidence Scoring** - Sync quality metrics with professional analysis results
- **Drift Detection** - Progressive offset identification with rate calculation

### Multi-Source Acquisition

- **Google Drive** - Direct API downloads with shared drive support and progress tracking
- **HTTP/HTTPS** - Direct link downloads with resume capability
- **Torrents** - qBittorrent integration (planned)
- **Rclone** - Cloud storage synchronization for multiple providers
- **Aria2** - High-speed download acceleration (planned)
- **Local Files** - Native filesystem support with path resolution

### Media Processing

- **Stream Copy** - Zero quality loss with video never re-encoded
- **MKV Muxing** - MKVMerge integration for professional Matroska output
- **MP4/M4A Support** - AAC encoding for maximum compatibility
- **Opus Encoding** - High-quality audio for MKA/MKV/WebM containers
- **Sample Generation** - Automatic 30-second preview creation
- **Batch Processing** - Queue-based parallel processing with BullMQ
- **Stream Extraction** - Extract specific audio, video, or subtitle tracks
- **Audio Trimming** - Precise start/end time cutting with stream copy

### Control Interfaces

- **Telegram Bot** - Full-featured remote control with Grammy framework
- **CLI Tool** - Scriptable command-line interface for automation
- **REST API** - Programmatic access with authentication (Express/Fastify)
- **Admin Panel** - Web-based job monitoring dashboard

### File Management

- **Organized Storage** - Separate directories for incoming, working, processed, samples, failed, and archived files
- **Progress Tracking** - Real-time download and processing progress
- **Path Resolution** - Automatic resolution of relative paths to working directory
- **File Listing** - Recent output file enumeration with size and age information

---

## Technical Specifications

### Sync Detection Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| Cross-Correlation | Waveform comparison using FFT-based correlation | Precise delay detection |
| Peak Detection | Transient and peak matching across audio tracks | Structural alignment |
| Audio Fingerprinting | Chromaprint-based source verification | Confirming audio origins |
| Silence Detection | Silence region identification and boundary detection | Segment identification |
| Duration Analysis | FPS-based tempo factor calculation | Fallback sync method |

### Correction Types

| Type | Filter | Description |
|------|--------|-------------|
| Delay | `adelay` | Shift audio forward in time (positive ms) |
| Advance | `-ss` | Skip audio from start (negative ms, uses stream copy) |
| Tempo | `atempo` | Change audio speed to match target duration |
| Trim | `-ss -to` | Remove audio from start or end |
| Pad | `adelay` | Add silence to start |

### Audio Codec Selection

| Container | Codec | Bitrate | Notes |
|-----------|-------|---------|-------|
| MP4/M4A/MOV | AAC | 256kbps | Maximum compatibility |
| MKA/MKV/WebM/OGG | Opus | 192kbps | Superior quality at same bitrate |
| Other | Opus | 192kbps | Default fallback |

### Atempo Filter Chaining

The atempo filter has a valid range of 0.5 to 2.0. For factors outside this range, multiple filters are chained:

```
Factor 4.0  -> atempo=2.0,atempo=2.0
Factor 0.25 -> atempo=0.5,atempo=0.5
Factor 2.5  -> atempo=2.0,atempo=1.25
```

### Channel Layout Remapping

The `aformat=channel_layouts=5.1` filter is applied before encoding to remap non-standard layouts (like 5.1(side)) to standard 5.1 for libopus compatibility.

---

## Architecture

```
+---------------------------------------------------------------------------------+
|                                  MEDIA-BOT                                       |
+---------------------------------------------------------------------------------+
|                                                                                  |
|  +-------------+  +-------------+  +-------------+  +-------------+             |
|  |  Telegram   |  |    CLI      |  |    API      |  |   Worker    |             |
|  |    Bot      |  |   (tsx)     |  |  (Express)  |  |  (BullMQ)   |             |
|  +------+------+  +------+------+  +------+------+  +------+------+             |
|         |                |                |                |                     |
|         +----------------+--------+-------+----------------+                     |
|                                   v                                              |
|  +--------------------------------------------------------------------------+   |
|  |                          SHARED PACKAGES                                  |   |
|  +--------------------------------------------------------------------------+   |
|  |  @media-bot/core         | State machine, Prisma ORM, job management      |   |
|  |  @media-bot/acquisition  | Download clients (GDrive, HTTP, aria2)         |   |
|  |  @media-bot/media        | FFprobe, MediaInfo analysis                    |   |
|  |  @media-bot/sync         | FPS detection, tempo, delay engine             |   |
|  |  @media-bot/processing   | FFmpeg operations, muxing, presets             |   |
|  |  @media-bot/validation   | Sample generation, hash verification           |   |
|  |  @media-bot/packaging    | File organization and manifests                |   |
|  |  @media-bot/upload       | MinIO, GDrive via rclone                       |   |
|  |  @media-bot/utils        | Command execution, retry, file operations      |   |
|  +--------------------------------------------------------------------------+   |
|                                   |                                              |
|                                   v                                              |
|  +--------------------------------------------------------------------------+   |
|  |                          INFRASTRUCTURE                                   |   |
|  +--------------------------------------------------------------------------+   |
|  |  PostgreSQL  | Primary database (Prisma ORM)                              |   |
|  |  Redis       | Job queues (BullMQ), caching                               |   |
|  |  MinIO       | S3-compatible object storage                               |   |
|  |  FFmpeg      | Media processing engine                                    |   |
|  |  MKVMerge    | Matroska muxing toolkit                                    |   |
|  +--------------------------------------------------------------------------+   |
|                                                                                  |
+---------------------------------------------------------------------------------+
```

---

## Project Structure

```
media-bot/
├── apps/                           # Application entry points
│   ├── api/                        # REST API server (Express + Fastify)
│   │   ├── src/
│   │   │   ├── routes/             # API route handlers
│   │   │   ├── middleware/         # Authentication, validation
│   │   │   ├── plugins/            # Fastify plugins
│   │   │   └── config/             # API configuration
│   │   └── Dockerfile
│   ├── cli/                        # Command-line interface
│   │   └── src/
│   │       ├── commands/           # CLI command implementations
│   │       ├── config/             # CLI configuration
│   │       └── lib/                # CLI utilities
│   ├── telegram-bot/               # Telegram bot (Grammy)
│   │   └── src/
│   │       ├── commands/           # Bot command handlers
│   │       │   ├── index.ts        # Main command registration
│   │       │   └── process.ts      # All-in-one pipeline command
│   │       └── config.ts           # Bot configuration
│   ├── worker/                     # Background job processor (BullMQ)
│   │   ├── src/
│   │   │   ├── processors/         # Job processors by type
│   │   │   ├── config/             # Worker configuration
│   │   │   └── lib/                # Worker utilities
│   │   └── Dockerfile
│   └── admin-panel/                # Web admin interface
│
├── packages/                       # Shared packages (pnpm workspace)
│   ├── core/                       # Business logic, state machine, Prisma
│   │   ├── src/
│   │   │   ├── db/                 # Database utilities
│   │   │   ├── services/           # Core services
│   │   │   ├── types/              # TypeScript types
│   │   │   ├── errors/             # Error definitions
│   │   │   ├── config/             # Configuration management
│   │   │   ├── stateMachine.ts     # Job state machine
│   │   │   └── logger.ts           # Pino logger configuration
│   │   └── binaries/               # Platform-specific binaries
│   │       ├── darwin/             # macOS binaries
│   │       ├── linux/              # Linux binaries
│   │       └── windows/            # Windows binaries
│   ├── acquisition/                # Download management
│   │   └── src/
│   │       ├── clients/            # Download client implementations
│   │       ├── detection.ts        # Link type detection
│   │       ├── progress.ts         # Progress tracking
│   │       └── router.ts           # Download routing
│   ├── media/                      # Media analysis (FFprobe, MediaInfo)
│   │   └── src/
│   │       ├── analyzer.ts         # Media file analyzer
│   │       ├── probes/             # Probe implementations
│   │       └── types.ts            # Media types
│   ├── sync/                       # Audio-video sync engine
│   │   └── src/
│   │       ├── detection/          # Detection algorithms
│   │       │   ├── crossCorrelation.ts  # Waveform comparison
│   │       │   ├── peakDetector.ts      # Peak/transient matching
│   │       │   ├── fingerprint.ts       # Audio fingerprinting
│   │       │   ├── silence.ts           # Silence detection
│   │       │   ├── anchor.ts            # Anchor point detection
│   │       │   └── syncAnalyzer.ts      # Combined analysis
│   │       ├── decisionEngine.ts   # Sync decision making
│   │       ├── correctionPlanner.ts # Correction planning
│   │       ├── watcher/            # File system watchers
│   │       └── types.ts            # Sync types
│   ├── processing/                 # FFmpeg operations
│   │   └── src/
│   │       ├── ffmpeg.ts           # FFmpeg wrapper
│   │       ├── muxer.ts            # Muxing operations
│   │       ├── commandBuilder.ts   # FFmpeg command builder
│   │       ├── presets.ts          # Encoding presets
│   │       ├── jobExecutor.ts      # Job execution
│   │       ├── progressParser.ts   # Progress parsing
│   │       └── packaging/          # Packaging utilities
│   ├── validation/                 # Output validation and hashing
│   ├── packaging/                  # File organization
│   ├── upload/                     # Upload targets
│   │   └── src/
│   │       └── targets/            # Upload target implementations
│   └── utils/                      # Shared utilities
│       └── src/
│           ├── command.ts          # Command execution
│           └── file.ts             # File operations
│
├── prisma/                         # Database schema and migrations
│   ├── schema.prisma               # Prisma schema definition
│   └── migrations/                 # Migration history
│
├── docker/                         # Docker configurations
│   ├── postgres/                   # PostgreSQL init scripts
│   │   └── init.sql
│   ├── redis/                      # Redis configuration
│   │   └── redis.conf
│   └── minio/                      # MinIO configuration
│
├── storage/                        # Local file storage
│   ├── incoming/                   # Downloaded files
│   ├── working/                    # Processing workspace
│   ├── processed/                  # Completed files
│   ├── samples/                    # Validation samples
│   ├── failed/                     # Failed job artifacts
│   └── archive/                    # Archived files
│
├── logs/                           # Application logs
│   ├── app/                        # Application logs
│   ├── ffmpeg/                     # FFmpeg execution logs
│   └── jobs/                       # Job-specific logs
│
├── scripts/                        # Utility scripts
│   ├── cleanup.ts                  # Storage cleanup
│   ├── db-health.ts                # Database health check
│   └── seed.ts                     # Database seeding
│
├── docker-compose.yml              # Full stack deployment
├── turbo.json                      # Turborepo configuration
├── pnpm-workspace.yaml             # pnpm workspace definition
├── tsconfig.json                   # TypeScript base config
└── package.json                    # Root package configuration
```

---

## Quick Start

### Prerequisites

| Tool | Version | Required | Notes |
|------|---------|----------|-------|
| Node.js | 18+ | Yes | Runtime environment |
| pnpm | 8+ | Yes | Package manager |
| Docker | 20+ | Yes | Container runtime |
| FFmpeg | 5+ | Yes | Media processing |
| MKVMerge | 70+ | Yes | Matroska muxing |
| MediaInfo | Latest | No | Enhanced media analysis |

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/media-bot.git
cd media-bot

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env

# Start infrastructure services
pnpm docker:infra

# Generate Prisma client
pnpm db:generate

# Push database schema
pnpm db:push

# Build all packages
pnpm build
```

### Running Services

```bash
# Development mode (with hot reload)
pnpm dev

# Start Telegram bot
pnpm --filter @media-bot/telegram-bot start

# Start API server
pnpm --filter @media-bot/api start

# Start worker
pnpm --filter @media-bot/worker start
```

### Docker Deployment

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

---

## Telegram Bot Commands

### All-In-One Pipeline

| Command | Description |
|---------|-------------|
| `/process "video_link" "audio_link"` | Full pipeline: download, sync analysis, mux, and sample generation. Supports Google Drive, HTTP, and local paths. |

### Download Commands

| Command | Description |
|---------|-------------|
| `/download <url>` | Start a download job. Supports magnet links, HTTP URLs, NZB URLs. |
| `/gdrive <link>` | Download from Google Drive using API with progress tracking. |
| `/jobs [status]` | List all jobs, optionally filtered by status. |
| `/status <id>` | Get detailed status of a specific job. |
| `/cancel <id>` | Cancel a pending or running job. |
| `/retry <id>` | Retry a failed job. |

### Analysis Commands

| Command | Description |
|---------|-------------|
| `/analyze <path>` | Analyze media file showing duration, size, video/audio streams, and subtitles. |
| `/sync "video" "audio" [title] [--deep]` | Professional sync analysis using waveform comparison. Quick mode (default) analyzes first 5 minutes. Deep mode (--deep) analyzes entire file. |
| `/releases` | List recent media assets from database. |

### Audio Sync Commands

| Command | Description |
|---------|-------------|
| `/delay <ms> "input" "output"` | Add delay to audio. Positive values delay audio (starts later), negative values advance audio (starts earlier). |
| `/fps <source> <target> "input" "output"` | Convert audio between frame rates using tempo adjustment. Common: 24->23.976, 25->23.976, 25->24. |
| `/tempo <factor> "input" "output"` | Apply tempo adjustment. Factor > 1.0 = faster/shorter, Factor < 1.0 = slower/longer. |
| `/trim <start> <end> "input" "output"` | Trim audio to specified time range. Supports HH:MM:SS.mmm or seconds. |
| `/synclocal "audio" "video" <delay_ms>` | Local file sync pipeline for files already on disk. Analyzes, converts FPS, and applies delay. |

### Muxing Commands

| Command | Description |
|---------|-------------|
| `/mux "video" "audio" "output" [title]` | Mux video and audio into single file. Uses mkvmerge for MKV, ffmpeg for others. |
| `/extract "input" <stream> "output"` | Extract specific stream. Specifiers: a:0 (first audio), a:1 (second audio), s:0 (first subtitle), v:0 (video). |

### File Management Commands

| Command | Description |
|---------|-------------|
| `/files` | List recent output files in working directory with size and age. |
| `/dir` | Show output directory path and status. |

### System Commands

| Command | Description |
|---------|-------------|
| `/start` | Display welcome message and command overview. |
| `/help [topic]` | Show command help. Topics: process, sync, delay, fps, tempo, trim, mux, extract, gdrive, analyze. |
| `/health` | System health check including database connectivity. |
| `/stats` | Processing statistics: total jobs, active, completed, failed, media assets. |
| `/binaries` | Show binary configuration and paths. |
| `/config` | Display current bot configuration including storage paths and API status. |

### Command Usage Examples

**Full Processing Pipeline:**
```
/process "https://drive.google.com/file/d/abc123/view" "https://drive.google.com/file/d/xyz789/view"
/process "C:\Videos\Movie.mkv" "C:\Audio\Hindi.mka"
```

**Sync Analysis:**
```
/sync "Movie.mkv" "Hindi.mka" "Hindi DD+ 5.1"
/sync "English.mp3" "Hindi.mp3" --deep
```

**Audio Corrections:**
```
/delay 500 "audio.mka" "delayed.mka"
/delay -200 "audio.mp4" "fixed.mka"
/fps 25 23.976 "audio.mka" "synced.mka"
/tempo 1.04271 "audio.mka" "adjusted.mka"
/trim 0 01:30:00 "audio.mka" "trimmed.mka"
```

**Muxing:**
```
/mux "Movie.mkv" "Hindi.mka" "Movie.Hindi.mkv" "Hindi DD+ 5.1"
/extract "Movie.mkv" "a:1" "Hindi.mka"
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `analyze <file>` | Analyze media file |
| `auth` | Authentication management |
| `cancel <id>` | Cancel a job |
| `config` | Configuration management |
| `download <url>` | Start download |
| `health` | System health check |
| `help` | Display help |
| `jobs` | List jobs |
| `logs` | View logs |
| `releases` | List releases |
| `retry <id>` | Retry failed job |
| `start` | Start services |
| `stats` | Display statistics |
| `status <id>` | Job status |

---

## API Reference

### Health Check
```
GET /health
```
Returns system health status including database connectivity.

### Jobs
```
GET /jobs              # List all jobs
GET /jobs/:id          # Get job details
POST /jobs             # Create new job
DELETE /jobs/:id       # Cancel job
POST /jobs/:id/retry   # Retry failed job
```

### Media Assets
```
GET /assets            # List media assets
GET /assets/:id        # Get asset details
```

### Downloads
```
POST /downloads        # Start download
GET /downloads/:id     # Get download status
```

---

## Job State Machine

```
+---------+    +-------------+    +-----------+    +---------+    +------------+
| PENDING |---→| DOWNLOADING |---→| ANALYZING |---→| SYNCING |---→| PROCESSING |
+---------+    +-------------+    +-----------+    +---------+    +------------+
                                                                        |
+------+    +----------+    +----------+    +------------+              |
| DONE |←---| UPLOADED |←---| PACKAGED |←---| VALIDATING |←-------------+
+------+    +----------+    +----------+    +------------+
                                                   |
                              +--------+           |
                              | FAILED |←----------+ (any state can fail)
                              +--------+

                              +-----------+
                              | CANCELLED |  (can be set from any non-terminal state)
                              +-----------+
```

**State Guarantees:**
- Every state transition is validated by the state machine
- All transitions are logged to the audit trail
- Complete job history is recorded in the database
- Failed jobs are reversible for retry operations
- Cancelled jobs preserve their last state for debugging

---

## Core Principles

### 1. Never Re-encode Video

Video streams are always copied using `-c:v copy`. Audio corrections use tempo and delay filters exclusively. This preserves original quality and significantly reduces processing time.

### 2. Everything is Logged

- Every command execution is recorded
- Every state transition is audited
- Every sync decision includes a paper trail
- Structured JSON logs using Pino
- FFmpeg commands logged with full arguments

### 3. No Hardcoded Credentials

- All secrets use environment variables
- `.env.example` provides required configuration template
- Docker Compose uses environment variables with development defaults
- API keys and tokens never committed to repository

### 4. Smart Sync Detection

- Duration difference is not the primary sync metric
- Same FPS does not guarantee sync
- FPS pattern matching (24/25/23.976) with ratio calculation
- Tempo factor calculation with confidence scoring
- Frame-accurate delay compensation using waveform analysis
- Multi-point verification is required for complex cases

### 5. Graceful Degradation

- Professional sync analysis falls back to duration-based method on failure
- Binary detection tries environment variables, package binaries, then system PATH
- Network failures trigger retry with exponential backoff
- Partial results are preserved on interruption

---

## Database Schema

| Model | Description | Key Fields |
|-------|-------------|------------|
| `User` | User accounts | `id`, `username`, `telegramId`, `role`, `apiKey` |
| `Job` | Core workflow unit | `id`, `state`, `type`, `source`, `progress`, `options`, `error`, `retryCount` |
| `MediaAsset` | Media files | `id`, `fileName`, `path`, `type`, `fileSize`, `metadata` |
| `Download` | Download tracking | `id`, `url`, `fileName`, `progress`, `status`, `speed`, `eta` |
| `SyncDecision` | Sync analysis results | `tempoFactor`, `delayMs`, `confidence`, `method`, `warnings` |
| `ProcessingStep` | Processing records | `name`, `startedAt`, `completedAt`, `duration`, `command` |
| `AuditLog` | Audit trail | `action`, `entityType`, `entityId`, `changes`, `userId`, `timestamp` |

---

## Configuration

### Environment Variables

```bash
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/mediabot"

# Redis
REDIS_URL="redis://localhost:6379"

# Storage Paths
STORAGE_INCOMING="/path/to/incoming"
STORAGE_WORKING="/path/to/working"
STORAGE_PROCESSED="/path/to/processed"
STORAGE_SAMPLES="/path/to/samples"
STORAGE_FAILED="/path/to/failed"
STORAGE_ARCHIVE="/path/to/archive"

# Telegram Bot
TELEGRAM_BOT_TOKEN="your-bot-token"
TELEGRAM_ADMIN_ID="your-telegram-id"
TELEGRAM_ALLOWED_GROUPS="group_id_1,group_id_2"
TELEGRAM_ALLOW_PRIVATE="true"

# Google Drive API
GDRIVE_API_KEY="your-api-key"

# MinIO (S3-compatible)
MINIO_ENDPOINT="localhost"
MINIO_PORT="9000"
MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin"
MINIO_USE_SSL="false"

# Binary Paths (optional - auto-detected)
FFMPEG_PATH="/usr/bin/ffmpeg"
FFPROBE_PATH="/usr/bin/ffprobe"
MKVMERGE_PATH="/usr/bin/mkvmerge"
MKVEXTRACT_PATH="/usr/bin/mkvextract"
MEDIAINFO_PATH="/usr/bin/mediainfo"

# API Configuration
API_URL="http://localhost:3000"
API_PORT="3000"

# Logging
LOG_LEVEL="info"
NODE_ENV="development"
```

See `.env.example` for complete configuration reference.

---

## Development

### Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages |
| `pnpm dev` | Start development mode with hot reload |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run tests |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm clean` | Clean all build artifacts |

### Database Commands

| Command | Description |
|---------|-------------|
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:push` | Push schema changes to database |
| `pnpm db:migrate` | Create new migration |
| `pnpm db:migrate:deploy` | Deploy pending migrations |
| `pnpm db:reset` | Reset database (destructive) |
| `pnpm db:seed` | Seed database with sample data |
| `pnpm db:studio` | Open Prisma Studio GUI |

### Docker Commands

| Command | Description |
|---------|-------------|
| `pnpm docker:up` | Start all containers |
| `pnpm docker:down` | Stop all containers |
| `pnpm docker:logs` | View container logs |
| `pnpm docker:infra` | Start infrastructure only (PostgreSQL, Redis, MinIO) |

---

## Package Dependencies

```
telegram-bot ──┬──→ core
               ├──→ acquisition
               ├──→ media
               └──→ utils

api ───────────┬──→ core
               ├──→ acquisition
               └──→ media

worker ────────┬──→ core
               ├──→ acquisition
               ├──→ media
               ├──→ processing
               ├──→ sync
               ├──→ validation
               ├──→ packaging
               └──→ upload

processing ────────→ utils
sync ──────────┬──→ media
               └──→ utils
acquisition ───────→ utils
media ─────────────→ utils
validation ────────→ media
packaging ─────────→ utils
upload ────────────→ utils
core ──────────────→ utils
```

---

## Binary Configuration

Media-Bot supports multiple methods for configuring external binaries:

### Priority Order

1. **Environment Variables** - `FFMPEG_PATH`, `MKVMERGE_PATH`, etc.
2. **Package Binaries** - `packages/core/binaries/{os}/`
3. **System PATH** - Falls back to system-installed binaries

### Usage

```typescript
import { binaries, getBinaryFolders } from '@media-bot/core';

const config = binaries();
// { 
//   ffmpeg: { resolvedPath: '/usr/bin/ffmpeg', isAvailable: true },
//   mkvmerge: { resolvedPath: '/usr/bin/mkvmerge', isAvailable: true },
//   ...
// }

const folders = getBinaryFolders();
// { os: 'windows', path: 'packages/core/binaries/windows' }
```

### Supported Binaries

| Binary | Environment Variable | Required |
|--------|---------------------|----------|
| ffmpeg | `FFMPEG_PATH` | Yes |
| ffprobe | `FFPROBE_PATH` | Yes |
| mkvmerge | `MKVMERGE_PATH` | Yes |
| mkvextract | `MKVEXTRACT_PATH` | No |
| mediainfo | `MEDIAINFO_PATH` | No |

---

## Testing

```bash
# Run all tests
pnpm test

# Run tests for specific package
pnpm --filter @media-bot/sync test

# Run tests with coverage
pnpm test -- --coverage

# Watch mode
pnpm test -- --watch
```

---

## Monitoring

### Logs

- **Location:** `logs/` directory
- **Format:** JSON (Pino)
- **Levels:** `trace`, `debug`, `info`, `warn`, `error`, `fatal`
- **Categories:** `app/`, `ffmpeg/`, `jobs/`

### Health Checks

| Interface | Endpoint/Command |
|-----------|------------------|
| API | `GET /health` |
| Telegram | `/health` command |
| Docker | Built-in healthchecks in docker-compose.yml |

### Metrics (Planned)

- Prometheus metrics endpoint
- Grafana dashboards
- Job processing statistics
- Download speed tracking
- Error rate monitoring

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing`
5. Open a Pull Request

### Code Style

- TypeScript strict mode enabled
- ESLint + Prettier for formatting
- Conventional commits required
- Comprehensive JSDoc comments
- All exports must be typed

---

## License

**Private - Internal Use Only**

This software is proprietary and confidential. Unauthorized copying, distribution, or use is strictly prohibited.
