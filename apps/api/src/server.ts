/**
 * Fastify Server Factory
 * 
 * Creates and configures the Fastify instance with all plugins.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import compress from '@fastify/compress';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './plugins/errorHandler.js';
import { authenticate } from './plugins/authenticate.js';

// Routes
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { jobRoutes } from './routes/jobs.js';
import { mediaRoutes } from './routes/media.js';
import { downloadRoutes } from './routes/downloads.js';
import { settingsRoutes } from './routes/settings.js';
import { websocketRoutes } from './routes/websocket.js';

export async function createServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: logger as any,
    trustProxy: config.trustProxy,
    requestTimeout: 30000,
    bodyLimit: 10 * 1024 * 1024, // 10MB
  });

  // ============================================
  // Security plugins
  // ============================================
  
  await server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        scriptSrc: ["'self'"],
      },
    },
  });

  await server.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  // ============================================
  // Rate limiting
  // ============================================
  
  await server.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
    keyGenerator: (request) => {
      // Use API key or IP for rate limiting
      return request.headers['x-api-key'] as string || request.ip;
    },
    errorResponseBuilder: (request, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry in ${Math.ceil(context.ttl / 1000)} seconds`,
      retryAfter: Math.ceil(context.ttl / 1000),
    }),
  });

  // ============================================
  // Performance
  // ============================================
  
  await server.register(compress, {
    encodings: ['gzip', 'deflate'],
  });

  // ============================================
  // Authentication
  // ============================================
  
  await server.register(jwt, {
    secret: config.jwtSecret,
    sign: {
      expiresIn: config.jwtExpiresIn,
    },
  });

  // Custom auth decorator
  await server.register(authenticate);

  // ============================================
  // WebSocket
  // ============================================
  
  await server.register(websocket, {
    options: {
      maxPayload: 1048576, // 1MB
      clientTracking: true,
    },
  });

  // ============================================
  // API Documentation
  // ============================================
  
  if (config.enableSwagger) {
    await server.register(swagger, {
      openapi: {
        info: {
          title: 'Media-Bot API',
          description: 'Production-grade media automation system',
          version: '1.0.0',
        },
        servers: [
          { url: `http://localhost:${config.port}`, description: 'Development' },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
            apiKey: {
              type: 'apiKey',
              name: 'X-API-Key',
              in: 'header',
            },
          },
        },
        security: [{ bearerAuth: [] }, { apiKey: [] }],
      },
    });

    await server.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
    });
  }

  // ============================================
  // Error handling
  // ============================================
  
  await server.register(errorHandler);

  // ============================================
  // Routes
  // ============================================
  
  // Root route - API info
  server.get('/', async () => ({
    name: 'media-bot-api',
    version: '1.0.0',
    status: 'running',
    docs: '/docs',
    health: '/health',
  }));
  
  // Public routes
  await server.register(healthRoutes, { prefix: '/health' });
  await server.register(authRoutes, { prefix: '/api/v1/auth' });
  
  // Protected routes
  await server.register(jobRoutes, { prefix: '/api/v1/jobs' });
  await server.register(mediaRoutes, { prefix: '/api/v1/media' });
  await server.register(downloadRoutes, { prefix: '/api/v1/downloads' });
  await server.register(settingsRoutes, { prefix: '/api/v1/settings' });
  
  // WebSocket routes
  await server.register(websocketRoutes, { prefix: '/ws' });

  return server;
}
