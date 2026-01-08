/**
 * rclone Client
 * 
 * Handles Google Drive and other cloud storage downloads via rclone CLI.
 * Docs: https://rclone.org/docs/
 * 
 * Features:
 * - Google Drive downloads (including shared drives)
 * - Progress tracking via stats
 * - Configurable bandwidth limits
 * - Resume support for interrupted transfers
 * - Multi-threaded downloads
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { logger, executeCommand } from '@media-bot/utils';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface RcloneConfig {
  configPath: string;
  binaryPath: string;
  downloadPath?: string;
  transfers?: number;
  checkers?: number;
  bandwidthLimit?: string;
  retries?: number;
  lowLevelRetries?: number;
}

export interface RcloneProgress {
  bytes: number;
  totalBytes: number;
  speed: number;
  eta: number;
  percentage: number;
  transferring?: Array<{
    name: string;
    size: number;
    bytes: number;
    percentage: number;
    speed: number;
    eta: number;
  }>;
}

export interface RcloneTransfer {
  id: string;
  process: ChildProcess;
  source: string;
  destination: string;
  startTime: number;
  cancelled: boolean;
}

export interface RcloneFileInfo {
  Path: string;
  Name: string;
  Size: number;
  MimeType: string;
  ModTime: string;
  IsDir: boolean;
  ID?: string;
}

export class RcloneClient extends EventEmitter {
  private config: RcloneConfig;
  private transfers: Map<string, RcloneTransfer> = new Map();
  private transferCounter: number = 0;

  constructor(config?: Partial<RcloneConfig>) {
    super();
    this.config = {
      configPath: config?.configPath ?? process.env.RCLONE_CONFIG_PATH ?? '/config/rclone/rclone.conf',
      binaryPath: config?.binaryPath ?? process.env.RCLONE_PATH ?? 'rclone',
      downloadPath: config?.downloadPath ?? process.env.RCLONE_DOWNLOAD_PATH,
      transfers: config?.transfers ?? 4,
      checkers: config?.checkers ?? 8,
      bandwidthLimit: config?.bandwidthLimit,
      retries: config?.retries ?? 3,
      lowLevelRetries: config?.lowLevelRetries ?? 10,
    };
  }

  /**
   * Build common rclone arguments
   */
  private getBaseArgs(): string[] {
    const args = [
      '--config', this.config.configPath,
      '--transfers', String(this.config.transfers),
      '--checkers', String(this.config.checkers),
      '--retries', String(this.config.retries),
      '--low-level-retries', String(this.config.lowLevelRetries),
      '--stats', '1s',
      '--stats-one-line',
      '-v',
    ];

    if (this.config.bandwidthLimit) {
      args.push('--bwlimit', this.config.bandwidthLimit);
    }

    return args;
  }

  /**
   * Execute rclone command
   */
  private async exec(args: string[]): Promise<string> {
    const fullArgs = [...this.getBaseArgs(), ...args];
    const result = await executeCommand(this.config.binaryPath, fullArgs);
    return result.stdout;
  }

  /**
   * Check if rclone is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.getVersion();
      return true;
    } catch (error) {
      logger.warn({ error: (error as Error).message }, 'rclone not available');
      return false;
    }
  }

  /**
   * Get rclone version
   */
  async getVersion(): Promise<string> {
    const result = await executeCommand(this.config.binaryPath, ['version']);
    const match = result.stdout.match(/rclone v([\d.]+)/);
    return match?.[1] ?? 'unknown';
  }

  /**
   * List configured remotes
   */
  async listRemotes(): Promise<string[]> {
    const output = await this.exec(['listremotes']);
    return output.split('\n').filter(Boolean).map(r => r.replace(/:$/, ''));
  }

  /**
   * List files/folders in a remote path
   */
  async ls(remotePath: string): Promise<RcloneFileInfo[]> {
    const output = await this.exec(['lsjson', remotePath]);
    return JSON.parse(output) as RcloneFileInfo[];
  }

  /**
   * Get file info
   */
  async stat(remotePath: string): Promise<RcloneFileInfo | null> {
    try {
      const output = await this.exec(['lsjson', remotePath, '--files-only']);
      const files = JSON.parse(output) as RcloneFileInfo[];
      return files[0] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Parse Google Drive link to rclone path
   */
  parseGDriveLink(link: string): { remote: string; fileId: string } | null {
    // Google Drive file link formats:
    // https://drive.google.com/file/d/{fileId}/view
    // https://drive.google.com/open?id={fileId}
    // https://drive.google.com/uc?id={fileId}

    let fileId: string | null = null;

    const patterns = [
      /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
      /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
      /drive\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
      const match = link.match(pattern);
      if (match?.[1]) {
        fileId = match[1];
        break;
      }
    }

    if (!fileId) {
      return null;
    }

    // Default remote name - should be configured
    const remote = process.env.RCLONE_GDRIVE_REMOTE ?? 'gdrive';
    return { remote, fileId };
  }

  /**
   * Copy file from remote to local
   */
  async copy(
    source: string,
    destination: string,
    options: {
      onProgress?: (progress: RcloneProgress) => void;
      createDir?: boolean;
    } = {}
  ): Promise<string> {
    const transferId = `transfer-${++this.transferCounter}`;

    // Ensure destination directory exists
    if (options.createDir !== false) {
      const destDir = path.dirname(destination);
      await fs.mkdir(destDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const args = [
        ...this.getBaseArgs(),
        'copyto',
        source,
        destination,
        '--progress',
      ];

      const process = spawn(this.config.binaryPath, args);
      
      const transfer: RcloneTransfer = {
        id: transferId,
        process,
        source,
        destination,
        startTime: Date.now(),
        cancelled: false,
      };
      
      this.transfers.set(transferId, transfer);

      let stderr = '';

      process.stderr.on('data', (data: Buffer) => {
        const line = data.toString();
        stderr += line;

        // Parse progress from stats line
        const progress = this.parseProgressLine(line);
        if (progress && options.onProgress) {
          options.onProgress(progress);
        }
      });

      process.on('close', (code) => {
        this.transfers.delete(transferId);

        if (transfer.cancelled) {
          reject(new Error('Transfer cancelled'));
          return;
        }

        if (code === 0) {
          logger.info({ source, destination }, 'rclone copy complete');
          resolve(destination);
        } else {
          reject(new Error(`rclone copy failed with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        this.transfers.delete(transferId);
        reject(error);
      });

      logger.info({ transferId, source, destination }, 'rclone copy started');
    });
  }

  /**
   * Sync a remote folder to local
   */
  async sync(
    source: string,
    destination: string,
    options: {
      onProgress?: (progress: RcloneProgress) => void;
    } = {}
  ): Promise<string> {
    const transferId = `sync-${++this.transferCounter}`;

    await fs.mkdir(destination, { recursive: true });

    return new Promise((resolve, reject) => {
      const args = [
        ...this.getBaseArgs(),
        'sync',
        source,
        destination,
        '--progress',
      ];

      const process = spawn(this.config.binaryPath, args);
      
      const transfer: RcloneTransfer = {
        id: transferId,
        process,
        source,
        destination,
        startTime: Date.now(),
        cancelled: false,
      };
      
      this.transfers.set(transferId, transfer);

      let stderr = '';

      process.stderr.on('data', (data: Buffer) => {
        const line = data.toString();
        stderr += line;

        const progress = this.parseProgressLine(line);
        if (progress && options.onProgress) {
          options.onProgress(progress);
        }
      });

      process.on('close', (code) => {
        this.transfers.delete(transferId);

        if (transfer.cancelled) {
          reject(new Error('Sync cancelled'));
          return;
        }

        if (code === 0) {
          logger.info({ source, destination }, 'rclone sync complete');
          resolve(destination);
        } else {
          reject(new Error(`rclone sync failed with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        this.transfers.delete(transferId);
        reject(error);
      });

      logger.info({ transferId, source, destination }, 'rclone sync started');
    });
  }

  /**
   * Download from Google Drive link
   */
  async downloadGDrive(
    link: string,
    destination?: string,
    options: {
      onProgress?: (progress: RcloneProgress) => void;
    } = {}
  ): Promise<string[]> {
    const parsed = this.parseGDriveLink(link);
    if (!parsed) {
      throw new Error(`Invalid Google Drive link: ${link}`);
    }

    // Get file info first
    const source = `${parsed.remote}:${parsed.fileId}`;
    
    // Determine destination
    const destDir = destination ?? this.config.downloadPath ?? '.';
    await fs.mkdir(destDir, { recursive: true });

    // Check if it's a file or folder
    const info = await this.ls(source).catch(() => []);
    
    if (info.length === 0) {
      // Single file - get file name from ID
      const files = await this.exec(['lsjson', `${parsed.remote}:`, '--drive-root-folder-id', parsed.fileId]);
      const fileInfo = JSON.parse(files) as RcloneFileInfo[];
      
      if (fileInfo.length === 0 || !fileInfo[0]) {
        throw new Error(`File not found: ${parsed.fileId}`);
      }

      const fileName = fileInfo[0].Name;
      const destPath = path.join(destDir, fileName);
      
      await this.copy(source, destPath, { onProgress: options.onProgress });
      return [destPath];
    }

    // It's a folder - sync
    await this.sync(source, destDir, { onProgress: options.onProgress });
    
    // Return list of downloaded files
    const downloadedFiles: string[] = [];
    const walkDir = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else {
          downloadedFiles.push(fullPath);
        }
      }
    };
    await walkDir(destDir);
    
    return downloadedFiles;
  }

  /**
   * Parse progress line from rclone output
   */
  private parseProgressLine(line: string): RcloneProgress | null {
    // Example: Transferred: 1.234G / 2.345 GBytes, 52%, 12.345 MBytes/s, ETA 1m23s
    const match = line.match(
      /Transferred:\s*([\d.]+)\s*(\w+)\s*\/\s*([\d.]+)\s*(\w+),\s*([\d.]+)%,\s*([\d.]+)\s*(\w+)\/s,\s*ETA\s*(\S+)/
    );

    if (!match) {
      return null;
    }

    const transferred = match[1] ?? '0';
    const tUnit = match[2] ?? 'Bytes';
    const total = match[3] ?? '0';
    const totalUnit = match[4] ?? 'Bytes';
    const percentage = match[5] ?? '0';
    const speed = match[6] ?? '0';
    const speedUnit = match[7] ?? 'Bytes';
    const eta = match[8] ?? '-';

    return {
      bytes: this.parseSize(transferred, tUnit),
      totalBytes: this.parseSize(total, totalUnit),
      speed: this.parseSize(speed, speedUnit),
      percentage: parseFloat(percentage),
      eta: this.parseEta(eta),
    };
  }

  /**
   * Parse size string to bytes
   */
  private parseSize(value: string, unit: string): number {
    const multipliers: Record<string, number> = {
      'Bytes': 1,
      'KBytes': 1024,
      'MBytes': 1024 * 1024,
      'GBytes': 1024 * 1024 * 1024,
      'TBytes': 1024 * 1024 * 1024 * 1024,
      'B': 1,
      'K': 1024,
      'M': 1024 * 1024,
      'G': 1024 * 1024 * 1024,
      'T': 1024 * 1024 * 1024 * 1024,
    };

    return parseFloat(value) * (multipliers[unit] ?? 1);
  }

  /**
   * Parse ETA string to seconds
   */
  private parseEta(eta: string): number {
    if (eta === '-') return 0;

    let seconds = 0;
    const parts = eta.match(/(\d+)([smhd])/g) ?? [];

    for (const part of parts) {
      const match = part.match(/(\d+)([smhd])/);
      if (match?.[1] && match[2]) {
        const value = parseInt(match[1], 10);
        const unit = match[2];
        switch (unit) {
          case 's': seconds += value; break;
          case 'm': seconds += value * 60; break;
          case 'h': seconds += value * 3600; break;
          case 'd': seconds += value * 86400; break;
        }
      }
    }

    return seconds;
  }

  /**
   * Cancel a transfer
   */
  cancel(transferId: string): boolean {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      return false;
    }

    transfer.cancelled = true;
    transfer.process.kill('SIGTERM');
    
    // Force kill after 5 seconds if still running
    setTimeout(() => {
      if (!transfer.process.killed) {
        transfer.process.kill('SIGKILL');
      }
    }, 5000);

    logger.info({ transferId }, 'rclone transfer cancelled');
    return true;
  }

  /**
   * Cancel all transfers
   */
  cancelAll(): void {
    for (const [id] of this.transfers) {
      this.cancel(id);
    }
  }

  /**
   * Get active transfer IDs
   */
  getActiveTransfers(): string[] {
    return Array.from(this.transfers.keys());
  }

  /**
   * Check remote connectivity
   */
  async checkRemote(remote: string): Promise<boolean> {
    try {
      await this.exec(['lsd', `${remote}:`]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get remote disk usage
   */
  async about(remote: string): Promise<{
    total?: number;
    used?: number;
    free?: number;
    trashed?: number;
  }> {
    const output = await this.exec(['about', `${remote}:`, '--json']);
    return JSON.parse(output);
  }
}

// Singleton instance
export const rcloneClient = new RcloneClient();
