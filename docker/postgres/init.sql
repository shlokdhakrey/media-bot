-- PostgreSQL Initialization Script
-- This runs on first container startup

-- Create the main database (if not exists from env)
-- The database is created automatically from POSTGRES_DB env var

-- Enable useful extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Grant permissions (adjust as needed)
-- GRANT ALL PRIVILEGES ON DATABASE media_bot TO media_bot_user;

-- Note: Prisma migrations handle schema creation
-- This file is for PostgreSQL-level setup only
