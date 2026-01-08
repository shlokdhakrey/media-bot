/**
 * Prisma Client Singleton with Connection Pooling
 * 
 * Design Decisions:
 * - Single instance pattern prevents connection exhaustion
 * - Connection pool configured via DATABASE_URL params
 * - Logging hooks for query debugging in development
 * - Graceful shutdown handling
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../logger.js';

// Define event types for Prisma logging
interface QueryEvent {
  query: string;
  params: string;
  duration: number;
}

interface LogEvent {
  message: string;
}

// Extend PrismaClient with logging
const prismaClientSingleton = () => {
  const client = new PrismaClient({
    log: [
      { level: 'query', emit: 'event' },
      { level: 'error', emit: 'event' },
      { level: 'warn', emit: 'event' },
    ],
  });

  // Query logging in development
  if (process.env.NODE_ENV === 'development') {
    client.$on('query', (e: QueryEvent) => {
      logger.debug({
        query: e.query,
        params: e.params,
        duration: e.duration,
      }, 'Database query executed');
    });
  }

  // Error logging always
  client.$on('error', (e: LogEvent) => {
    logger.error({ error: e.message }, 'Database error');
  });

  client.$on('warn', (e: LogEvent) => {
    logger.warn({ warning: e.message }, 'Database warning');
  });

  return client;
};

// Global type declaration for singleton
declare global {
  // eslint-disable-next-line no-var
  var prisma: ReturnType<typeof prismaClientSingleton> | undefined;
}

// Singleton instance
export const prisma = globalThis.prisma ?? prismaClientSingleton();

// Prevent multiple instances in development (hot reload)
if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

/**
 * Connect to database with retry logic
 */
export async function connectDatabase(maxRetries = 5, retryDelayMs = 2000): Promise<void> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$connect();
      logger.info('Database connected successfully');
      return;
    } catch (error) {
      lastError = error as Error;
      logger.warn(
        { attempt, maxRetries, error: lastError.message },
        'Database connection failed, retrying...'
      );

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  logger.error({ error: lastError?.message }, 'Failed to connect to database after all retries');
  throw lastError;
}

/**
 * Disconnect from database gracefully
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected successfully');
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Error disconnecting from database');
    throw error;
  }
}

/**
 * Health check for database connection
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Database health check failed');
    return false;
  }
}

/**
 * Transaction helper with automatic rollback on error
 */
export async function withTransaction<T>(
  fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    return fn(tx);
  });
}

export type { PrismaClient };
