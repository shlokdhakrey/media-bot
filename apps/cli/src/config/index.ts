/**
 * CLI Configuration
 */

import { z } from 'zod';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// Config file location
const CONFIG_DIR = join(homedir(), '.media-bot');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const TOKEN_FILE = join(CONFIG_DIR, 'token.json');

// Environment schema
const envSchema = z.object({
  MEDIA_BOT_API_URL: z.string().url().optional(),
  MEDIA_BOT_API_KEY: z.string().optional(),
  MEDIA_BOT_DEBUG: z.string().optional(),
});

// Config file schema
const configFileSchema = z.object({
  apiUrl: z.string().url().default('http://localhost:3000'),
  apiKey: z.string().optional(),
  timeout: z.number().min(0).default(30000),
  defaultPriority: z.number().min(1).max(10).default(5),
  outputFormat: z.enum(['table', 'json', 'pretty']).default('pretty'),
});

// Token file schema
const tokenFileSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
});

type ConfigFile = z.infer<typeof configFileSchema>;
type TokenFile = z.infer<typeof tokenFileSchema>;

// Load config from file
function loadConfigFile(): Partial<ConfigFile> {
  try {
    if (existsSync(CONFIG_FILE)) {
      const content = readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Ignore errors, use defaults
  }
  return {};
}

// Load tokens from file
function loadTokenFile(): TokenFile | null {
  try {
    if (existsSync(TOKEN_FILE)) {
      const content = readFileSync(TOKEN_FILE, 'utf-8');
      const parsed = tokenFileSchema.safeParse(JSON.parse(content));
      if (parsed.success) {
        return parsed.data;
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

// Save config to file
export function saveConfig(updates: Partial<ConfigFile>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const current = loadConfigFile();
  const merged = { ...current, ...updates };
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}

// Save tokens to file
export function saveTokens(tokens: TokenFile): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

// Clear tokens
export function clearTokens(): void {
  try {
    if (existsSync(TOKEN_FILE)) {
      writeFileSync(TOKEN_FILE, '{}');
    }
  } catch {
    // Ignore
  }
}

// Get token if valid
export function getValidToken(): string | null {
  const tokens = loadTokenFile();
  if (!tokens) return null;
  
  // Check if expired (with 60s buffer)
  if (Date.now() > tokens.expiresAt - 60000) {
    return null;
  }
  
  return tokens.accessToken;
}

// Get refresh token
export function getRefreshToken(): string | null {
  const tokens = loadTokenFile();
  return tokens?.refreshToken ?? null;
}

// Parse environment and file config
const env = envSchema.parse(process.env);
const fileConfig = loadConfigFile();
const parsedConfig = configFileSchema.parse(fileConfig);

export const config = {
  apiUrl: env.MEDIA_BOT_API_URL ?? parsedConfig.apiUrl,
  apiKey: env.MEDIA_BOT_API_KEY ?? parsedConfig.apiKey,
  timeout: parsedConfig.timeout,
  defaultPriority: parsedConfig.defaultPriority,
  outputFormat: parsedConfig.outputFormat,
  debug: env.MEDIA_BOT_DEBUG === 'true',
  configDir: CONFIG_DIR,
  configFile: CONFIG_FILE,
} as const;

export type { ConfigFile, TokenFile };
