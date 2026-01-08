/**
 * Downloader Router
 * 
 * Routes download requests to the appropriate client based on link type.
 */

import { detectLinkType, getDownloaderForType } from './detection.js';
import { QBittorrentClient } from './clients/qbittorrent.js';
import { Aria2Client } from './clients/aria2.js';
import { RcloneClient } from './clients/rclone.js';
import { NzbgetClient } from './clients/nzbget.js';

export interface DownloadOptions {
  jobId: string;
  outputDir: string;
  priority?: 'low' | 'normal' | 'high';
}

export interface DownloadResult {
  success: boolean;
  files: string[];
  totalSize: number;
  duration: number;
  error?: string;
}

export class DownloaderRouter {
  private qbittorrent: QBittorrentClient;
  private aria2: Aria2Client;
  private rclone: RcloneClient;
  private nzbget: NzbgetClient;

  constructor() {
    this.qbittorrent = new QBittorrentClient();
    this.aria2 = new Aria2Client();
    this.rclone = new RcloneClient();
    this.nzbget = new NzbgetClient();
  }

  /**
   * Start a download, automatically routing to the correct client
   */
  async download(link: string, options: DownloadOptions): Promise<DownloadResult> {
    const linkType = detectLinkType(link);
    const downloader = getDownloaderForType(linkType);

    const startTime = Date.now();

    try {
      let files: string[] = [];

      switch (downloader) {
        case 'qbittorrent': {
          const hash = await this.qbittorrent.addMagnet(link, { savepath: options.outputDir });
          const torrent = await this.qbittorrent.waitForCompletion(hash);
          files = await this.qbittorrent.getDownloadedPaths(torrent.hash);
          break;
        }
        case 'aria2': {
          const gid = await this.aria2.addUri(link, { dir: options.outputDir });
          await this.aria2.waitForCompletion(gid);
          files = await this.aria2.getDownloadedPaths(gid);
          break;
        }
        case 'rclone': {
          files = await this.rclone.downloadGDrive(link, options.outputDir);
          break;
        }
        case 'nzbget': {
          const nzbId = await this.nzbget.addUrl(link, { category: options.jobId });
          await this.nzbget.waitForCompletion(nzbId);
          files = await this.nzbget.getDownloadedPaths(nzbId);
          break;
        }
        default:
          throw new Error(`Unknown downloader: ${downloader}`);
      }

      return {
        success: true,
        files,
        totalSize: 0, // TODO: Calculate total size
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        files: [],
        totalSize: 0,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if all downloaders are available
   */
  async healthCheck(): Promise<Record<string, boolean>> {
    const [qb, aria2, rclone, nzbget] = await Promise.all([
      this.qbittorrent.isAvailable(),
      this.aria2.isAvailable(),
      this.rclone.isAvailable(),
      this.nzbget.isAvailable(),
    ]);

    return {
      qbittorrent: qb,
      aria2: aria2,
      rclone: rclone,
      nzbget: nzbget,
    };
  }
}
