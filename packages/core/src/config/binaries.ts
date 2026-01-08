/**
 * Binary Configuration
 * 
 * Centralized configuration for all external binary paths.
 * Supports both Windows and Linux binaries with automatic OS detection.
 * 
 * Priority order:
 * 1. Environment variables (e.g., FFMPEG_PATH)
 * 2. Custom binary folder (packages/core/binaries/)
 * 3. System PATH
 */

import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Binary folder location - relative to packages/core/
const BINARY_ROOT = resolve(__dirname, '../../binaries');

/**
 * OS-specific subfolder
 */
function getOsFolder(): string {
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'linux':
      return 'linux';
    case 'darwin':
      return 'macos';
    default:
      return 'linux';
  }
}

/**
 * Get executable extension for current OS
 */
function getExeExt(): string {
  return process.platform === 'win32' ? '.exe' : '';
}

/**
 * Binary configuration interface
 */
export interface BinaryConfig {
  name: string;
  envVar: string;
  defaultPath: string;
  resolvedPath: string;
  isAvailable: boolean;
}

/**
 * All supported binaries
 */
export interface BinariesConfig {
  ffmpeg: BinaryConfig;
  ffprobe: BinaryConfig;
  mkvmerge: BinaryConfig;
  mkvextract: BinaryConfig;
  mediainfo: BinaryConfig;
  rclone: BinaryConfig;
  aria2c: BinaryConfig;
  alass: BinaryConfig;
  subsync: BinaryConfig;
}

/**
 * Resolve binary path with priority:
 * 1. Environment variable
 * 2. Custom binary folder
 * 3. System default
 */
function resolveBinaryPath(
  name: string,
  envVar: string,
  systemDefault: string
): BinaryConfig {
  const exeName = name + getExeExt();
  
  // 1. Check environment variable
  const envPath = process.env[envVar];
  if (envPath && existsSync(envPath)) {
    return {
      name,
      envVar,
      defaultPath: systemDefault,
      resolvedPath: envPath,
      isAvailable: true,
    };
  }
  
  // 2. Check custom binary folder
  const customPath = join(BINARY_ROOT, getOsFolder(), exeName);
  if (existsSync(customPath)) {
    return {
      name,
      envVar,
      defaultPath: systemDefault,
      resolvedPath: customPath,
      isAvailable: true,
    };
  }
  
  // 3. Use system default (check if exists)
  const defaultPath = process.platform === 'win32' ? `${systemDefault}.exe` : systemDefault;
  
  // For system PATH binaries, we can't easily check existence
  // Just return the name and let it fail at runtime if not found
  return {
    name,
    envVar,
    defaultPath: systemDefault,
    resolvedPath: name, // Use simple name, let system PATH resolve
    isAvailable: true, // Assume available, will fail at runtime if not
  };
}

/**
 * Get all binary configurations
 */
export function getBinariesConfig(): BinariesConfig {
  return {
    ffmpeg: resolveBinaryPath('ffmpeg', 'FFMPEG_PATH', '/usr/bin/ffmpeg'),
    ffprobe: resolveBinaryPath('ffprobe', 'FFPROBE_PATH', '/usr/bin/ffprobe'),
    mkvmerge: resolveBinaryPath('mkvmerge', 'MKVMERGE_PATH', '/usr/bin/mkvmerge'),
    mkvextract: resolveBinaryPath('mkvextract', 'MKVEXTRACT_PATH', '/usr/bin/mkvextract'),
    mediainfo: resolveBinaryPath('mediainfo', 'MEDIAINFO_PATH', '/usr/bin/mediainfo'),
    rclone: resolveBinaryPath('rclone', 'RCLONE_PATH', '/usr/bin/rclone'),
    aria2c: resolveBinaryPath('aria2c', 'ARIA2C_PATH', '/usr/bin/aria2c'),
    alass: resolveBinaryPath('alass', 'ALASS_PATH', '/usr/bin/alass'),
    subsync: resolveBinaryPath('subsync', 'SUBSYNC_PATH', '/usr/bin/subsync'),
  };
}

// Singleton instance
let _binaries: BinariesConfig | null = null;

/**
 * Get binary configurations (cached)
 */
export function binaries(): BinariesConfig {
  if (!_binaries) {
    _binaries = getBinariesConfig();
  }
  return _binaries;
}

/**
 * Get a specific binary path
 */
export function getBinaryPath(name: keyof BinariesConfig): string {
  return binaries()[name].resolvedPath;
}

/**
 * Check if a binary is available
 */
export async function isBinaryAvailable(name: keyof BinariesConfig): Promise<boolean> {
  const { spawn } = await import('node:child_process');
  const binaryPath = getBinaryPath(name);
  
  return new Promise((resolve) => {
    try {
      const proc = spawn(binaryPath, ['--version'], {
        stdio: 'ignore',
        timeout: 5000,
      });
      
      proc.on('close', (code) => {
        resolve(code === 0);
      });
      
      proc.on('error', () => {
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Get binary folder paths for user reference
 */
export function getBinaryFolders(): { root: string; os: string } {
  return {
    root: BINARY_ROOT,
    os: join(BINARY_ROOT, getOsFolder()),
  };
}

/**
 * Log all binary configurations
 */
export function logBinaryConfig(): void {
  const config = binaries();
  console.log('Binary Configuration:');
  console.log('=====================');
  console.log(`Binary Root: ${BINARY_ROOT}`);
  console.log(`OS Folder: ${getOsFolder()}`);
  console.log('');
  
  for (const [key, value] of Object.entries(config)) {
    console.log(`${key}:`);
    console.log(`  Path: ${value.resolvedPath}`);
    console.log(`  Env: ${value.envVar}`);
    console.log(`  Available: ${value.isAvailable}`);
  }
}
