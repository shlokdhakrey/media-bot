/**
 * SyncDecision Repository
 * 
 * Handles all sync decision database operations.
 * Critical for auditing sync analysis and corrections.
 */

import { SyncDecision, CorrectionType, Prisma } from '@prisma/client';
import { BaseRepository } from '../baseRepository.js';

type SyncDecisionCreateInput = Prisma.SyncDecisionCreateInput;
type SyncDecisionUpdateInput = Prisma.SyncDecisionUpdateInput;

export interface CreateSyncDecisionInput {
  jobId: string;
  videoAssetId: string;
  audioAssetId?: string;
  needsCorrection: boolean;
  correctionType?: CorrectionType;
  correctionParams?: Record<string, unknown>;
  analysisData: Record<string, unknown>;
  confidence: number;
}

export class SyncDecisionRepository extends BaseRepository<
  SyncDecision,
  SyncDecisionCreateInput,
  SyncDecisionUpdateInput
> {
  constructor() {
    super('SyncDecision');
  }

  protected getDelegate() {
    return this.prisma.syncDecision;
  }

  /**
   * Find sync decisions by job
   */
  async findByJob(jobId: string): Promise<SyncDecision[]> {
    return this.findMany({ jobId });
  }

  /**
   * Find sync decisions by video asset
   */
  async findByVideoAsset(videoAssetId: string): Promise<SyncDecision[]> {
    return this.findMany({ videoAssetId });
  }

  /**
   * Find unapplied decisions
   */
  async findUnapplied(jobId: string): Promise<SyncDecision[]> {
    return this.findMany({ jobId, wasApplied: false });
  }

  /**
   * Find applied decisions
   */
  async findApplied(jobId: string): Promise<SyncDecision[]> {
    return this.findMany({ jobId, wasApplied: true });
  }

  /**
   * Find decisions requiring correction
   */
  async findNeedingCorrection(jobId: string): Promise<SyncDecision[]> {
    return this.findMany({ jobId, needsCorrection: true, wasApplied: false });
  }

  /**
   * Find manual overrides
   */
  async findManualOverrides(jobId: string): Promise<SyncDecision[]> {
    return this.findMany({ jobId, isManualOverride: true });
  }

  /**
   * Get latest decision for a video asset
   */
  async getLatestForVideoAsset(videoAssetId: string): Promise<SyncDecision | null> {
    return this.prisma.syncDecision.findFirst({
      where: { videoAssetId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Create a sync decision
   */
  async createDecision(input: CreateSyncDecisionInput): Promise<SyncDecision> {
    return this.prisma.syncDecision.create({
      data: {
        needsCorrection: input.needsCorrection,
        correctionType: input.correctionType,
        correctionParams: (input.correctionParams || {}) as Prisma.InputJsonValue,
        analysisData: input.analysisData as Prisma.InputJsonValue,
        confidence: input.confidence,
        job: {
          connect: { id: input.jobId },
        },
        videoAsset: {
          connect: { id: input.videoAssetId },
        },
      },
    });
  }

  /**
   * Mark decision as applied
   */
  async markApplied(id: string): Promise<SyncDecision> {
    return this.update(id, {
      wasApplied: true,
      appliedAt: new Date(),
    });
  }

  /**
   * Create manual override
   */
  async createManualOverride(
    jobId: string,
    videoAssetId: string,
    correctionType: CorrectionType,
    correctionParams: Record<string, unknown>,
    reason: string
  ): Promise<SyncDecision> {
    return this.prisma.syncDecision.create({
      data: {
        needsCorrection: correctionType !== 'NONE',
        correctionType,
        correctionParams: correctionParams as Prisma.InputJsonValue,
        analysisData: { manualOverride: true } as Prisma.InputJsonValue,
        confidence: 100, // Manual overrides have 100% confidence
        isManualOverride: true,
        overrideReason: reason,
        job: {
          connect: { id: jobId },
        },
        videoAsset: {
          connect: { id: videoAssetId },
        },
      },
    });
  }

  /**
   * Get decision with assets
   */
  async findByIdWithAssets(id: string): Promise<SyncDecision & {
    videoAsset: any;
  } | null> {
    return this.prisma.syncDecision.findUnique({
      where: { id },
      include: {
        videoAsset: true,
      },
    });
  }

  /**
   * Get decisions by correction type
   */
  async findByCorrectionType(correctionType: CorrectionType): Promise<SyncDecision[]> {
    return this.findMany({ correctionType });
  }

  /**
   * Get average confidence for job
   */
  async getAverageConfidence(jobId: string): Promise<number> {
    const result = await this.prisma.syncDecision.aggregate({
      where: { jobId },
      _avg: { confidence: true },
    });
    return result._avg.confidence || 0;
  }

  /**
   * Get sync statistics
   */
  async getStatistics(): Promise<{
    total: number;
    byCorrectionType: Record<CorrectionType, number>;
    averageConfidence: number;
    manualOverrideCount: number;
    appliedCount: number;
  }> {
    const [total, typeStats, avgConfidence, manualCount, appliedCount] = await Promise.all([
      this.count(),
      this.prisma.syncDecision.groupBy({
        by: ['correctionType'],
        _count: true,
      }),
      this.prisma.syncDecision.aggregate({
        _avg: { confidence: true },
      }),
      this.count({ isManualOverride: true }),
      this.count({ wasApplied: true }),
    ]);

    const byCorrectionType = typeStats.reduce((acc, t) => {
      if (t.correctionType) {
        acc[t.correctionType] = t._count;
      }
      return acc;
    }, {} as Record<CorrectionType, number>);

    return {
      total,
      byCorrectionType,
      averageConfidence: avgConfidence._avg.confidence || 0,
      manualOverrideCount: manualCount,
      appliedCount,
    };
  }
}

// Singleton instance
export const syncDecisionRepository = new SyncDecisionRepository();
