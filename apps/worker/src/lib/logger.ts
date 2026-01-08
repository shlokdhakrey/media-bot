/**
 * Worker Logger
 */

import { pino } from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.logLevel,
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'media-bot-worker',
    env: config.nodeEnv,
  },
});
