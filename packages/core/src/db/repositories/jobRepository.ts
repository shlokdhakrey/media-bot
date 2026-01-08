/**
 * Job Repository
 * 
 * Handles all job-related database operations.
 * Integrates with the state machine for state transitions.
 * Every state change is recorded in stateHistory.
 */

import { Job, JobState, JobType, Priority, Prisma } from '@prisma/client';
import { BaseRepository } from '../baseRepository.js';
import { JobStateMachine, getNextStates } from '../../stateMachine.js';

type JobCreateInput = Prisma.JobCreateInput;
type JobUpdateInput = Prisma.JobUpdateInput;

export interface StateTransitionRecord {
  from: string;
  to: string;
  timestamp: string;
  reason?: string;
}

export interface CreateJobInput {
  userId: string;
  type: JobType;
  source: string;
  priority?: Priority;
  options?: Record<string, unknown>;
}

export class JobRepository extends BaseRepository<Job, JobCreateInput, JobUpdateInput> {
  constructor() {
    super('Job');
  }

  protected getDelegate() {
    return this.prisma.job;
  }

  /**
   * Find jobs by user
   */
  async findByUser(userId: string): Promise<Job[]> {
    return this.findMany({ userId });
  }

  /**
   * Find jobs by state
   */
  async findByState(state: JobState): Promise<Job[]> {
    return this.findMany({ state });
  }

  /**
   * Find jobs by type
   */
  async findByType(type: JobType): Promise<Job[]> {
    return this.findMany({ type });
  }

