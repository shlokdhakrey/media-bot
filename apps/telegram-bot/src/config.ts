/**
 * Telegram Bot Configuration
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = resolve(__dirname, '../../..');
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
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_GROUPS: z.string().optional(), // Comma-separated list of group IDs
  TELEGRAM_ADMIN_ID: z.string().optional(), // Optional admin ID for privileged commands
  TELEGRAM_ALLOW_PRIVATE: z.string().transform(v => v === 'true').default('true'), // Allow private chats
  
  // Database
  DATABASE_URL: z.string().min(1),
  
  // Redis
  REDIS_URL: z.string().min(1),
  
  // API URL for internal calls
  API_URL: z.string().url().default('http://localhost:3000'),
  
  // Storage paths (relative to monorepo root)
  STORAGE_WORKING: z.string().default('./storage/working'),
  STORAGE_PROCESSED: z.string().default('./storage/processed'),
  STORAGE_SAMPLES: z.string().default('./storage/samples'),
  
  // Google Drive API
  GDRIVE_API_KEY: z.string().default(''),
  
  // Binary paths
  ARIA2C_PATH: z.string().default('aria2c'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
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
  logLevel: env.LOG_LEVEL,
  
  botToken: env.TELEGRAM_BOT_TOKEN,
  allowedGroups: env.TELEGRAM_ALLOWED_GROUPS?.split(',').map(id => id.trim()).filter(Boolean) ?? [],
  adminId: env.TELEGRAM_ADMIN_ID,
  allowPrivate: env.TELEGRAM_ALLOW_PRIVATE,
  
  database: {
    url: env.DATABASE_URL,
  },
  
  redis: {
    url: env.REDIS_URL,
  },
  
  apiUrl: env.API_URL,
  
  storage: {
    working: resolvePath(env.STORAGE_WORKING),
    processed: resolvePath(env.STORAGE_PROCESSED),
    samples: resolvePath(env.STORAGE_SAMPLES),
  },
  
  gdrive: {
    apiKey: env.GDRIVE_API_KEY,
  },
  
  binaries: {
    aria2c: env.ARIA2C_PATH,
    ffmpeg: env.FFMPEG_PATH,
    ffprobe: env.FFPROBE_PATH,
  },
} as const;
