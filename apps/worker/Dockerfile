# ============================================
# MEDIA-BOT WORKER DOCKERFILE
# ============================================
# Multi-stage build with all required media tools
#
# Includes:
# - FFmpeg (with full codec support)
# - MediaInfo
# - MKVToolNix (mkvmerge, mkvpropedit, mkvextract)
# - Node.js 20 LTS
# ============================================

# Stage 1: Build stage
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json ./packages/config/
COPY packages/database/package.json ./packages/database/
COPY packages/download/package.json ./packages/download/
COPY packages/media/package.json ./packages/media/
COPY packages/processing/package.json ./packages/processing/
COPY packages/sync/package.json ./packages/sync/
COPY packages/utils/package.json ./packages/utils/
COPY packages/validation/package.json ./packages/validation/
COPY apps/worker/package.json ./apps/worker/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma client
RUN pnpm --filter @media-bot/database run generate

# Build all packages
RUN pnpm run build

# Prune dev dependencies
RUN pnpm prune --prod

# ============================================
# Stage 2: Runtime with media tools
# ============================================
FROM node:20-alpine AS runtime

# Install runtime dependencies and media tools
RUN apk add --no-cache \
    # FFmpeg with full codec support
    ffmpeg \
    # MediaInfo
    mediainfo \
    # MKVToolNix
    mkvtoolnix \
    # Additional tools
    curl \
    tini \
    # Font support for subtitles
    fontconfig \
    ttf-dejavu \
    ttf-liberation \
    # Timezone data
    tzdata

# Create non-root user
RUN addgroup -g 1000 mediabot && \
    adduser -u 1000 -G mediabot -s /bin/sh -D mediabot

WORKDIR /app

# Copy built application from builder
COPY --from=builder --chown=mediabot:mediabot /app/node_modules ./node_modules
COPY --from=builder --chown=mediabot:mediabot /app/packages ./packages
COPY --from=builder --chown=mediabot:mediabot /app/apps/worker ./apps/worker
COPY --from=builder --chown=mediabot:mediabot /app/package.json ./

# Create directories
RUN mkdir -p /app/storage /app/logs /app/temp && \
    chown -R mediabot:mediabot /app

# Switch to non-root user
USER mediabot

# Environment variables
ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    MEDIAINFO_PATH=/usr/bin/mediainfo \
    MKVMERGE_PATH=/usr/bin/mkvmerge \
    MKVPROPEDIT_PATH=/usr/bin/mkvpropedit \
    MKVEXTRACT_PATH=/usr/bin/mkvextract \
    HEALTH_CHECK_PORT=3001

# Expose health check port
EXPOSE 3001

# Health check using our health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/live || exit 1

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Start worker
CMD ["node", "apps/worker/dist/index.js"]
