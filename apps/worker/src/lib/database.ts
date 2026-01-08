/**
 * Database Helper
 * 
 * Prisma client instance and job state management.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from './logger.js';

// Singleton Prisma client
let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: [
        { level: 'error', emit: 'event' },
        { level: 'warn', emit: 'event' },
      ],
    });
    
    prisma.$on('error' as never, (e: unknown) => {
      logger.error({ error: e }, 'Prisma error');
    });
    
    prisma.$on('warn' as never, (e: unknown) => {
      logger.warn({ warning: e }, 'Prisma warning');
    });
  }
  
  return prisma;
}

/**
 * Update job status in database
 */
export async function updateJobStatus(
  jobId: string,
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED',
  details?: {
    progress?: number;
    message?: string;
    error?: string;
    result?: Record<string, unknown>;
  }
): Promise<void> {
  const db = getPrisma();
  
  const updateData: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };
  
  if (status === 'RUNNING' && !details?.progress) {
    updateData['startedAt'] = new Date();
  }
  
  if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
    updateData['completedAt'] = new Date();
  }
  
  if (details?.progress !== undefined) {
    updateData['progress'] = details.progress;
  }
  
  if (details?.message) {
    updateData['message'] = details.message;
  }
  
  if (details?.error) {
    updateData['error'] = details.error;
  }
  
  if (details?.result) {
    updateData['result'] = details.result;
  }
  
  try {
    await db.job.update({
      where: { id: jobId },
      data: updateData,
    });
    
    logger.debug({ jobId, status }, 'Job status updated');
  } catch (error) {
    logger.error({ jobId, status, error }, 'Failed to update job status');
    throw error;
  }
}

/**
 * Get job from database
 */
export async function getJobFromDb(jobId: string) {
  const db = getPrisma();
  
  return db.job.findUnique({
    where: { id: jobId },
    include: {
      mediaAssets: true,
      downloads: true,
    },
  });
}

/**
 * Create audit log entry
 */
export async function createAuditLog(
  action: string,
  message: string,
  jobId?: string,
  details?: Record<string, unknown>,
  userId?: string
): Promise<void> {
  const db = getPrisma();
  const { AuditAction, LogLevel } = await import('@prisma/client');
  
  // Map string action to AuditAction enum, defaulting to JOB_STATE_CHANGED
  type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction];
  const actionEnum: AuditActionType = Object.values(AuditAction).includes(action as AuditActionType) 
    ? (action as AuditActionType)
    : AuditAction.JOB_STATE_CHANGED;
  
  try {
    await db.auditLog.create({
      data: {
        action: actionEnum,
        message,
        level: LogLevel.INFO,
        jobId,
        userId,
        metadata: (details ?? {}) as Prisma.InputJsonValue,
        createdAt: new Date(),
      },
    });
  } catch (error) {
    // Log but don't throw - audit logs shouldn't break processing
    logger.error({ action, message, jobId, error }, 'Failed to create audit log');
  }
}

/**
 * Close database connection
 */
export async function closePrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    logger.info('Database connection closed');
  }
}
