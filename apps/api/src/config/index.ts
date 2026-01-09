/**
 * API Configuration
 * 
 * All configuration loaded from environment variables.
 * Uses sensible defaults for development.
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

// Get monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = resolve(__dirname, '../../../..');

// Load .env from monorepo root
dotenvConfig({ path: resolve(monorepoRoot, '.env') });

// Helper to resolve relative paths from monorepo root
function resolvePath(p: string): string {
  if (p.startsWith('./') || p.startsWith('../')) {
    return resolve(monorepoRoot, p);
  }
  return p;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.string().transform(Number).default('3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TRUST_PROXY: z.string().transform(v => v === 'true').default('true'),
  
  // Database
  DATABASE_URL: z.string().default('postgresql://media_bot:media_bot_password@localhost:5432/media_bot'),
  
  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  
  // Security
  JWT_SECRET: z.string().min(32).default('change-this-to-a-secure-secret-key-32chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  API_SECRET_KEY: z.string().min(32).default('default-api-key-for-development-32ch'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),
  
  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('60000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),
  
  // External services
  QBITTORRENT_URL: z.string().optional(),
  ARIA2_RPC_URL: z.string().optional(),
  NZBGET_URL: z.string().optional(),
  
  // Paths (relative to monorepo root)
  STORAGE_PATH: z.string().default('./storage'),
  LOGS_PATH: z.string().default('./logs'),
  TEMP_PATH: z.string().default('./storage/temp'),
  
  // Binary paths
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  MEDIAINFO_PATH: z.string().default('mediainfo'),
  MKVMERGE_PATH: z.string().default('mkvmerge'),
  
  // Features
  ENABLE_SWAGGER: z.string().transform(v => v !== 'false').default('true'),
  ENABLE_METRICS: z.string().transform(v => v !== 'false').default('true'),
  
  // Admin
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().default('changeme'),
});

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error('Invalid environment configuration:');
  console.error(parseResult.error.format());
  process.exit(1);
}

const env = parseResult.data;

export const config = {
  nodeEnv: env.NODE_ENV,
  host: env.API_HOST,
  port: env.API_PORT,
  logLevel: env.LOG_LEVEL,
  trustProxy: env.TRUST_PROXY,
  
  database: {
    url: env.DATABASE_URL,
  },
  
  redis: {
    url: env.REDIS_URL,
  },
  
  // JWT
  jwtSecret: env.JWT_SECRET,
  jwtExpiresIn: env.JWT_EXPIRES_IN,
  
  // Security
  apiSecretKey: env.API_SECRET_KEY,
  corsOrigins: env.CORS_ORIGINS.split(',').map((s: string) => s.trim()),
  
  // Rate limiting
  rateLimitMax: env.RATE_LIMIT_MAX_REQUESTS,
  rateLimitWindow: `${env.RATE_LIMIT_WINDOW_MS} milliseconds`,
  
  // External services
  qbittorrentUrl: env.QBITTORRENT_URL,
  aria2RpcUrl: env.ARIA2_RPC_URL,
  nzbgetUrl: env.NZBGET_URL,
  
  // Paths
  storagePath: resolvePath(env.STORAGE_PATH),
  logsPath: resolvePath(env.LOGS_PATH),
  tempPath: resolvePath(env.TEMP_PATH),
  
  // Binaries
  ffmpegPath: env.FFMPEG_PATH,
  ffprobePath: env.FFPROBE_PATH,
  mediainfoPath: env.MEDIAINFO_PATH,
  mkvmergePath: env.MKVMERGE_PATH,
  
  // Features
  enableSwagger: env.ENABLE_SWAGGER,
  enableMetrics: env.ENABLE_METRICS,
  
  // Admin
  adminUsername: env.ADMIN_USERNAME,
  adminPassword: env.ADMIN_PASSWORD,
} as const;

export type Config = typeof config;
