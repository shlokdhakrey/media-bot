/**
 * Worker Configuration
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import { z } from 'zod';

// Load .env from project root
dotenvConfig({ path: resolve(process.cwd(), '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  WORKER_CONCURRENCY: z.string().transform(Number).default('2'),
  WORKER_ID: z.string().default(() => `worker-${process.pid}`),
  
  // Database
  DATABASE_URL: z.string().min(1),
  
  // Redis
  REDIS_URL: z.string().min(1),
  
  // Storage paths
  STORAGE_INCOMING: z.string().default('/data/incoming'),
  STORAGE_WORKING: z.string().default('/data/working'),
  STORAGE_PROCESSED: z.string().default('/data/processed'),
  STORAGE_SAMPLES: z.string().default('/data/samples'),
  STORAGE_FAILED: z.string().default('/data/failed'),
  
  // Media tools
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  MEDIAINFO_PATH: z.string().default('mediainfo'),
  MKVMERGE_PATH: z.string().default('mkvmerge'),
  MKVPROPEDIT_PATH: z.string().default('mkvpropedit'),
  
  // Job settings
  JOB_TIMEOUT_MS: z.string().transform(Number).default('3600000'), // 1 hour
  JOB_STALLED_INTERVAL_MS: z.string().transform(Number).default('30000'), // 30 seconds
  JOB_MAX_STALLED_COUNT: z.string().transform(Number).default('3'),
  
  // Health check
  WORKER_HEALTH_PORT: z.string().transform(Number).default('3002'),
});

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error('❌ Invalid environment configuration:');
  console.error(parseResult.error.format());
  process.exit(1);
}

const env = parseResult.data;

export const config = {
  nodeEnv: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,
  workerConcurrency: env.WORKER_CONCURRENCY,
  workerId: env.WORKER_ID,
  
  database: {
    url: env.DATABASE_URL,
  },
  
  redis: {
    url: env.REDIS_URL,
  },
  
  storage: {
    incoming: env.STORAGE_INCOMING,
    working: env.STORAGE_WORKING,
    processed: env.STORAGE_PROCESSED,
    samples: env.STORAGE_SAMPLES,
    failed: env.STORAGE_FAILED,
  },
  
  mediaTools: {
    ffmpeg: env.FFMPEG_PATH,
    ffprobe: env.FFPROBE_PATH,
    mediainfo: env.MEDIAINFO_PATH,
    mkvmerge: env.MKVMERGE_PATH,
    mkvpropedit: env.MKVPROPEDIT_PATH,
  },
  
  jobs: {
    timeoutMs: env.JOB_TIMEOUT_MS,
    stalledIntervalMs: env.JOB_STALLED_INTERVAL_MS,
    maxStalledCount: env.JOB_MAX_STALLED_COUNT,
  },
  
  healthCheck: {
    port: env.WORKER_HEALTH_PORT,
  },
} as const;
