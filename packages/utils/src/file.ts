/**
 * File Operations
 * 
 * Safe file operations with proper error handling.
 */

import { 
  mkdir, 
  writeFile, 
  readFile, 
  stat, 
  rename, 
  copyFile as fsCopyFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/**
 * Safely write a file, ensuring the directory exists
 */
export async function safeWriteFile(
  filePath: string,
  content: string | Buffer
): Promise<void> {
  await ensureDir(dirname(filePath));
  await writeFile(filePath, content, 'utf8');
}

/**
 * Safely read a file, returning null if it doesn't exist
 */
export async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Calculate the hash of a file
 */
export async function calculateFileHash(
  filePath: string,
  algorithm: 'md5' | 'sha1' | 'sha256' = 'sha256'
): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(filePath);
    
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Get file size in bytes
 */
export async function getFileSizeBytes(filePath: string): Promise<number> {
  const stats = await stat(filePath);
  return stats.size;
}

/**
 * Move a file to a new location
 */
export async function moveFile(
  source: string,
  destination: string
): Promise<void> {
  await ensureDir(dirname(destination));
  await rename(source, destination);
}

/**
 * Copy a file to a new location
 */
export async function copyFile(
  source: string,
  destination: string
): Promise<void> {
  await ensureDir(dirname(destination));
  await fsCopyFile(source, destination);
}
