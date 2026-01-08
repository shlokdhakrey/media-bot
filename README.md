<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-18+-green?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Prisma-5.7-2D3748?logo=prisma&logoColor=white" alt="Prisma" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/pnpm-Workspace-F69220?logo=pnpm&logoColor=white" alt="pnpm" />
  <img src="https://img.shields.io/badge/License-Private-red" alt="License" />
</p>

<h1 align="center">🎬 Media-Bot</h1>

<p align="center">
  <strong>A production-grade media automation system for audio-video synchronization, processing, and distribution.</strong>
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-documentation">Documentation</a> •
  <a href="#-api-reference">API Reference</a>
</p>

---

> ⚠️ **Private Use Only** — This system is designed for internal media processing pipelines. Unauthorized use is prohibited.

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🔄 Audio-Video Sync Engine
- **FPS Detection** — Automatic 24/25/23.976 detection
- **Tempo Correction** — Precise atempo filtering with chain support
- **Delay Adjustment** — Frame-accurate delay compensation
- **Confidence Scoring** — Sync quality metrics

</td>
<td width="50%">

### 📥 Multi-Source Acquisition
- **Google Drive** — Direct API downloads with shared drive support
- **HTTP/HTTPS** — Direct link downloads with resume support
- **Torrents** — qBittorrent integration (coming soon)
- **Rclone** — Cloud storage sync

</td>
</tr>
<tr>
<td>

### 🎛️ Media Processing
- **Stream Copy** — Zero quality loss, video never re-encoded
- **MKV Muxing** — MKVMerge for professional output
- **Sample Generation** — Automatic 30s preview creation
- **Batch Processing** — Queue-based parallel processing

</td>
<td>

### 🤖 Control Interfaces
- **Telegram Bot** — Full-featured remote control
- **CLI Tool** — Scriptable command-line interface
- **REST API** — Programmatic access with authentication
- **Admin Panel** — Web-based job monitoring

</td>
</tr>
</table>

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                  MEDIA-BOT                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │  Telegram   │  │    CLI      │  │    API      │  │   Worker    │            │
│  │    Bot      │  │   (tsx)     │  │  (Express)  │  │  (BullMQ)   │            │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘            │
│         │                │                │                │                    │
│         └────────────────┴────────┬───────┴────────────────┘                    │
│                                   ▼                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │                          SHARED PACKAGES                                  │  │
│  ├──────────────────────────────────────────────────────────────────────────┤  │
│  │  @media-bot/core         │ State machine, Prisma, job management         │  │
│  │  @media-bot/acquisition  │ Download clients (GDrive, HTTP, aria2)        │  │
│  │  @media-bot/media        │ FFprobe, MediaInfo analysis                   │  │
│  │  @media-bot/sync         │ FPS detection, tempo, delay engine            │  │
│  │  @media-bot/processing   │ FFmpeg operations, muxing                     │  │
│  │  @media-bot/validation   │ Sample generation, hash verification          │  │
│  │  @media-bot/packaging    │ File organization & manifests                 │  │
│  │  @media-bot/upload       │ MinIO, GDrive via rclone                      │  │
│  │  @media-bot/utils        │ Command execution, retry, file ops            │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                   │                                              │
│                                   ▼                                              │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │                          INFRASTRUCTURE                                   │  │
│  ├──────────────────────────────────────────────────────────────────────────┤  │
│  │  PostgreSQL  │ Primary database (Prisma ORM)                             │  │
│  │  Redis       │ Job queues (BullMQ), caching                              │  │
│  │  MinIO       │ S3-compatible object storage                              │  │
│  │  FFmpeg      │ Media processing engine                                   │  │
│  │  MKVMerge    │ Matroska muxing toolkit                                   │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
media-bot/
├── apps/                           # Application entry points
│   ├── api/                        # REST API server (Express + Fastify)
│   ├── cli/                        # Command-line interface
│   ├── telegram-bot/               # Telegram bot (Grammy)
│   ├── worker/                     # Background job processor (BullMQ)
│   └── admin-panel/                # Web admin interface
│
├── packages/                       # Shared packages (pnpm workspace)
│   ├── core/                       # Business logic, state machine, Prisma
│   ├── acquisition/                # Download management
│   ├── media/                      # Media analysis (FFprobe, MediaInfo)
│   ├── sync/                       # Audio-video sync engine
│   ├── processing/                 # FFmpeg operations
│   ├── validation/                 # Output validation & hashing
│   ├── packaging/                  # File organization
│   ├── upload/                     # Upload targets
│   └── utils/                      # Shared utilities
│
├── prisma/                         # Database schema & migrations
│   ├── schema.prisma               # Prisma schema definition
│   └── migrations/                 # Migration history
│
├── docker/                         # Docker configurations
│   ├── postgres/                   # PostgreSQL init scripts
│   ├── redis/                      # Redis configuration
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
├── scripts/                        # Utility scripts
├── docker-compose.yml              # Full stack deployment
├── turbo.json                      # Turborepo configuration
├── pnpm-workspace.yaml             # pnpm workspace definition
└── tsconfig.json                   # TypeScript base config
```

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Required |
|------|---------|----------|
| **Node.js** | 18+ | ✅ |
| **pnpm** | 8+ | ✅ |
| **Docker** | 20+ | ✅ |
| **FFmpeg** | 5+ | ✅ |
| **MKVMerge** | 70+ | ✅ |
| **MediaInfo** | Latest | Optional |

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

## 🔄 Job State Machine

The core of Media-Bot is a robust state machine that ensures reliable job processing:

```
┌─────────┐    ┌─────────────┐    ┌───────────┐    ┌─────────┐    ┌────────────┐
│ PENDING │───▶│ DOWNLOADING │───▶│ ANALYZING │───▶│ SYNCING │───▶│ PROCESSING │
└─────────┘    └─────────────┘    └───────────┘    └─────────┘    └────────────┘
                                                                         │
