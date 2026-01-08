# ============================================
# MEDIA-BOT API DOCKERFILE
# ============================================
# Multi-stage build for the API server
#
# Includes:
# - FFmpeg (for on-the-fly transcoding/previews)
# - MediaInfo (for metadata API)
# - Node.js 20 LTS with Fastify
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
COPY apps/api/package.json ./apps/api/

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
# Stage 2: Runtime
# ============================================
FROM node:20-alpine AS runtime

# Install runtime dependencies
RUN apk add --no-cache \
    # FFmpeg for preview generation
    ffmpeg \
    # MediaInfo for metadata API
    mediainfo \
    # Additional tools
    curl \
    tini \
    tzdata

# Create non-root user
RUN addgroup -g 1000 mediabot && \
    adduser -u 1000 -G mediabot -s /bin/sh -D mediabot

WORKDIR /app

# Copy built application from builder
COPY --from=builder --chown=mediabot:mediabot /app/node_modules ./node_modules
COPY --from=builder --chown=mediabot:mediabot /app/packages ./packages
COPY --from=builder --chown=mediabot:mediabot /app/apps/api ./apps/api
COPY --from=builder --chown=mediabot:mediabot /app/package.json ./

# Create directories
RUN mkdir -p /app/storage /app/logs && \
    chown -R mediabot:mediabot /app

# Switch to non-root user
USER mediabot

# Environment variables
ENV NODE_ENV=production \
    API_PORT=3000 \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    MEDIAINFO_PATH=/usr/bin/mediainfo

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Start API server
CMD ["node", "apps/api/dist/index.js"]
