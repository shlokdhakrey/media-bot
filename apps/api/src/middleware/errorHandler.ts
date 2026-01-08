/**
 * Global Error Handler Middleware
 * 
 * Catches all errors and returns consistent JSON responses.
 * Logs errors with full context for debugging.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
}

export const errorHandler = (
  err: ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const statusCode = err.statusCode ?? 500;
  const code = err.code ?? 'INTERNAL_ERROR';
  
  // Log error with context
  logger.error({
    err,
    request: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
    },
  }, 'Request error');

  // Send response
  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message: err.message,
      // Only include stack in development
      ...(config.nodeEnv === 'development' ? { stack: err.stack } : {}),
      ...(err.details !== undefined ? { details: err.details } : {}),
    },
  });
};
