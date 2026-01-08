/**
 * Error Handler Plugin
 * 
 * Global error handling for Fastify.
 */

import type { FastifyPluginAsync, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  code?: string;
  details?: unknown;
}

const errorHandlerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const { log } = request;

    // Zod validation errors
    if (error instanceof ZodError) {
      const apiError: ApiError = {
        statusCode: 400,
        error: 'Validation Error',
        message: 'Request validation failed',
        details: error.errors.map(e => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      };
      
      log.warn({ err: error }, 'Validation error');
      return reply.status(400).send(apiError);
    }

    // Fastify validation errors
    if (error.validation) {
      const apiError: ApiError = {
        statusCode: 400,
        error: 'Validation Error',
        message: 'Request validation failed',
        details: error.validation,
      };
      
      log.warn({ err: error }, 'Validation error');
      return reply.status(400).send(apiError);
    }

    // JWT errors
    if (error.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER' || 
        error.code === 'FST_JWT_AUTHORIZATION_TOKEN_INVALID') {
      const apiError: ApiError = {
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or missing authentication token',
        code: error.code,
      };
      
      log.warn({ err: error }, 'Authentication error');
      return reply.status(401).send(apiError);
    }

    // Rate limit errors
    if (error.statusCode === 429) {
      return reply.status(429).send({
        statusCode: 429,
        error: 'Too Many Requests',
        message: error.message,
      });
    }

    // Known HTTP errors
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      const apiError: ApiError = {
        statusCode: error.statusCode,
        error: error.name || 'Bad Request',
        message: error.message,
        code: error.code,
      };
      
      log.warn({ err: error }, 'Client error');
      return reply.status(error.statusCode).send(apiError);
    }

    // Internal server errors
    log.error({ err: error }, 'Internal server error');
    
    const apiError: ApiError = {
      statusCode: 500,
      error: 'Internal Server Error',
      message: process.env['NODE_ENV'] === 'production' 
        ? 'An unexpected error occurred' 
        : error.message,
    };

    return reply.status(500).send(apiError);
  });

  // Handle 404
  fastify.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const apiError: ApiError = {
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
    };
    
    return reply.status(404).send(apiError);
  });
};

export const errorHandler = fp(errorHandlerPlugin, {
  name: 'error-handler',
});
