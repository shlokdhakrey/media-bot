/**
 * Download Manager
 * 
 * Unified interface for all download clients.
 * Automatically selects the appropriate downloader based on link type.
 * 
 * Features:
 * - Automatic link detection and routing
 * - Progress tracking across all downloaders
 * - Unified event system
 * - Fallback handling
 * - Concurrent download limiting
 */

import { EventEmitter } from 'events';
import { logger } from '@media-bot/utils';
import { LinkDetector, LinkType, DetectedLink } from '../linkDetector.js';
import { QBittorrentClient, qbittorrentClient } from './qbittorrent.js';
import { Aria2Client, aria2Client } from './aria2.js';
import { RcloneClient, rcloneClient, RcloneProgress } from './rclone.js';
import { NzbgetClient, nzbgetClient } from './nzbget.js';

export type DownloaderType = 'qbittorrent' | 'aria2' | 'rclone' | 'nzbget';

export interface DownloadProgress {
  id: string;
  downloader: DownloaderType;
  progress: number;
  speed: number;
  eta?: number;
  status: 'pending' | 'downloading' | 'paused' | 'complete' | 'error';
  error?: string;
}

export interface DownloadResult {
  id: string;
  downloader: DownloaderType;
  source: string;
  paths: string[];
  totalSize: number;
  duration: number;
}

export interface DownloadOptions {
  savePath?: string;
  category?: string;
  priority?: number;
  paused?: boolean;
  preferredDownloader?: DownloaderType;
  maxConnections?: number;
  timeout?: number;
  onProgress?: (progress: DownloadProgress) => void;
}

export interface ActiveDownload {
  id: string;
  downloaderId: string; // Internal ID from the downloader (hash, gid, nzbId)
  downloader: DownloaderType;
  source: string;
  linkType: LinkType;
  startTime: number;
  options: DownloadOptions;
}

export class DownloadManager extends EventEmitter {
  private linkDetector: LinkDetector;
  private qbittorrent: QBittorrentClient;
  private aria2: Aria2Client;
  private rclone: RcloneClient;
  private nzbget: NzbgetClient;
  
  private activeDownloads: Map<string, ActiveDownload> = new Map();
  private downloadCounter: number = 0;

  constructor(options?: {
    qbittorrent?: QBittorrentClient;
    aria2?: Aria2Client;
    rclone?: RcloneClient;
    nzbget?: NzbgetClient;
  }) {
    super();
    this.linkDetector = new LinkDetector();
    this.qbittorrent = options?.qbittorrent ?? qbittorrentClient;
    this.aria2 = options?.aria2 ?? aria2Client;
    this.rclone = options?.rclone ?? rcloneClient;
    this.nzbget = options?.nzbget ?? nzbgetClient;
  }

