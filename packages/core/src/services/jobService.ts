/**
 * Job Service
 * 
 * Business logic for job management.
 */

import { Prisma, Priority } from '@prisma/client';
import { prisma } from '../db/client.js';
import { JobStateMachine, JobState } from '../stateMachine.js';
import { AuditService } from './auditService.js';
import type { Job, JobCreateInput } from '../types/job.js';
import { NotFoundError, ValidationError } from '../errors/index.js';

export class JobService {
  private auditService: AuditService;

  constructor() {
    this.auditService = new AuditService();
  }

  /**
   * Create a new job
   */
  async createJob(input: JobCreateInput): Promise<Job> {
    // Validate input
    if (!input.source || input.source.trim() === '') {
      throw new ValidationError('source', 'Source is required');
    }

    const stateHistoryEntry = {
      from: 'INITIAL',
      to: JobState.PENDING,
      timestamp: new Date().toISOString(),
      reason: 'Job created',
    };

    // Create the job in database
    const job = await prisma.job.create({
      data: {
        type: input.type,
        source: input.source,
        userId: input.userId,
        state: JobState.PENDING,
        priority: input.priority ?? Priority.NORMAL,
        options: (input.options ?? {}) as Prisma.InputJsonValue,
        progress: 0,
        retryCount: 0,
        stateHistory: [stateHistoryEntry as Prisma.InputJsonValue],
      },
    });

    // Log creation
    await this.auditService.log({
      action: 'JOB_CREATED',
      message: `Job created: ${job.id}`,
      jobId: job.id,
      userId: input.userId,
      level: 'INFO',
      metadata: {
        type: input.type,
        source: input.source,
        priority: input.priority,
      },
    });

    return job;
  }

  /**
   * Get a job by ID
   */
  async getJob(jobId: string): Promise<Job> {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundError('Job', jobId);
    }

    return job;
  }

  /**
   * List jobs with optional filters
   */
  async listJobs(options: {
    userId?: string;
    state?: JobState;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ jobs: Job[]; total: number }> {
    const where = {
      ...(options.userId && { userId: options.userId }),
      ...(options.state && { state: options.state }),
    };

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        take: options.limit ?? 50,
        skip: options.offset ?? 0,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.job.count({ where }),
    ]);

    return { jobs, total };
  }

  /**
   * Transition a job to a new state
   */
  async transitionState(
    jobId: string,
    newState: JobState,
    reason?: string,
    metadata?: Record<string, unknown>
  ): Promise<Job> {
    const job = await this.getJob(jobId);
    
    // Use state machine to validate transition
    const machine = new JobStateMachine(jobId, job.state);
    const transition = machine.transitionTo(newState, reason, metadata);

    const stateHistoryEntry = {
      from: transition.from,
      to: transition.to,
      timestamp: transition.timestamp.toISOString(),
      reason: transition.reason,
    };

    // Update job in database
    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        state: newState,
        stateHistory: {
          push: stateHistoryEntry as Prisma.InputJsonValue,
        },
        ...(newState === JobState.DONE && { completedAt: new Date() }),
        ...(newState === JobState.DOWNLOADING && { startedAt: new Date() }),
      },
    });

    // Log state change
    await this.auditService.log({
      action: 'JOB_STATE_CHANGED',
      message: `Job ${jobId} transitioned from ${transition.from} to ${transition.to}`,
      jobId,
      level: 'INFO',
      metadata: {
        from: transition.from,
        to: transition.to,
        reason,
        ...metadata,
      },
    });

    return updatedJob;
  }

  /**
   * Update job progress
   */
  async updateProgress(jobId: string, progress: number): Promise<void> {
    await prisma.job.update({
      where: { id: jobId },
      data: { progress: Math.min(100, Math.max(0, progress)) },
    });
  }

  /**
   * Fail a job
   */
  async failJob(jobId: string, error: string): Promise<Job> {
    const job = await this.getJob(jobId);
    
    const stateHistoryEntry = {
      from: job.state,
      to: JobState.FAILED,
      timestamp: new Date().toISOString(),
      reason: error,
    };

    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        state: JobState.FAILED,
        error,
        stateHistory: {
          push: stateHistoryEntry as Prisma.InputJsonValue,
        },
      },
    });

    await this.auditService.log({
      action: 'JOB_FAILED',
      message: `Job ${jobId} failed: ${error}`,
      jobId,
      level: 'ERROR',
      metadata: { error },
    });

    return updatedJob;
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string, reason: string): Promise<Job> {
    const job = await this.getJob(jobId);
    
    // Can only cancel jobs that aren't terminal
    if (job.state === JobState.DONE || job.state === JobState.FAILED) {
      throw new ValidationError('state', 'Cannot cancel a completed or failed job');
    }

    return this.failJob(jobId, `Cancelled: ${reason}`);
  }
}