┌──────┐    ┌──────────┐    ┌──────────┐    ┌────────────┐              │
│ DONE │◀───│ UPLOADED │◀───│ PACKAGED │◀───│ VALIDATING │◀─────────────┘
└──────┘    └──────────┘    └──────────┘    └────────────┘
                                                   │
                              ┌────────┐           │
                              │ FAILED │◀──────────┘ (any state can fail)
                              └────────┘
```

**Every state transition is:**
- ✅ Validated by the state machine
- ✅ Logged to the audit trail
- ✅ Recorded in job history
- ✅ Reversible for retry operations

---

## 🎯 Core Principles

### 1. 🎬 Never Re-encode Video
```
Video streams are ALWAYS copied (-c:v copy)
Audio corrections use tempo/delay, never video modification
Preserves original quality, saves processing time
```

### 2. 📝 Everything is Logged
```
Every command execution → recorded
Every state transition → audited
Every decision → paper trail
Structured JSON logs (Pino)
```

### 3. 🔐 No Hardcoded Credentials
```
All secrets → environment variables
.env.example → required configuration template
Docker Compose → env vars with dev defaults
```

### 4. 🎵 Smart Sync Detection
```
Duration difference ≠ Sync metric
FPS pattern matching (24/25/23.976)
Tempo factor calculation with confidence
Frame-accurate delay compensation
```

---

## 🤖 Telegram Bot Commands

### All-in-One Pipeline
```
/process "video_link" "audio_link"  - Full download→sync→mux→sample pipeline
```

### Downloads
```
/download <url>      - Start a download job
/gdrive <link>       - Download from Google Drive
/jobs                - List all jobs
/status <id>         - Get job status
/cancel <id>         - Cancel a job
/retry <id>          - Retry failed job
```

### Media Operations
```
/analyze <path>      - Analyze media file
/sync <v> <a>        - Sync analysis only
/delay <ms> <i> <o>  - Add delay to audio
/fps <s> <t> <i> <o> - FPS conversion
/tempo <f> <i> <o>   - Tempo adjustment
/mux <v> <a> <o>     - Mux video + audio
/trim <s> <e> <i> <o> - Trim audio
/sample <i> <o>      - Generate sample
```

### System
```
/health              - System health check
/stats               - Processing statistics
/binaries            - Show binary paths
/config              - Show configuration
/files               - List output files
/help [topic]        - Show help
```

---

## 📊 Database Schema

| Model | Description | Key Fields |
|-------|-------------|------------|
| `User` | User accounts | `id`, `role`, `apiKey` |
| `Job` | Core workflow unit | `id`, `state`, `type`, `metadata` |
| `MediaAsset` | Media files | `id`, `path`, `type`, `metadata` |
| `Download` | Download tracking | `id`, `url`, `progress`, `status` |
| `SyncDecision` | Sync analysis | `tempoFactor`, `delayMs`, `confidence` |
| `ProcessingStep` | Step records | `name`, `startedAt`, `completedAt` |
| `AuditLog` | Audit trail | `action`, `entityType`, `changes` |

---

## ⚙️ Configuration

### Environment Variables

```bash
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/mediabot"

