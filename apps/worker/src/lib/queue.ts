/**
 * Queue Management
 * 
 * BullMQ queue setup with proper configuration
 * for reliable job processing.
 */

import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config/index.js';
import { logger } from './logger.js';

// Dedicated Redis connections for different purposes
// BullMQ requires maxRetriesPerRequest: null
const createRedisConnection = (): Redis => new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy: (times: number) => {
    if (times > 10) {
      logger.error({ times }, 'Redis connection failed after max retries');
      return null;
    }
    return Math.min(times * 100, 3000);
  },
});

// Queue names
export const QUEUE_NAMES = {
  MAIN: 'media-jobs',
  PRIORITY: 'priority-jobs',
  SLOW: 'slow-jobs',
} as const;

// Queue instances
const queues = new Map<string, Queue>();
const queueEvents = new Map<string, QueueEvents>();

/**
 * Get or create a queue instance
 */
export function getQueue(name: string = QUEUE_NAMES.MAIN): Queue {
  if (!queues.has(name)) {
    const queue = new Queue(name, {
      connection: createRedisConnection() as any, // Type cast due to ioredis version mismatch with bullmq
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: {
          age: 86400, // 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 604800, // 7 days
        },
      },
    });
    
    queues.set(name, queue);
    logger.info({ queue: name }, 'Queue created');
  }
  
  return queues.get(name)!;
}

/**
 * Get or create queue events listener
 */
export function getQueueEvents(name: string = QUEUE_NAMES.MAIN): QueueEvents {
  if (!queueEvents.has(name)) {
    const events = new QueueEvents(name, {
      connection: createRedisConnection() as any, // Type cast due to ioredis version mismatch with bullmq
    });
    
    queueEvents.set(name, events);
  }
  
  return queueEvents.get(name)!;
}

/**
 * Add a job to the queue
 */
export async function addJob<T extends object>(
  name: string,
  data: T,
  options?: {
    priority?: number;
    delay?: number;
    jobId?: string;
    attempts?: number;
  }
): Promise<string> {
  const queue = getQueue(QUEUE_NAMES.MAIN);
  
  const job = await queue.add(name, data, {
    priority: options?.priority ?? 5,
    delay: options?.delay,
    jobId: options?.jobId,
    attempts: options?.attempts,
  });
  
  logger.info({ jobId: job.id, name, priority: options?.priority }, 'Job added to queue');
  
  return job.id!;
}

/**
 * Get job by ID
 */
export async function getJob(jobId: string, queueName: string = QUEUE_NAMES.MAIN) {
  const queue = getQueue(queueName);
  return queue.getJob(jobId);
}

/**
 * Get queue statistics
 */
export async function getQueueStats(queueName: string = QUEUE_NAMES.MAIN) {
  const queue = getQueue(queueName);
  
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  
  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    paused: 0, // Paused count not available in newer BullMQ
    total: waiting + active + delayed,
  };
}

/**
 * Pause all queues
 */
export async function pauseAllQueues(): Promise<void> {
  for (const [name, queue] of queues) {
    await queue.pause();
    logger.info({ queue: name }, 'Queue paused');
  }
}

/**
 * Resume all queues
 */
export async function resumeAllQueues(): Promise<void> {
  for (const [name, queue] of queues) {
    await queue.resume();
    logger.info({ queue: name }, 'Queue resumed');
  }
}

/**
 * Drain all queues (remove all jobs)
 */
export async function drainAllQueues(): Promise<void> {
  for (const [name, queue] of queues) {
    await queue.drain();
    logger.warn({ queue: name }, 'Queue drained');
  }
}

/**
 * Close all queue connections
 */
export async function closeAllQueues(): Promise<void> {
  for (const [name, queue] of queues) {
    await queue.close();
    logger.info({ queue: name }, 'Queue closed');
  }
  
  for (const [name, events] of queueEvents) {
    await events.close();
    logger.info({ queue: name }, 'Queue events closed');
  }
  
  queues.clear();
  queueEvents.clear();
}

/**
 * Clean old jobs from queue
 */
export async function cleanOldJobs(
  queueName: string = QUEUE_NAMES.MAIN,
  grace: number = 86400000 // 24 hours
): Promise<void> {
  const queue = getQueue(queueName);
  
  const [cleaned] = await Promise.all([
    queue.clean(grace, 1000, 'completed'),
    queue.clean(grace * 7, 1000, 'failed'), // Keep failed for 7 days
  ]);
  
  logger.info({ queue: queueName, cleaned: cleaned.length }, 'Old jobs cleaned');
}
