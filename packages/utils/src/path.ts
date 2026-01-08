/**
 * Path Utilities
 */

import { join, extname, basename } from 'node:path';

/**
 * Get the directory path for a job's files
 */
export function getJobDir(
  storageRoot: string,
  stage: 'incoming' | 'working' | 'processed' | 'samples' | 'failed',
  jobId: string
): string {
  return join(storageRoot, stage, jobId);
}

/**
 * Sanitize a filename to be safe for filesystem
 */
export function sanitizeFilename(filename: string): string {
  return filename
    // Remove null bytes
    .replace(/\0/g, '')
    // Replace Windows reserved characters
    .replace(/[<>:"/\\|?*]/g, '_')
    // Replace control characters
    .replace(/[\x00-\x1f\x80-\x9f]/g, '')
    // Trim whitespace and dots
    .trim()
    .replace(/^\.+|\.+$/g, '')
    // Limit length (preserve extension)
    .substring(0, 200);
}

/**
 * Get file extension (lowercase, without dot)
 */
export function getExtension(filename: string): string {
  const ext = extname(filename);
  return ext.toLowerCase().replace(/^\./, '');
}

/**
 * Get base filename without extension
 */
export function getBasename(filename: string): string {
  const ext = extname(filename);
  return basename(filename, ext);
}
