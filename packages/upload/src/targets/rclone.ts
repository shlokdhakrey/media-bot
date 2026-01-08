/**
 * Rclone Uploader
 * 
 * Upload to cloud storage (Google Drive, etc.) via rclone.
 */

import { executeCommand } from '@media-bot/utils';

export interface RcloneConfig {
  remoteName: string;
  configPath?: string;
  targetFolder: string;
}

export class RcloneUploader {
  private remoteName: string;
  private configPath: string;
  private targetFolder: string;

  constructor(config: RcloneConfig) {
    this.remoteName = config.remoteName;
    this.configPath = config.configPath ?? '/config/rclone/rclone.conf';
    this.targetFolder = config.targetFolder;
  }

  /**
   * Upload a file or directory to the remote
   */
  async upload(
    localPath: string,
    remotePath?: string
  ): Promise<{ remote: string; path: string; success: boolean }> {
    const destination = remotePath 
      ? `${this.remoteName}:${this.targetFolder}/${remotePath}`
      : `${this.remoteName}:${this.targetFolder}`;

    const args = [
      'copy',
      '--config', this.configPath,
      '--progress',
      '--stats', '1s',
      localPath,
      destination,
    ];

    const result = await executeCommand('rclone', args, {
      timeout: 3600000, // 1 hour
    });

    return {
      remote: this.remoteName,
      path: destination,
      success: result.exitCode === 0,
    };
  }

  /**
   * Check if rclone and remote are accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      const result = await executeCommand('rclone', [
        'lsd',
        '--config', this.configPath,
        `${this.remoteName}:`,
        '--max-depth', '1',
      ], {
        timeout: 30000,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * List files in remote directory
   */
  async list(remotePath: string = ''): Promise<string[]> {
    const destination = `${this.remoteName}:${this.targetFolder}/${remotePath}`;
    
    const result = await executeCommand('rclone', [
      'lsf',
      '--config', this.configPath,
      destination,
    ], {
      timeout: 60000,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Failed to list remote: ${result.stderr}`);
    }

    return result.stdout.trim().split('\n').filter(Boolean);
  }
}
