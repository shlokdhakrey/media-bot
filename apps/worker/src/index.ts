/**
 * Worker Entry Point
 * 
 * This is the background job processor that:
 * - Consumes jobs from Redis queues (BullMQ)
 * - Executes the full media pipeline
 * - Updates job state in PostgreSQL
 * - Handles retries and failures gracefully
 * 
 * Architecture:
 * - Each job type has a dedicated processor
 * - State machine enforces valid transitions
 * - All external commands wrapped with timeout/retry logic
 * - Every action logged to audit trail
 */

import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { jobProcessor, type JobData, type JobResult } from './processors/jobProcessor.js';
import { getQueue, closeAllQueues, QUEUE_NAMES } from './lib/queue.js';
import { closePrisma } from './lib/database.js';
import { startHealthServer, setShuttingDown } from './lib/health.js';

// Track shutdown state
let isShuttingDown = false;

// Redis connection for BullMQ worker
const redisConnection: Redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
  retryStrategy: (times: number) => {
    if (isShuttingDown) return null;
    if (times > 10) {
      logger.error({ times }, 'Redis connection failed after max retries');
      return null;
    }
    return Math.min(times * 100, 3000);
  },
});

redisConnection.on('error', (error: Error) => {
  logger.error({ error }, 'Redis connection error');
});

redisConnection.on('connect', () => {
  logger.info('Redis connected');
});

// Worker instance
const worker = new Worker<JobData, JobResult>(QUEUE_NAMES.MAIN, jobProcessor, {
  connection: redisConnection as any, // Type cast due to ioredis version mismatch with bullmq
  concurrency: config.workerConcurrency,
  lockDuration: config.jobs.timeoutMs,
  stalledInterval: config.jobs.stalledIntervalMs,
  maxStalledCount: config.jobs.maxStalledCount,
  limiter: {
    max: 10,
    duration: 1000,
  },
  settings: {
    backoffStrategy: (attemptsMade: number) => {
      // Exponential backoff: 5s, 10s, 20s, 40s, etc.
      return Math.min(5000 * Math.pow(2, attemptsMade - 1), 300000);
    },
  },
});

// Worker event handlers
worker.on('completed', (job: Job<JobData, JobResult>) => {
  logger.info({
    jobId: job.data.id,
    bullmqId: job.id,
    jobName: job.name,
    duration: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : undefined,
  }, 'Job completed');
});

worker.on('failed', (job: Job<JobData, JobResult> | undefined, error: Error) => {
  logger.error({
    jobId: job?.data?.id,
    bullmqId: job?.id,
    jobName: job?.name,
    attempt: job?.attemptsMade,
    error: error.message,
  }, 'Job failed');
});

worker.on('error', (error: Error) => {
  logger.error({ error: error.message }, 'Worker error');
});

worker.on('stalled', (jobId: string) => {
  logger.warn({ jobId }, 'Job stalled - will be reprocessed');
});

worker.on('progress', (job: Job<JobData, JobResult>, progress) => {
  const progressValue = typeof progress === 'number' ? progress : 
    typeof progress === 'object' && progress !== null ? (progress as { percent?: number }).percent : 0;
  logger.debug({
    jobId: job.data.id,
    progress: progressValue,
  }, 'Job progress');
});

worker.on('active', (job: Job<JobData, JobResult>) => {
  logger.info({
    jobId: job.data.id,
    bullmqId: job.id,
    jobType: job.data.type,
    attempt: job.attemptsMade + 1,
  }, 'Job started');
});

// Start health check server
const healthServer = startHealthServer();

// Graceful shutdown
const shutdown = async (signal: string) => {
  if (isShuttingDown) {
    logger.warn({ signal }, 'Shutdown already in progress');
    return;
  }
  
  isShuttingDown = true;
  setShuttingDown();
  
  logger.info({ signal }, 'Shutdown signal received');
  
  // Set a hard timeout for shutdown
  const forceExitTimeout = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);

  try {
    // Stop accepting new jobs
    logger.info('Closing worker...');
    await worker.close();
    logger.info('Worker closed');
    
    // Close health server
    logger.info('Closing health server...');
    await healthServer.close();
    logger.info('Health server closed');
    
    // Close all queues
    logger.info('Closing queues...');
    await closeAllQueues();
    logger.info('Queues closed');
    
    // Close database connection
    logger.info('Closing database...');
    await closePrisma();
    logger.info('Database closed');
    
    // Close Redis connection
    logger.info('Closing Redis...');
    await redisConnection.quit();
    logger.info('Redis closed');
    
    clearTimeout(forceExitTimeout);
    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during shutdown');
    clearTimeout(forceExitTimeout);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception');
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection');
  shutdown('unhandledRejection');
});

// Startup complete
logger.info({
  workerId: config.workerId,
  concurrency: config.workerConcurrency,
  queue: QUEUE_NAMES.MAIN,
  healthPort: config.healthCheck.port,
}, 'Worker started');

// Export for testing
export { worker, redisConnection };
