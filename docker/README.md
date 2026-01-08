# Docker Configuration

This directory contains Docker-related configuration files.

## Structure

- `postgres/` - PostgreSQL configuration and init scripts
- `redis/` - Redis configuration
- `minio/` - MinIO object storage configuration

## Dockerfiles

Application Dockerfiles are in the root of each app:
- `apps/api/Dockerfile`
- `apps/worker/Dockerfile`

## Building

```bash
# Build all images
docker compose build

# Build specific service
docker compose build api
```
