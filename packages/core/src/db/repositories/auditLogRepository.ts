/**
 * AuditLog Repository
 * 
 * Handles all audit log database operations.
 * Every significant action MUST be logged here.
 * This is the source of truth for what happened.
 */

import { AuditLog, AuditAction, LogLevel, Prisma } from '@prisma/client';
import { BaseRepository } from '../baseRepository.js';

type AuditLogCreateInput = Prisma.AuditLogCreateInput;
type AuditLogUpdateInput = Prisma.AuditLogUpdateInput;

export interface CreateAuditLogInput {
  action: AuditAction;
  message: string;
  level?: LogLevel;
  jobId?: string;
  userId?: string;
  mediaAssetId?: string;
  metadata?: Record<string, unknown>;
  command?: string;
  commandOutput?: string;
  exitCode?: number;
}

export interface AuditLogFilter {
  action?: AuditAction;
  level?: LogLevel;
  jobId?: string;
  userId?: string;
  startDate?: Date;
  endDate?: Date;
}

export class AuditLogRepository extends BaseRepository<
  AuditLog,
  AuditLogCreateInput,
  AuditLogUpdateInput
> {
  constructor() {
    super('AuditLog');
  }

  protected getDelegate() {
    return this.prisma.auditLog;
  }

  /**
   * Find logs by job
   */
  async findByJob(jobId: string): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Find logs by user
   */
  async findByUser(userId: string): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find logs by action
   */
  async findByAction(action: AuditAction): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: { action },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find logs by level
   */
  async findByLevel(level: LogLevel): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: { level },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find error logs
   */
  async findErrors(): Promise<AuditLog[]> {
    return this.findByLevel('ERROR');
  }

  /**
   * Find warning logs
   */
  async findWarnings(): Promise<AuditLog[]> {
    return this.findByLevel('WARN');
  }

  /**
   * Find logs by date range
   */
  async findByDateRange(startDate: Date, endDate: Date): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find logs with filters
   */
  async findWithFilters(filter: AuditLogFilter): Promise<AuditLog[]> {
    const where: Prisma.AuditLogWhereInput = {};

    if (filter.action) where.action = filter.action;
    if (filter.level) where.level = filter.level;
    if (filter.jobId) where.jobId = filter.jobId;
    if (filter.userId) where.userId = filter.userId;

    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) where.createdAt.gte = filter.startDate;
      if (filter.endDate) where.createdAt.lte = filter.endDate;
    }

    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Create an audit log entry
   */
  async log(input: CreateAuditLogInput): Promise<AuditLog> {
    return this.prisma.auditLog.create({
      data: {
        action: input.action,
        message: input.message,
        level: input.level || 'INFO',
        metadata: (input.metadata || {}) as Prisma.InputJsonValue,
        command: input.command,
        commandOutput: input.commandOutput,
        exitCode: input.exitCode,
        ...(input.jobId && {
          job: { connect: { id: input.jobId } },
        }),
        ...(input.userId && {
          user: { connect: { id: input.userId } },
        }),
        ...(input.mediaAssetId && {
          mediaAsset: { connect: { id: input.mediaAssetId } },
        }),
      },
    });
  }

  /**
   * Log info level
   */
  async logInfo(
    action: AuditAction,
    message: string,
    options?: Omit<CreateAuditLogInput, 'action' | 'message' | 'level'>
  ): Promise<AuditLog> {
    return this.log({ action, message, level: 'INFO', ...options });
  }

  /**
   * Log warning level
   */
  async logWarn(
    action: AuditAction,
    message: string,
    options?: Omit<CreateAuditLogInput, 'action' | 'message' | 'level'>
  ): Promise<AuditLog> {
    return this.log({ action, message, level: 'WARN', ...options });
  }

  /**
   * Log error level
   */
  async logError(
    action: AuditAction,
    message: string,
    options?: Omit<CreateAuditLogInput, 'action' | 'message' | 'level'>
  ): Promise<AuditLog> {
    return this.log({ action, message, level: 'ERROR', ...options });
  }

  /**
   * Log debug level
   */
  async logDebug(
    action: AuditAction,
    message: string,
    options?: Omit<CreateAuditLogInput, 'action' | 'message' | 'level'>
  ): Promise<AuditLog> {
    return this.log({ action, message, level: 'DEBUG', ...options });
  }

  // Convenience methods for common actions

  /**
   * Log job created
   */
  async logJobCreated(jobId: string, userId: string): Promise<AuditLog> {
    return this.logInfo('JOB_CREATED', 'Job created', { jobId, userId });
  }

  /**
   * Log job state changed
   */
  async logJobStateChanged(
    jobId: string,
    fromState: string,
    toState: string,
    reason?: string
  ): Promise<AuditLog> {
    return this.logInfo('JOB_STATE_CHANGED', `Job state changed from ${fromState} to ${toState}`, {
      jobId,
      metadata: { fromState, toState, reason },
    });
  }

  /**
   * Log job failed
   */
  async logJobFailed(jobId: string, error: string): Promise<AuditLog> {
    return this.logError('JOB_FAILED', `Job failed: ${error}`, {
      jobId,
      metadata: { error },
    });
  }

  /**
   * Log job completed
   */
  async logJobCompleted(jobId: string): Promise<AuditLog> {
    return this.logInfo('JOB_COMPLETED', 'Job completed successfully', { jobId });
  }

  /**
   * Log FFmpeg command executed
   */
  async logFFmpegCommand(
    jobId: string,
    command: string,
    exitCode: number,
    output?: string
  ): Promise<AuditLog> {
    const level = exitCode === 0 ? 'INFO' : 'ERROR';
    const action = 'FFMPEG_COMMAND_EXECUTED';
    const message = exitCode === 0 ? 'FFmpeg command executed successfully' : 'FFmpeg command failed';

    return this.log({
      action,
      message,
      level: level as LogLevel,
      jobId,
      command,
      commandOutput: output,
      exitCode,
    });
  }

  /**
   * Log sync decision made
   */
  async logSyncDecision(
    jobId: string,
    needsCorrection: boolean,
    correctionType?: string,
    confidence?: number
  ): Promise<AuditLog> {
    const message = needsCorrection
      ? `Sync correction needed: ${correctionType} (confidence: ${confidence}%)`
      : 'No sync correction needed';

    return this.logInfo('SYNC_DECISION_MADE', message, {
      jobId,
      metadata: { needsCorrection, correctionType, confidence },
    });
  }

  /**
   * Get audit statistics
   */
  async getStatistics(): Promise<{
    total: number;
    byAction: Record<AuditAction, number>;
    byLevel: Record<LogLevel, number>;
    todayCount: number;
    errorCount: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [total, actionStats, levelStats, todayCount, errorCount] = await Promise.all([
      this.count(),
      this.prisma.auditLog.groupBy({
        by: ['action'],
        _count: true,
      }),
      this.prisma.auditLog.groupBy({
        by: ['level'],
        _count: true,
      }),
      this.count({ createdAt: { gte: today } }),
      this.count({ level: 'ERROR' }),
    ]);

    const byAction = actionStats.reduce((acc, a) => {
      acc[a.action] = a._count;
      return acc;
    }, {} as Record<AuditAction, number>);

    const byLevel = levelStats.reduce((acc, l) => {
      acc[l.level] = l._count;
      return acc;
    }, {} as Record<LogLevel, number>);

    return { total, byAction, byLevel, todayCount, errorCount };
  }

  /**
   * Cleanup old logs (retention policy)
   */
  async cleanupOldLogs(daysToKeep: number): Promise<{ count: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    // Keep error logs longer
    return this.deleteMany({
      createdAt: { lt: cutoffDate },
      level: { not: 'ERROR' },
    });
  }
}

// Singleton instance
export const auditLogRepository = new AuditLogRepository();
