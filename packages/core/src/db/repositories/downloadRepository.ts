/**
 * Download Repository
 * 
 * Handles all download-related database operations.
 * Tracks download progress and status for all downloaders.
 */

import { Download, DownloadStatus, LinkType, DownloaderType, Prisma } from '@prisma/client';
import { BaseRepository } from '../baseRepository.js';

type DownloadCreateInput = Prisma.DownloadCreateInput;
type DownloadUpdateInput = Prisma.DownloadUpdateInput;

export interface CreateDownloadInput {
  jobId: string;
  source: string;
  linkType: LinkType;
  downloader: DownloaderType;
  outputPath?: string;
  totalSize?: bigint;
}

export class DownloadRepository extends BaseRepository<
  Download,
  DownloadCreateInput,
  DownloadUpdateInput
> {
  constructor() {
    super('Download');
  }

  protected getDelegate() {
    return this.prisma.download;
  }

  /**
   * Find downloads by job
   */
  async findByJob(jobId: string): Promise<Download[]> {
    return this.findMany({ jobId });
  }

  /**
   * Find downloads by status
   */
  async findByStatus(status: DownloadStatus): Promise<Download[]> {
    return this.findMany({ status });
  }

  /**
   * Find active downloads
   */
  async findActiveDownloads(): Promise<Download[]> {
    return this.findMany({ status: 'DOWNLOADING' });
  }

  /**
   * Find pending downloads
   */
  async findPendingDownloads(): Promise<Download[]> {
    return this.findMany({ status: 'PENDING' });
  }

  /**
   * Find downloads by downloader type
   */
  async findByDownloader(downloader: DownloaderType): Promise<Download[]> {
    return this.findMany({ downloader });
  }

  /**
   * Find download by external ID (downloader's ID)
   */
  async findByExternalId(externalId: string): Promise<Download | null> {
    return this.findFirst({ externalId });
  }

  /**
   * Create a download
   */
  async createDownload(input: CreateDownloadInput): Promise<Download> {
    return this.prisma.download.create({
      data: {
        source: input.source,
        linkType: input.linkType,
        downloader: input.downloader,
        status: 'PENDING',
        outputPath: input.outputPath,
        totalSize: input.totalSize,
        job: {
          connect: { id: input.jobId },
        },
      },
    });
  }

  /**
   * Update download status
   */
  async updateStatus(id: string, status: DownloadStatus): Promise<Download> {
    const updateData: DownloadUpdateInput = { status };

    if (status === 'DOWNLOADING') {
      updateData.startedAt = new Date();
    } else if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
      updateData.completedAt = new Date();
    }

    return this.update(id, updateData);
  }

  /**
   * Start a download
   */
  async startDownload(id: string, externalId: string): Promise<Download> {
    return this.update(id, {
      status: 'DOWNLOADING',
      externalId,
      startedAt: new Date(),
    });
  }

  /**
   * Update download progress
   */
  async updateProgress(
    id: string,
    progress: number,
    speed?: bigint,
    eta?: number
  ): Promise<Download> {
    const clampedProgress = Math.max(0, Math.min(100, Math.round(progress)));
    return this.update(id, {
      progress: clampedProgress,
      speed,
      eta,
    });
  }

  /**
   * Complete a download
   */
  async completeDownload(id: string, outputPath: string, totalSize: bigint): Promise<Download> {
    return this.update(id, {
      status: 'COMPLETED',
      progress: 100,
      outputPath,
      totalSize,
      completedAt: new Date(),
    });
  }

  /**
   * Fail a download
   */
  async failDownload(id: string, error: string): Promise<Download> {
    const download = await this.findByIdOrThrow(id);
    return this.update(id, {
      status: 'FAILED',
      error,
      retryCount: download.retryCount + 1,
      completedAt: new Date(),
    });
  }

  /**
   * Pause a download
   */
  async pauseDownload(id: string): Promise<Download> {
    return this.updateStatus(id, 'PAUSED');
  }

  /**
   * Resume a download
   */
  async resumeDownload(id: string): Promise<Download> {
    return this.updateStatus(id, 'DOWNLOADING');
  }

  /**
   * Cancel a download
   */
  async cancelDownload(id: string): Promise<Download> {
    return this.updateStatus(id, 'CANCELLED');
  }

  /**
   * Reset a failed download for retry
   */
  async resetForRetry(id: string): Promise<Download> {
    const download = await this.findByIdOrThrow(id);
    
    if (download.status !== 'FAILED') {
      throw new Error('Can only reset failed downloads');
    }

    return this.update(id, {
      status: 'PENDING',
      progress: 0,
      error: null,
      startedAt: null,
      completedAt: null,
    });
  }

  /**
   * Get download statistics
   */
  async getStatistics(): Promise<{
    total: number;
    byStatus: Record<DownloadStatus, number>;
    byDownloader: Record<DownloaderType, number>;
    totalBytesDownloaded: bigint;
  }> {
    const [total, statusStats, downloaderStats, completedDownloads] = await Promise.all([
      this.count(),
      this.prisma.download.groupBy({
        by: ['status'],
        _count: true,
      }),
      this.prisma.download.groupBy({
        by: ['downloader'],
        _count: true,
      }),
      this.prisma.download.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { totalSize: true },
      }),
    ]);

    const byStatus = statusStats.reduce((acc, s) => {
      acc[s.status] = s._count;
      return acc;
    }, {} as Record<DownloadStatus, number>);

    const byDownloader = downloaderStats.reduce((acc, d) => {
      acc[d.downloader] = d._count;
      return acc;
    }, {} as Record<DownloaderType, number>);

    return {
      total,
      byStatus,
      byDownloader,
      totalBytesDownloaded: completedDownloads._sum.totalSize || BigInt(0),
    };
  }
}

// Singleton instance
export const downloadRepository = new DownloadRepository();