# Redis
REDIS_URL="redis://localhost:6379"

# Storage
STORAGE_INCOMING="/path/to/incoming"
STORAGE_WORKING="/path/to/working"
STORAGE_PROCESSED="/path/to/processed"
STORAGE_SAMPLES="/path/to/samples"

# Telegram Bot
TELEGRAM_BOT_TOKEN="your-bot-token"
TELEGRAM_ADMIN_ID="your-telegram-id"

# Google Drive API
GDRIVE_API_KEY="your-api-key"

# MinIO (S3-compatible)
MINIO_ENDPOINT="localhost"
MINIO_PORT="9000"
MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin"

# Binary paths (optional - auto-detected)
FFMPEG_PATH="/usr/bin/ffmpeg"
FFPROBE_PATH="/usr/bin/ffprobe"
MKVMERGE_PATH="/usr/bin/mkvmerge"
```

See [.env.example](.env.example) for complete configuration reference.

---

## 🛠️ Development

### Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages |
| `pnpm dev` | Start development mode |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run tests |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm clean` | Clean all build artifacts |

### Database

| Command | Description |
|---------|-------------|
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:push` | Push schema changes |
| `pnpm db:migrate` | Create migration |
| `pnpm db:migrate:deploy` | Deploy migrations |
| `pnpm db:reset` | Reset database |
| `pnpm db:seed` | Seed database |
| `pnpm db:studio` | Open Prisma Studio |

### Docker

| Command | Description |
|---------|-------------|
| `pnpm docker:up` | Start all containers |
| `pnpm docker:down` | Stop all containers |
| `pnpm docker:logs` | View container logs |
| `pnpm docker:infra` | Start infrastructure only |

---

## 📦 Package Dependencies

```mermaid
graph TD
    A[telegram-bot] --> B[core]
    A --> C[acquisition]
    A --> D[media]
    A --> E[utils]
    
    F[api] --> B
    F --> C
    F --> D
    
    G[worker] --> B
    G --> C
    G --> D
    G --> H[processing]
    G --> I[sync]
    G --> J[validation]
    G --> K[packaging]
    G --> L[upload]
    
    H --> E
    I --> D
    I --> E
    C --> E
    D --> E
    J --> D
    K --> E
    L --> E
    
    B --> E
```

---

## 🔧 Binary Configuration

Media-Bot supports multiple ways to configure external binaries:

1. **Environment Variables** — `FFMPEG_PATH`, `MKVMERGE_PATH`, etc.
2. **Package Binaries** — `packages/core/binaries/{os}/`
3. **System PATH** — Falls back to system-installed binaries

```typescript
// Priority: ENV > Package Binaries > System PATH
import { getBinariesConfig } from '@media-bot/core';

const binaries = getBinariesConfig();
// { ffmpeg: '/path/to/ffmpeg', mkvmerge: '/path/to/mkvmerge', ... }
```

---

## 🧪 Testing

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

## 📈 Monitoring

### Logs
- **Location:** `logs/` directory
- **Format:** JSON (Pino)
- **Levels:** `trace`, `debug`, `info`, `warn`, `error`, `fatal`

### Health Checks
- **API:** `GET /health`
- **Telegram:** `/health` command
- **Docker:** Built-in healthchecks

### Metrics (Coming Soon)
- Prometheus metrics endpoint
- Grafana dashboards
- Job processing statistics

---

## 🤝 Contributing

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing`)
3. **Commit** changes (`git commit -m 'Add amazing feature'`)
4. **Push** to branch (`git push origin feature/amazing`)
5. **Open** a Pull Request

### Code Style
- TypeScript strict mode
- ESLint + Prettier
- Conventional commits
- Comprehensive JSDoc comments

---

## 📄 License

**Private — Internal Use Only**

This software is proprietary and confidential.
Unauthorized copying, distribution, or use is strictly prohibited.

---

<p align="center">
  <sub>Built with ❤️ using TypeScript, FFmpeg, and too much caffeine.</sub>
</p>
