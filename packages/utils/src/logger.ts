/**
 * Logger
 * 
 * Pino-based structured logger for all packages.
 * Provides consistent logging across the monorepo.
 */

import { pino } from 'pino';

const LOG_LEVEL = process.env['LOG_LEVEL'] ?? 'info';
const NODE_ENV = process.env['NODE_ENV'] ?? 'development';

export const logger = pino({
  level: LOG_LEVEL,
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'media-bot',
    env: NODE_ENV,
  },
  transport: NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
    },
  } : undefined,
});

export type Logger = typeof logger;

/**
 * Create a child logger with additional context
 */
export function createLogger(context: Record<string, unknown>): Logger {
  return logger.child(context);
}
