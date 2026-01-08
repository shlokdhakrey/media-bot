/**
 * Worker Health Check Server
 * 
 * Simple HTTP server for Kubernetes probes
 * and monitoring integrations.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../config/index.js';
import { logger } from './logger.js';
import { getQueueStats, QUEUE_NAMES } from './queue.js';
import { getPrisma } from './database.js';
import { Redis } from 'ioredis';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  workerId: string;
  timestamp: string;
  checks: {
    redis: CheckResult;
    database: CheckResult;
    queue: QueueStatus;
  };
}

interface CheckResult {
  status: 'pass' | 'fail';
  latencyMs?: number;
  error?: string;
}

interface QueueStatus {
  status: 'pass' | 'fail';
  waiting: number;
  active: number;
  failed: number;
}

let startTime = Date.now();
let isShuttingDown = false;

/**
 * Create and start the health check server
 */
export function startHealthServer(): { close: () => Promise<void> } {
  startTime = Date.now();
  
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${config.healthCheck.port}`);
    
    try {
      switch (url.pathname) {
        case '/health':
        case '/':
          await handleHealth(res);
          break;
        case '/ready':
          await handleReady(res);
          break;
        case '/live':
          handleLive(res);
          break;
        case '/metrics':
          await handleMetrics(res);
          break;
        default:
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not Found' }));
      }
    } catch (error) {
      logger.error({ error, path: url.pathname }, 'Health check error');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  });

  server.listen(config.healthCheck.port, () => {
    logger.info({ port: config.healthCheck.port }, 'Health check server started');
  });

  return {
    close: () => new Promise((resolve, reject) => {
      isShuttingDown = true;
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    }),
  };
}

/**
 * Full health check with all dependencies
 */
async function handleHealth(res: ServerResponse): Promise<void> {
  const [redisCheck, dbCheck, queueStatus] = await Promise.all([
    checkRedis(),
    checkDatabase(),
    checkQueue(),
  ]);

  const allPassed = 
    redisCheck.status === 'pass' && 
    dbCheck.status === 'pass' && 
    queueStatus.status === 'pass';

  const status: HealthStatus = {
    status: allPassed ? 'healthy' : 'degraded',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    workerId: config.workerId,
    timestamp: new Date().toISOString(),
    checks: {
      redis: redisCheck,
      database: dbCheck,
      queue: queueStatus,
    },
  };

  res.writeHead(allPassed ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(status, null, 2));
}

/**
 * Readiness probe - can we accept jobs?
 */
async function handleReady(res: ServerResponse): Promise<void> {
  if (isShuttingDown) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready: false, reason: 'shutting_down' }));
    return;
  }

  const [redisCheck, dbCheck] = await Promise.all([
    checkRedis(),
    checkDatabase(),
  ]);

  const ready = redisCheck.status === 'pass' && dbCheck.status === 'pass';

  res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ready }));
}

/**
 * Liveness probe - is the process alive?
 */
function handleLive(res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    alive: true,
    uptime: Math.floor((Date.now() - startTime) / 1000),
  }));
}

/**
 * Prometheus-style metrics
 */
async function handleMetrics(res: ServerResponse): Promise<void> {
  const queueStats = await getQueueStats(QUEUE_NAMES.MAIN);
  const uptime = Math.floor((Date.now() - startTime) / 1000);

  const metrics = `
# HELP worker_uptime_seconds Worker uptime in seconds
# TYPE worker_uptime_seconds gauge
worker_uptime_seconds{worker_id="${config.workerId}"} ${uptime}

# HELP worker_jobs_waiting Number of jobs waiting in queue
# TYPE worker_jobs_waiting gauge
worker_jobs_waiting{queue="main"} ${queueStats.waiting}

# HELP worker_jobs_active Number of jobs currently being processed
# TYPE worker_jobs_active gauge
worker_jobs_active{queue="main"} ${queueStats.active}

# HELP worker_jobs_completed_total Total number of completed jobs
# TYPE worker_jobs_completed_total counter
worker_jobs_completed_total{queue="main"} ${queueStats.completed}

# HELP worker_jobs_failed_total Total number of failed jobs
# TYPE worker_jobs_failed_total counter
worker_jobs_failed_total{queue="main"} ${queueStats.failed}

# HELP worker_jobs_delayed Number of delayed jobs
# TYPE worker_jobs_delayed gauge
worker_jobs_delayed{queue="main"} ${queueStats.delayed}

# HELP nodejs_heap_used_bytes Node.js heap used
# TYPE nodejs_heap_used_bytes gauge
nodejs_heap_used_bytes ${process.memoryUsage().heapUsed}

# HELP nodejs_heap_total_bytes Node.js heap total
# TYPE nodejs_heap_total_bytes gauge
nodejs_heap_total_bytes ${process.memoryUsage().heapTotal}

# HELP nodejs_external_bytes Node.js external memory
# TYPE nodejs_external_bytes gauge
nodejs_external_bytes ${process.memoryUsage().external}
`.trim();

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(metrics);
}

/**
 * Check Redis connectivity
 */
async function checkRedis(): Promise<CheckResult> {
  const start = Date.now();
  let redis: Redis | null = null;
  
  try {
    redis = new Redis(config.redis.url, {
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

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<CheckResult> {
  const start = Date.now();
  
  try {
    const prisma = getPrisma();
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

/**
 * Check queue status
 */
async function checkQueue(): Promise<QueueStatus> {
  try {
    const stats = await getQueueStats(QUEUE_NAMES.MAIN);
    
    return {
      status: 'pass',
      waiting: stats.waiting,
      active: stats.active,
      failed: stats.failed,
    };
  } catch (error) {
    return {
      status: 'fail',
      waiting: 0,
      active: 0,
      failed: 0,
    };
  }
}

/**
 * Mark worker as shutting down
 */
export function setShuttingDown(): void {
  isShuttingDown = true;
}
