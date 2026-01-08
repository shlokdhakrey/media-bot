/**
 * MediaAsset Repository
 * 
 * Handles all media asset database operations.
 * Tracks files through all processing stages.
 */

import { MediaAsset, AssetType, AssetStatus, Prisma } from '@prisma/client';
import { BaseRepository } from '../baseRepository.js';

type MediaAssetCreateInput = Prisma.MediaAssetCreateInput;
type MediaAssetUpdateInput = Prisma.MediaAssetUpdateInput;

export interface CreateMediaAssetInput {
  jobId: string;
  fileName: string;
  filePath: string;
  fileSize: bigint;
  type: AssetType;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

export class MediaAssetRepository extends BaseRepository<
  MediaAsset,
  MediaAssetCreateInput,
  MediaAssetUpdateInput
> {
  constructor() {
    super('MediaAsset');
  }

  protected getDelegate() {
    return this.prisma.mediaAsset;
  }

  /**
   * Find assets by job
   */
  async findByJob(jobId: string): Promise<MediaAsset[]> {
    return this.findMany({ jobId });
  }

  /**
   * Find assets by type
   */
  async findByType(jobId: string, type: AssetType): Promise<MediaAsset[]> {
    return this.findMany({ jobId, type });
  }

  /**
   * Find video assets for a job
   */
  async findVideoAssets(jobId: string): Promise<MediaAsset[]> {
    return this.findByType(jobId, 'VIDEO');
  }

  /**
   * Find audio assets for a job
   */
  async findAudioAssets(jobId: string): Promise<MediaAsset[]> {
    return this.findByType(jobId, 'AUDIO');
  }

  /**
   * Find subtitle assets for a job
   */
  async findSubtitleAssets(jobId: string): Promise<MediaAsset[]> {
    return this.findByType(jobId, 'SUBTITLE');
  }

  /**
   * Find assets by status
   */
  async findByStatus(status: AssetStatus): Promise<MediaAsset[]> {
    return this.findMany({ status });
  }

  /**
   * Find pending assets (ready for processing)
   */
  async findPendingAssets(jobId: string): Promise<MediaAsset[]> {
    return this.findMany({ jobId, status: 'PENDING' });
  }

  /**
   * Find ready assets (processed and ready to use)
   */
  async findReadyAssets(jobId: string): Promise<MediaAsset[]> {
    return this.findMany({ jobId, status: 'READY' });
  }

  /**
   * Find derived assets (children of a parent asset)
   */
  async findDerivedAssets(parentId: string): Promise<MediaAsset[]> {
    return this.findMany({ parentId });
  }

  /**
   * Get asset with derived assets
   */
  async findByIdWithDerived(id: string): Promise<MediaAsset & { derivedAssets: MediaAsset[] } | null> {
    return this.prisma.mediaAsset.findUnique({
      where: { id },
      include: { derivedAssets: true },
    });
  }

  /**
   * Create a media asset
   */
  async createAsset(input: CreateMediaAssetInput): Promise<MediaAsset> {
    return this.prisma.mediaAsset.create({
      data: {
        fileName: input.fileName,
        filePath: input.filePath,
        fileSize: input.fileSize,
        type: input.type,
        status: 'PENDING',
        metadata: (input.metadata || {}) as Prisma.InputJsonValue,
        job: {
          connect: { id: input.jobId },
        },
        ...(input.parentId && {
          parent: {
            connect: { id: input.parentId },
          },
        }),
      },
    });
  }

  /**
   * Update asset status
   */
  async updateStatus(id: string, status: AssetStatus): Promise<MediaAsset> {
    return this.update(id, { status });
  }

  /**
   * Mark asset as ready
   */
  async markReady(id: string): Promise<MediaAsset> {
    return this.updateStatus(id, 'READY');
  }

  /**
   * Mark asset as failed
   */
  async markFailed(id: string): Promise<MediaAsset> {
    return this.updateStatus(id, 'FAILED');
  }

  /**
   * Mark asset as archived
   */
  async markArchived(id: string): Promise<MediaAsset> {
    return this.updateStatus(id, 'ARCHIVED');
  }

  /**
   * Update asset metadata
   */
  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<MediaAsset> {
    const asset = await this.findByIdOrThrow(id);
    const currentMetadata = asset.metadata as Record<string, unknown>;
    const mergedMetadata = { ...currentMetadata, ...metadata };
    return this.update(id, { metadata: mergedMetadata as Prisma.InputJsonValue });
  }

  /**
   * Store FFProbe result
   */
  async storeFFProbeResult(id: string, probeResult: Record<string, unknown>): Promise<MediaAsset> {
    return this.update(id, { rawFFProbe: probeResult as Prisma.InputJsonValue });
  }

  /**
   * Store MediaInfo result
   */
  async storeMediaInfoResult(id: string, mediaInfoResult: Record<string, unknown>): Promise<MediaAsset> {
    return this.update(id, { rawMediaInfo: mediaInfoResult as Prisma.InputJsonValue });
  }

  /**
   * Update hashes
   */
  async updateHashes(
    id: string,
    hashes: { md5?: string; sha1?: string; sha256?: string }
  ): Promise<MediaAsset> {
    return this.update(id, hashes);
  }

  /**
   * Find asset by file path
   */
  async findByPath(filePath: string): Promise<MediaAsset | null> {
    return this.findFirst({ filePath });
  }

  /**
   * Get total size of assets for a job
   */
  async getTotalSize(jobId: string): Promise<bigint> {
    const result = await this.prisma.mediaAsset.aggregate({
      where: { jobId },
      _sum: { fileSize: true },
    });
    return result._sum.fileSize || BigInt(0);
  }

  /**
   * Get asset count by type for a job
   */
  async getCountByType(jobId: string): Promise<Record<AssetType, number>> {
    const stats = await this.prisma.mediaAsset.groupBy({
      by: ['type'],
      where: { jobId },
      _count: true,
    });

    return stats.reduce((acc, s) => {
      acc[s.type] = s._count;
      return acc;
    }, {} as Record<AssetType, number>);
  }
}

// Singleton instance
export const mediaAssetRepository = new MediaAssetRepository();
