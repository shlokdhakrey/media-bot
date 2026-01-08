/**
 * Telegram Bot Configuration
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_GROUP_CHAT_ID: z.string().optional(),
  TELEGRAM_ADMIN_ID: z.string().min(1),
  
  // Database
  DATABASE_URL: z.string().min(1),
  
  // Redis
  REDIS_URL: z.string().min(1),
  
  // API URL for internal calls
  API_URL: z.string().url().default('http://localhost:3000'),
  
  // Storage paths
  STORAGE_WORKING: z.string().default('C:\\Users\\shlok\\Downloads\\MediaBot'),
  STORAGE_PROCESSED: z.string().default('C:\\Users\\shlok\\Downloads\\MediaBot\\processed'),
  STORAGE_SAMPLES: z.string().default('C:\\Users\\shlok\\Downloads\\MediaBot\\samples'),
  
  // Google Drive API
  GDRIVE_API_KEY: z.string().default(''),
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
  
  botToken: env.TELEGRAM_BOT_TOKEN,
  groupChatId: env.TELEGRAM_GROUP_CHAT_ID,
  adminId: env.TELEGRAM_ADMIN_ID,
  
  database: {
    url: env.DATABASE_URL,
  },
  
  redis: {
    url: env.REDIS_URL,
  },
  
  apiUrl: env.API_URL,
  
  storage: {
    working: env.STORAGE_WORKING,
    processed: env.STORAGE_PROCESSED,
    samples: env.STORAGE_SAMPLES,
  },
  
  gdrive: {
    apiKey: env.GDRIVE_API_KEY,
  },
} as const;