  /**
   * Find pending jobs (ready to process)
   */
  async findPendingJobs(limit = 10): Promise<Job[]> {
    return this.prisma.job.findMany({
      where: { state: 'PENDING' },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'asc' },
      ],
      take: limit,
    });
  }

  /**
   * Find active jobs (currently processing)
   */
  async findActiveJobs(): Promise<Job[]> {
    return this.prisma.job.findMany({
      where: {
        state: {
          notIn: ['PENDING', 'DONE', 'FAILED'],
        },
      },
      orderBy: { startedAt: 'asc' },
    });
  }

  /**
   * Find failed jobs
   */
  async findFailedJobs(): Promise<Job[]> {
    return this.findMany({ state: 'FAILED' });
  }

  /**
   * Find completed jobs
   */
  async findCompletedJobs(): Promise<Job[]> {
    return this.findMany({ state: 'DONE' });
  }

  /**
   * Find jobs by date range
   */
  async findByDateRange(startDate: Date, endDate: Date): Promise<Job[]> {
    return this.prisma.job.findMany({
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
   * Get job with all related data
   */
  async findByIdWithRelations(id: string): Promise<Job & {
    mediaAssets: any[];
    downloads: any[];
    syncDecisions: any[];
    processingSteps: any[];
  } | null> {
    return this.prisma.job.findUnique({
      where: { id },
      include: {
        mediaAssets: true,
        downloads: true,
        syncDecisions: true,
        processingSteps: {
          orderBy: { order: 'asc' },
        },
      },
    });
  }

  /**
   * Create a new job
   */
  async createJob(input: CreateJobInput): Promise<Job> {
    const initialState: JobState = 'PENDING';
    const now = new Date().toISOString();

    const stateHistoryEntry = {
      from: 'PENDING',
      to: 'PENDING',
      timestamp: now,
      reason: 'Job created',
    };

    return this.prisma.job.create({
      data: {
        type: input.type,
        source: input.source,
        state: initialState,
        priority: input.priority || 'NORMAL',
        options: (input.options || {}) as Prisma.InputJsonValue,
        stateHistory: [stateHistoryEntry as Prisma.InputJsonValue],
        user: {
          connect: { id: input.userId },
        },
      },
    });
  }

  /**
   * Transition job to a new state
   * Uses the state machine to validate transitions
   */
  async transitionState(
    id: string,
    toState: JobState,
    reason?: string,
    metadata?: Record<string, unknown>
  ): Promise<Job> {
    const job = await this.findByIdOrThrow(id);
    const stateMachine = new JobStateMachine(id, job.state);

    // Validate transition
    if (!stateMachine.canTransitionTo(toState)) {
      const allowedStates = getNextStates(job.state);
      throw new Error(
        `Invalid state transition from ${job.state} to ${toState}. ` +
        `Allowed transitions: ${allowedStates.join(', ')}`
      );
    }

    const now = new Date().toISOString();
    const stateHistoryEntry: StateTransitionRecord = {
      from: job.state,
      to: toState,
      timestamp: now,
      reason,
    };

    const currentHistory = (job.stateHistory as unknown as StateTransitionRecord[]) || [];

    // Update job with new state
    const updateData: Prisma.JobUpdateInput = {
      state: toState,
      stateHistory: [...currentHistory, stateHistoryEntry] as unknown as Prisma.InputJsonValue[],
      updatedAt: new Date(),
    };

    // Set startedAt on first transition from PENDING
    if (job.state === 'PENDING' && toState !== 'PENDING') {
      updateData.startedAt = new Date();
    }

    // Set completedAt on terminal states
    if (toState === 'DONE' || toState === 'FAILED') {
      updateData.completedAt = new Date();
    }

    return this.update(id, updateData);
  }

  /**
   * Mark job as failed
   */
  async markFailed(id: string, error: string): Promise<Job> {
    const job = await this.findByIdOrThrow(id);
    
    await this.transitionState(id, 'FAILED', error, { error });
    
    return this.update(id, {
      error,
      retryCount: job.retryCount + 1,
    });
  }

  /**
   * Update job progress (0-100)
   */
  async updateProgress(id: string, progress: number): Promise<Job> {
    const clampedProgress = Math.max(0, Math.min(100, Math.round(progress)));
    return this.update(id, { progress: clampedProgress });
  }

  /**
   * Reset a failed job for retry
   */
  async resetForRetry(id: string): Promise<Job> {
    const job = await this.findByIdOrThrow(id);
    
    if (job.state !== 'FAILED') {
      throw new Error('Can only reset failed jobs');
    }

    const now = new Date().toISOString();
    const stateHistoryEntry = {
      from: 'FAILED',
      to: 'PENDING',
      timestamp: now,
      reason: 'Reset for retry',
    };

    const currentHistory = (job.stateHistory as unknown as StateTransitionRecord[]) || [];

    return this.update(id, {
      state: 'PENDING',
      error: null,
      progress: 0,
      startedAt: null,
      completedAt: null,
      stateHistory: [...currentHistory, stateHistoryEntry] as unknown as Prisma.InputJsonValue[],
    });
  }

  /**
   * Get job statistics
   */
  async getStatistics(): Promise<{
    total: number;
    byState: Record<JobState, number>;
    byType: Record<JobType, number>;
    avgProcessingTime: number;
  }> {
    const [total, stateStats, typeStats, completedJobs] = await Promise.all([
      this.count(),
      this.prisma.job.groupBy({
        by: ['state'],
        _count: true,
      }),
      this.prisma.job.groupBy({
        by: ['type'],
        _count: true,
      }),
      this.prisma.job.findMany({
        where: { state: 'DONE', startedAt: { not: null }, completedAt: { not: null } },
        select: { startedAt: true, completedAt: true },
      }),
    ]);

    const byState = stateStats.reduce((acc, s) => {
      acc[s.state] = s._count;
      return acc;
    }, {} as Record<JobState, number>);

    const byType = typeStats.reduce((acc, t) => {
      acc[t.type] = t._count;
      return acc;
    }, {} as Record<JobType, number>);

    // Calculate average processing time
    let avgProcessingTime = 0;
    if (completedJobs.length > 0) {
      const totalTime = completedJobs.reduce((sum, job) => {
        if (job.startedAt && job.completedAt) {
          return sum + (job.completedAt.getTime() - job.startedAt.getTime());
        }
        return sum;
      }, 0);
      avgProcessingTime = totalTime / completedJobs.length;
    }

    return { total, byState, byType, avgProcessingTime };
  }
}

// Singleton instance
export const jobRepository = new JobRepository();
