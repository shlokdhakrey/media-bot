/**
 * Database Utilities
 * 
 * Helper functions for database operations.
 */

import { prisma } from './client.js';
import { logger } from '../logger.js';

/**
 * Execute a raw SQL query
 */
export async function executeRawQuery<T = unknown>(query: string): Promise<T> {
  try {
    const result = await prisma.$queryRawUnsafe<T>(query);
    return result;
  } catch (error) {
    logger.error({ query, error: (error as Error).message }, 'Raw query failed');
    throw error;
  }
}

/**
 * Get database size (PostgreSQL)
 */
export async function getDatabaseSize(): Promise<string> {
  const result = await prisma.$queryRaw<[{ size: string }]>`
    SELECT pg_size_pretty(pg_database_size(current_database())) as size
  `;
  return result[0].size;
}

/**
 * Get table sizes (PostgreSQL)
 */
export async function getTableSizes(): Promise<Array<{ table: string; size: string }>> {
  const result = await prisma.$queryRaw<Array<{ table: string; size: string }>>`
    SELECT 
      relname as table,
      pg_size_pretty(pg_total_relation_size(relid)) as size
    FROM pg_catalog.pg_statio_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
  `;
  return result;
}

/**
 * Get row counts for all tables
 */
export async function getRowCounts(): Promise<Record<string, number>> {
  const [users, jobs, mediaAssets, downloads, syncDecisions, processingSteps, auditLogs] = 
    await Promise.all([
      prisma.user.count(),
      prisma.job.count(),
      prisma.mediaAsset.count(),
      prisma.download.count(),
      prisma.syncDecision.count(),
      prisma.processingStep.count(),
      prisma.auditLog.count(),
    ]);

  return {
    users,
    jobs,
    mediaAssets,
    downloads,
    syncDecisions,
    processingSteps,
    auditLogs,
  };
}

/**
 * Vacuum and analyze tables (PostgreSQL maintenance)
 */
export async function vacuumAnalyze(): Promise<void> {
  try {
    // Note: VACUUM cannot run in a transaction, so we use $executeRawUnsafe
    await prisma.$executeRawUnsafe('VACUUM ANALYZE');
    logger.info('VACUUM ANALYZE completed');
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'VACUUM ANALYZE failed');
    throw error;
  }
}

/**
 * Check for long-running queries (PostgreSQL)
 */
export async function getLongRunningQueries(minSeconds = 30): Promise<Array<{
  pid: number;
  duration: string;
  query: string;
  state: string;
}>> {
  const result = await prisma.$queryRaw<Array<{
    pid: number;
    duration: string;
    query: string;
    state: string;
  }>>`
    SELECT 
      pid,
      now() - pg_stat_activity.query_start AS duration,
      query,
      state
    FROM pg_stat_activity
    WHERE state != 'idle'
      AND now() - pg_stat_activity.query_start > interval '${minSeconds} seconds'
    ORDER BY duration DESC
  `;
  return result;
}

/**
 * Kill a query by PID (PostgreSQL)
 */
export async function killQuery(pid: number): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT pg_cancel_backend(${pid})`;
    logger.info({ pid }, 'Query cancelled');
    return true;
  } catch (error) {
    logger.error({ pid, error: (error as Error).message }, 'Failed to cancel query');
    return false;
  }
}

/**
 * Get active connections count
 */
export async function getActiveConnections(): Promise<number> {
  const result = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT count(*) FROM pg_stat_activity WHERE state = 'active'
  `;
  return Number(result[0].count);
}

/**
 * Database migration helper
 */
export interface MigrationStatus {
  applied: string[];
  pending: string[];
  failed: string[];
}

/**
 * Create database indexes for performance
 */
export async function createPerformanceIndexes(): Promise<void> {
  try {
    // These indexes improve common query patterns
    // Most are already defined in schema.prisma, but this can add composite indexes
    
    // Composite index for job queries by user and state
    await prisma.$executeRawUnsafe(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_user_state 
      ON "Job" ("userId", "state")
    `);

    // Composite index for audit log time-based queries
    await prisma.$executeRawUnsafe(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_created_level 
      ON "AuditLog" ("createdAt" DESC, "level")
    `);

    logger.info('Performance indexes created');
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Failed to create indexes');
    // Don't throw - indexes might already exist
  }
}

/**
 * Cleanup orphaned records
 */
export async function cleanupOrphanedRecords(): Promise<{
  deletedAssets: number;
  deletedDownloads: number;
}> {
  // Find and delete assets without a valid job
  const deletedAssets = await prisma.mediaAsset.deleteMany({
    where: {
      job: null as any, // TypeScript workaround for checking deleted relations
    },
  });

  // Find and delete downloads without a valid job
  const deletedDownloads = await prisma.download.deleteMany({
    where: {
      job: null as any,
    },
  });

  logger.info(
    { deletedAssets: deletedAssets.count, deletedDownloads: deletedDownloads.count },
    'Orphaned records cleaned up'
  );

  return {
    deletedAssets: deletedAssets.count,
    deletedDownloads: deletedDownloads.count,
  };
}

/**
 * Seed default admin user
 */
export async function seedDefaultAdmin(
  username: string,
  email?: string
): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { username },
  });

  if (!existing) {
    await prisma.user.create({
      data: {
        username,
        email,
        role: 'ADMIN',
        isActive: true,
      },
    });
    logger.info({ username }, 'Default admin user created');
  }
}
