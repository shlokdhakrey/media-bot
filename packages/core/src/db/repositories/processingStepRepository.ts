/**
 * ProcessingStep Repository
 * 
 * Handles all processing step database operations.
 * Critical for debugging and reproducing FFmpeg commands.
 */

import { ProcessingStep, ProcessingType, ProcessingStatus, Prisma } from '@prisma/client';
import { BaseRepository } from '../baseRepository.js';

type ProcessingStepCreateInput = Prisma.ProcessingStepCreateInput;
type ProcessingStepUpdateInput = Prisma.ProcessingStepUpdateInput;

export interface CreateProcessingStepInput {
  jobId: string;
  type: ProcessingType;
  order: number;
  command?: string;
  commandArgs?: string[];
}

export class ProcessingStepRepository extends BaseRepository<
  ProcessingStep,
  ProcessingStepCreateInput,
  ProcessingStepUpdateInput
> {
  constructor() {
    super('ProcessingStep');
  }

  protected getDelegate() {
    return this.prisma.processingStep;
  }

  /**
   * Find steps by job
   */
  async findByJob(jobId: string): Promise<ProcessingStep[]> {
    return this.prisma.processingStep.findMany({
      where: { jobId },
      orderBy: { order: 'asc' },
    });
  }

  /**
   * Find steps by type
   */
  async findByType(type: ProcessingType): Promise<ProcessingStep[]> {
    return this.findMany({ type });
  }

  /**
   * Find steps by status
   */
  async findByStatus(status: ProcessingStatus): Promise<ProcessingStep[]> {
    return this.findMany({ status });
  }

  /**
   * Find pending steps for a job
   */
  async findPendingSteps(jobId: string): Promise<ProcessingStep[]> {
    return this.prisma.processingStep.findMany({
      where: { jobId, status: 'PENDING' },
      orderBy: { order: 'asc' },
    });
  }

  /**
   * Get next step to execute
   */
  async getNextStep(jobId: string): Promise<ProcessingStep | null> {
    return this.prisma.processingStep.findFirst({
      where: { jobId, status: 'PENDING' },
      orderBy: { order: 'asc' },
    });
  }

  /**
   * Find failed steps for a job
   */
  async findFailedSteps(jobId: string): Promise<ProcessingStep[]> {
    return this.findMany({ jobId, status: 'FAILED' });
  }

  /**
   * Get last step for a job
   */
  async getLastStep(jobId: string): Promise<ProcessingStep | null> {
    return this.prisma.processingStep.findFirst({
      where: { jobId },
      orderBy: { order: 'desc' },
    });
  }

  /**
   * Get next order number for a job
   */
  async getNextOrder(jobId: string): Promise<number> {
    const lastStep = await this.getLastStep(jobId);
    return lastStep ? lastStep.order + 1 : 1;
  }

  /**
   * Create a processing step
   */
  async createStep(input: CreateProcessingStepInput): Promise<ProcessingStep> {
    return this.prisma.processingStep.create({
      data: {
        type: input.type,
        order: input.order,
        status: 'PENDING',
        command: input.command,
        commandArgs: input.commandArgs || [],
        job: {
          connect: { id: input.jobId },
        },
      },
    });
  }

  /**
   * Start a processing step
   */
  async startStep(id: string, command?: string, commandArgs?: string[]): Promise<ProcessingStep> {
    return this.update(id, {
      status: 'RUNNING',
      startedAt: new Date(),
      command,
      commandArgs: commandArgs || [],
    });
  }

  /**
   * Complete a processing step
   */
  async completeStep(
    id: string,
    stdout?: string,
    stderr?: string,
    exitCode?: number
  ): Promise<ProcessingStep> {
    const step = await this.findByIdOrThrow(id);
    const now = new Date();
    const durationMs = step.startedAt ? now.getTime() - step.startedAt.getTime() : null;

    return this.update(id, {
      status: 'COMPLETED',
      completedAt: now,
      durationMs,
      stdout,
      stderr,
      exitCode,
    });
  }

  /**
   * Fail a processing step
   */
  async failStep(
    id: string,
    error: string,
    stdout?: string,
    stderr?: string,
    exitCode?: number
  ): Promise<ProcessingStep> {
    const step = await this.findByIdOrThrow(id);
    const now = new Date();
    const durationMs = step.startedAt ? now.getTime() - step.startedAt.getTime() : null;

    return this.update(id, {
      status: 'FAILED',
      completedAt: now,
      durationMs,
      error,
      stdout,
      stderr,
      exitCode,
    });
  }

  /**
   * Skip a processing step
   */
  async skipStep(id: string): Promise<ProcessingStep> {
    return this.update(id, {
      status: 'SKIPPED',
      completedAt: new Date(),
    });
  }

  /**
   * Get step execution summary for a job
   */
  async getExecutionSummary(jobId: string): Promise<{
    total: number;
    completed: number;
    failed: number;
    pending: number;
    running: number;
    skipped: number;
    totalDurationMs: number;
  }> {
    const steps = await this.findByJob(jobId);

    let totalDurationMs = 0;
    const statusCounts = {
      completed: 0,
      failed: 0,
      pending: 0,
      running: 0,
      skipped: 0,
    };

    for (const step of steps) {
      switch (step.status) {
        case 'COMPLETED':
          statusCounts.completed++;
          break;
        case 'FAILED':
          statusCounts.failed++;
          break;
        case 'PENDING':
          statusCounts.pending++;
          break;
        case 'RUNNING':
          statusCounts.running++;
          break;
        case 'SKIPPED':
          statusCounts.skipped++;
          break;
      }

      if (step.durationMs) {
        totalDurationMs += step.durationMs;
      }
    }

    return {
      total: steps.length,
      ...statusCounts,
      totalDurationMs,
    };
  }

  /**
   * Find FFmpeg commands for a job (MUX, SAMPLE_GEN steps)
   */
  async findFFmpegCommands(jobId: string): Promise<ProcessingStep[]> {
    return this.prisma.processingStep.findMany({
      where: {
        jobId,
        type: { in: ['MUX', 'SAMPLE_GEN'] },
        command: { not: null },
      },
      orderBy: { order: 'asc' },
    });
  }

  /**
   * Get average duration by processing type
   */
  async getAverageDurationByType(): Promise<Record<ProcessingType, number>> {
    const stats = await this.prisma.processingStep.groupBy({
      by: ['type'],
      where: { status: 'COMPLETED', durationMs: { not: null } },
      _avg: { durationMs: true },
    });

    return stats.reduce((acc, s) => {
      acc[s.type] = s._avg.durationMs || 0;
      return acc;
    }, {} as Record<ProcessingType, number>);
  }
}

// Singleton instance
export const processingStepRepository = new ProcessingStepRepository();
