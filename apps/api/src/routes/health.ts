/**
 * Health Routes
 * 
 * Health check and readiness probes.
 */

import type { FastifyPluginAsync } from 'fastify';
import Redis, { type Redis as RedisClient } from 'ioredis';
import { config } from '../config/index.js';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: string;
  checks: {
    database: CheckResult;
    redis: CheckResult;
  };
}

interface CheckResult {
  status: 'pass' | 'fail';
  latencyMs?: number;
  error?: string;
}

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // Basic liveness probe (fast, always returns 200 if running)
  fastify.get('/', {
    schema: {
      description: 'Basic liveness check',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  // Detailed readiness probe (checks dependencies)
  fastify.get('/ready', {
    schema: {
      description: 'Readiness check with dependency status',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            version: { type: 'string' },
            uptime: { type: 'number' },
            timestamp: { type: 'string' },
            checks: {
              type: 'object',
              properties: {
                database: { type: 'object' },
                redis: { type: 'object' },
              },
            },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const checks: HealthStatus['checks'] = {
      database: await checkDatabase(),
      redis: await checkRedis(),
    };

    const allPassing = Object.values(checks).every(c => c.status === 'pass');
    const anyPassing = Object.values(checks).some(c => c.status === 'pass');

    const status: HealthStatus = {
      status: allPassing ? 'healthy' : anyPassing ? 'degraded' : 'unhealthy',
      version: process.env['npm_package_version'] || '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    };

    const statusCode = allPassing ? 200 : anyPassing ? 200 : 503;
    return reply.status(statusCode).send(status);
  });

  // Simple live check for k8s
  fastify.get('/live', {
    schema: {
      description: 'Kubernetes liveness probe',
      tags: ['Health'],
    },
  }, async (_request, reply) => {
    return reply.status(200).send({ status: 'live' });
  });
};

async function checkDatabase(): Promise<CheckResult> {
  const start = Date.now();
  try {
    // Import Prisma client
    const { prisma } = await import('@media-bot/core');
    await prisma.$queryRaw`SELECT 1`;
    
    return {
      status: 'pass',
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      status: 'fail',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const start = Date.now();
  let redis: RedisClient | null = null;
  
  try {
    const RedisClient = Redis.default || Redis;
    redis = new RedisClient(config.redis.url, {
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
    });
    
    await redis.ping();
    
    return {
      status: 'pass',
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      status: 'fail',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    if (redis) {
      redis.disconnect();
    }
  }
}