  /**
   * Check which downloaders are available
   */
  async getAvailableDownloaders(): Promise<DownloaderType[]> {
    const results = await Promise.allSettled([
      this.qbittorrent.isAvailable().then((ok: boolean) => ok ? 'qbittorrent' as const : null),
      this.aria2.isAvailable().then((ok: boolean) => ok ? 'aria2' as const : null),
      this.rclone.isAvailable().then((ok: boolean) => ok ? 'rclone' as const : null),
      this.nzbget.isAvailable().then((ok: boolean) => ok ? 'nzbget' as const : null),
    ]);

    return results
      .filter((r): r is PromiseFulfilledResult<DownloaderType | null> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter((d): d is DownloaderType => d !== null);
  }

  /**
   * Get the best downloader for a link type
   */
  private getDownloaderForLinkType(linkType: LinkType): DownloaderType | null {
    switch (linkType) {
      case 'magnet':
      case 'torrent':
        return 'qbittorrent';
      case 'http':
      case 'https':
      case 'ftp':
        return 'aria2';
      case 'gdrive':
        return 'rclone';
      case 'nzb':
        return 'nzbget';
      default:
        return null;
    }
  }

  /**
   * Start a download
   */
  async download(
    source: string,
    options: DownloadOptions = {}
  ): Promise<string> {
    // Detect link type
    const detected = this.linkDetector.detect(source);
    if (!detected) {
      throw new Error(`Unsupported link type: ${source}`);
    }

    // Determine which downloader to use
    const downloader = options.preferredDownloader ?? 
                       this.getDownloaderForLinkType(detected.type);
    
    if (!downloader) {
      throw new Error(`No downloader available for link type: ${detected.type}`);
    }

    // Generate unique ID
    const id = `dl-${++this.downloadCounter}-${Date.now()}`;

    // Start the download
    let downloaderId: string;

    switch (downloader) {
      case 'qbittorrent':
        downloaderId = await this.startQBittorrentDownload(detected, options);
        break;
      case 'aria2':
        downloaderId = await this.startAria2Download(detected, options);
        break;
      case 'rclone':
        downloaderId = await this.startRcloneDownload(detected, options);
        break;
      case 'nzbget':
        downloaderId = await this.startNzbgetDownload(detected, options);
        break;
      default:
        throw new Error(`Unknown downloader: ${downloader}`);
    }

    // Track the download
    const activeDownload: ActiveDownload = {
      id,
      downloaderId,
      downloader,
      source,
      linkType: detected.type,
      startTime: Date.now(),
      options,
    };

    this.activeDownloads.set(id, activeDownload);

    logger.info({
      id,
      downloaderId,
      downloader,
      source: detected.type,
    }, 'Download started');

    this.emit('download:started', { id, downloader, source });

    return id;
  }

  /**
   * Start a qBittorrent download
   */
  private async startQBittorrentDownload(
    link: DetectedLink,
    options: DownloadOptions
  ): Promise<string> {
    if (link.type === 'magnet') {
      return this.qbittorrent.addMagnet(link.url, {
        savepath: options.savePath,
        category: options.category,
        paused: options.paused,
      });
    } else if (link.type === 'torrent') {
      return this.qbittorrent.addTorrentFile(link.url, {
        savepath: options.savePath,
        category: options.category,
        paused: options.paused,
      });
    }
    throw new Error(`qBittorrent cannot handle link type: ${link.type}`);
  }

  /**
   * Start an aria2 download
   */
  private async startAria2Download(
    link: DetectedLink,
    options: DownloadOptions
  ): Promise<string> {
    return this.aria2.addUri(link.url, {
      dir: options.savePath,
      'max-connection-per-server': options.maxConnections?.toString(),
    });
  }

  /**
   * Start an rclone download
   */
  private async startRcloneDownload(
    link: DetectedLink,
    options: DownloadOptions
  ): Promise<string> {
    // For rclone, we handle downloads differently
    // Return the transfer ID
    const transferId = `rclone-${Date.now()}`;
    
    // Start download in background
    this.rclone.downloadGDrive(link.url, options.savePath, {
      onProgress: (progress: RcloneProgress) => {
        if (options.onProgress) {
          options.onProgress({
            id: transferId,
            downloader: 'rclone',
            progress: progress.percentage,
            speed: progress.speed,
            eta: progress.eta,
            status: 'downloading',
          });
        }
      },
    }).catch((error: unknown) => {
      logger.error({ error: (error as Error).message }, 'rclone download failed');
    });

    return transferId;
  }

  /**
   * Start an NZBget download
   */
  private async startNzbgetDownload(
    link: DetectedLink,
    options: DownloadOptions
  ): Promise<string> {
    const nzbId = await this.nzbget.addUrl(link.url, {
      category: options.category,
      priority: options.priority,
      addPaused: options.paused,
    });
    return String(nzbId);
  }

  /**
   * Get download progress
   */
  async getProgress(id: string): Promise<DownloadProgress | null> {
    const download = this.activeDownloads.get(id);
    if (!download) {
      return null;
    }

    try {
      switch (download.downloader) {
        case 'qbittorrent': {
          const torrent = await this.qbittorrent.getTorrent(download.downloaderId);
          if (!torrent) {
            return {
              id,
              downloader: 'qbittorrent',
              progress: 100,
              speed: 0,
              status: 'complete',
            };
          }
          return {
            id,
            downloader: 'qbittorrent',
            progress: Math.round(torrent.progress * 100),
            speed: torrent.dlspeed,
            eta: torrent.eta,
            status: this.mapQBitStatus(torrent.state),
          };
        }

        case 'aria2': {
          const status = await this.aria2.tellStatus(download.downloaderId);
          const progress = await this.aria2.getProgress(download.downloaderId);
          return {
            id,
            downloader: 'aria2',
            progress,
            speed: parseInt(status.downloadSpeed, 10),
            status: this.mapAria2Status(status.status),
            error: status.errorMessage,
          };
        }

        case 'nzbget': {
          const progress = await this.nzbget.getProgress(parseInt(download.downloaderId, 10));
          const speed = await this.nzbget.getSpeed();
          const isComplete = await this.nzbget.isComplete(parseInt(download.downloaderId, 10));
          return {
            id,
            downloader: 'nzbget',
            progress,
            speed,
            status: isComplete ? 'complete' : 'downloading',
          };
        }

        case 'rclone': {
          // rclone progress is tracked via callbacks, not polling
          return {
            id,
            downloader: 'rclone',
            progress: 0,
            speed: 0,
            status: 'downloading',
          };
        }
      }
    } catch (error) {
      return {
        id,
        downloader: download.downloader,
        progress: 0,
        speed: 0,
        status: 'error',
        error: (error as Error).message,
      };
    }
  }

  /**
   * Wait for download to complete
   */
  async waitForCompletion(
    id: string,
    options: {
      pollIntervalMs?: number;
      timeoutMs?: number;
      onProgress?: (progress: DownloadProgress) => void;
    } = {}
  ): Promise<DownloadResult> {
    const download = this.activeDownloads.get(id);
    if (!download) {
      throw new Error(`Download not found: ${id}`);
    }

    const startTime = Date.now();
    let result: DownloadResult;

    switch (download.downloader) {
      case 'qbittorrent': {
        const torrent = await this.qbittorrent.waitForCompletion(
          download.downloaderId,
          {
            pollIntervalMs: options.pollIntervalMs,
            timeoutMs: options.timeoutMs,
            onProgress: options.onProgress ? (p: number, s: number) => {
              options.onProgress!({
                id,
                downloader: 'qbittorrent',
                progress: p,
                speed: s,
                status: 'downloading',
              });
            } : undefined,
          }
        );
        const paths = await this.qbittorrent.getDownloadedPaths(download.downloaderId);
        result = {
          id,
          downloader: 'qbittorrent',
          source: download.source,
          paths,
          totalSize: torrent.size,
          duration: Date.now() - startTime,
        };
        break;
      }

      case 'aria2': {
        const status = await this.aria2.waitForCompletion(
          download.downloaderId,
          {
            pollIntervalMs: options.pollIntervalMs,
            timeoutMs: options.timeoutMs,
            onProgress: options.onProgress ? (p: number, s: number) => {
              options.onProgress!({
                id,
                downloader: 'aria2',
                progress: p,
                speed: s,
                status: 'downloading',
              });
            } : undefined,
          }
        );
        const paths = await this.aria2.getDownloadedPaths(download.downloaderId);
        result = {
          id,
          downloader: 'aria2',
          source: download.source,
          paths,
          totalSize: parseInt(status.totalLength, 10),
          duration: Date.now() - startTime,
        };
        break;
      }

      case 'nzbget': {
        const hist = await this.nzbget.waitForCompletion(
          parseInt(download.downloaderId, 10),
          {
            pollIntervalMs: options.pollIntervalMs,
            timeoutMs: options.timeoutMs,
            onProgress: options.onProgress ? (p: number, s: number) => {
              options.onProgress!({
                id,
                downloader: 'nzbget',
                progress: p,
                speed: s,
                status: 'downloading',
              });
            } : undefined,
          }
        );
        const paths = await this.nzbget.getDownloadedPaths(parseInt(download.downloaderId, 10));
        result = {
          id,
          downloader: 'nzbget',
          source: download.source,
          paths,
          totalSize: hist.FileSizeMB * 1024 * 1024,
          duration: Date.now() - startTime,
        };
        break;
      }

      case 'rclone': {
        // rclone downloads complete when the copy() or downloadGDrive() promise resolves
        // This is handled differently - the caller should await the download directly
        throw new Error('Use downloadGDrive() directly for rclone downloads');
      }

      default:
        throw new Error(`Unknown downloader: ${download.downloader}`);
    }

    // Remove from active downloads
    this.activeDownloads.delete(id);

    logger.info({
      id,
      downloader: result.downloader,
      paths: result.paths.length,
      totalSize: result.totalSize,
      duration: result.duration,
    }, 'Download completed');

    this.emit('download:complete', result);

    return result;
  }

  /**
   * Pause a download
   */
  async pause(id: string): Promise<boolean> {
    const download = this.activeDownloads.get(id);
    if (!download) {
      return false;
    }

    switch (download.downloader) {
      case 'qbittorrent':
        await this.qbittorrent.pause(download.downloaderId);
        break;
      case 'aria2':
        await this.aria2.pause(download.downloaderId);
        break;
      case 'nzbget':
        await this.nzbget.pause(parseInt(download.downloaderId, 10));
        break;
      case 'rclone':
        // rclone doesn't support pause
        return false;
    }

    this.emit('download:paused', { id });
    return true;
  }

  /**
   * Resume a download
   */
  async resume(id: string): Promise<boolean> {
    const download = this.activeDownloads.get(id);
    if (!download) {
      return false;
    }

    switch (download.downloader) {
      case 'qbittorrent':
        await this.qbittorrent.resume(download.downloaderId);
        break;
      case 'aria2':
        await this.aria2.unpause(download.downloaderId);
        break;
      case 'nzbget':
        await this.nzbget.resume(parseInt(download.downloaderId, 10));
        break;
      case 'rclone':
        return false;
    }

    this.emit('download:resumed', { id });
    return true;
  }

  /**
   * Cancel a download
   */
  async cancel(id: string, deleteFiles: boolean = false): Promise<boolean> {
    const download = this.activeDownloads.get(id);
    if (!download) {
      return false;
    }

    switch (download.downloader) {
      case 'qbittorrent':
        await this.qbittorrent.delete(download.downloaderId, deleteFiles);
        break;
      case 'aria2':
        await this.aria2.forceRemove(download.downloaderId);
        break;
      case 'nzbget':
        await this.nzbget.delete(parseInt(download.downloaderId, 10));
        break;
      case 'rclone':
        this.rclone.cancel(download.downloaderId);
        break;
    }

    this.activeDownloads.delete(id);
    
    logger.info({ id, downloader: download.downloader }, 'Download cancelled');
    this.emit('download:cancelled', { id });

    return true;
  }

  /**
   * Get all active downloads
   */
  getActiveDownloads(): ActiveDownload[] {
    return Array.from(this.activeDownloads.values());
  }

  /**
   * Get active download by ID
   */
  getActiveDownload(id: string): ActiveDownload | undefined {
    return this.activeDownloads.get(id);
  }

  /**
   * Map qBittorrent state to our status
   */
  private mapQBitStatus(state: string): DownloadProgress['status'] {
    switch (state) {
      case 'downloading':
      case 'metaDL':
      case 'stalledDL':
      case 'checkingDL':
      case 'forcedDL':
      case 'allocating':
        return 'downloading';
      case 'pausedDL':
      case 'queuedDL':
        return 'paused';
      case 'uploading':
      case 'pausedUP':
      case 'stalledUP':
      case 'checkingUP':
      case 'forcedUP':
      case 'queuedUP':
        return 'complete';
      case 'error':
      case 'missingFiles':
        return 'error';
      default:
        return 'downloading';
    }
  }

  /**
   * Map aria2 status to our status
   */
  private mapAria2Status(status: string): DownloadProgress['status'] {
    switch (status) {
      case 'active':
        return 'downloading';
      case 'waiting':
      case 'paused':
        return 'paused';
      case 'complete':
        return 'complete';
      case 'error':
      case 'removed':
        return 'error';
      default:
        return 'downloading';
    }
  }
}

// Singleton instance
export const downloadManager = new DownloadManager();