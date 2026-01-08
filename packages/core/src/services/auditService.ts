/**
 * Audit Service
 * 
 * Centralized logging for all auditable actions.
 * Every significant action in the system should go through here.
 */

import { Prisma, AuditAction, LogLevel } from '@prisma/client';
import { prisma } from '../db/client.js';
import type { AuditLog } from '../types/audit.js';

interface AuditLogInput {
  action: AuditAction;
  message: string;
  jobId?: string;
  userId?: string;
  mediaAssetId?: string;
  level: LogLevel;
  metadata?: Record<string, unknown>;
  command?: string;
  commandOutput?: string;
  exitCode?: number;
}

export class AuditService {
  /**
   * Create an audit log entry
   */
  async log(input: AuditLogInput): Promise<AuditLog> {
    const log = await prisma.auditLog.create({
      data: {
        action: input.action,
        message: input.message,
        jobId: input.jobId,
        userId: input.userId,
        mediaAssetId: input.mediaAssetId,
        level: input.level,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        command: input.command,
        commandOutput: input.commandOutput,
        exitCode: input.exitCode,
      },
    });

    return log;
  }

  /**
   * Log a command execution
   */
  async logCommand(
    command: string,
    output: string,
    exitCode: number,
    context: {
      jobId?: string;
      userId?: string;
      mediaAssetId?: string;
    } = {}
  ): Promise<AuditLog> {
    const success = exitCode === 0;
    
    return this.log({
      action: 'FFMPEG_COMMAND_EXECUTED',
      message: success ? 'Command executed successfully' : `Command failed with exit code ${exitCode}`,
      level: success ? 'INFO' : 'ERROR',
      command,
      commandOutput: output.substring(0, 10000), // Limit output size
      exitCode,
      ...context,
    });
  }

  /**
   * Retrieve audit logs with filters
   */
  async getLogs(options: {
    jobId?: string;
    userId?: string;
    action?: AuditAction;
    level?: LogLevel;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ logs: AuditLog[]; total: number }> {
    const where: Prisma.AuditLogWhereInput = {
      ...(options.jobId && { jobId: options.jobId }),
      ...(options.userId && { userId: options.userId }),
      ...(options.action && { action: options.action }),
      ...(options.level && { level: options.level }),
      ...((options.from || options.to) && {
        createdAt: {
          ...(options.from && { gte: options.from }),
          ...(options.to && { lte: options.to }),
        },
      }),
    };

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        take: options.limit ?? 100,
        skip: options.offset ?? 0,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { logs, total };
  }
}
