/**
 * @media-bot/utils
 * 
 * Shared utilities package containing:
 * - Command execution wrapper
 * - File operations
 * - Hashing utilities
 * - Retry logic
 * - Path utilities
 * - Type guards
 */

// Command execution
export { executeCommand, execAsync, execFFmpeg, execMkvmerge, type CommandResult } from './command.js';

// File operations
export {
  ensureDir,
  safeWriteFile,
  safeReadFile,
  calculateFileHash,
  getFileSizeBytes,
  moveFile,
  copyFile,
} from './file.js';

// Retry logic
export { retry, type RetryOptions } from './retry.js';

// Path utilities
export {
  getJobDir,
  sanitizeFilename,
  getExtension,
} from './path.js';

// Type guards
export {
  isString,
  isNumber,
  isObject,
  isNonEmptyString,
  isDefined,
} from './guards.js';

// Time utilities
export {
  sleep,
  formatDuration,
  parseTimecode,
} from './time.js';

// Logger
export { logger, createLogger, type Logger } from './logger.js';
