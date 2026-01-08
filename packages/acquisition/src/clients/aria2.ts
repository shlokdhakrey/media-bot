/**
 * aria2 Client
 * 
 * Handles HTTP/HTTPS/FTP downloads via aria2 JSON-RPC API.
 * API Docs: https://aria2.github.io/manual/en/html/aria2c.html#rpc-interface
 * 
 * Features:
 * - JSON-RPC 2.0 interface
 * - Multi-connection downloads
 * - Metalink and BitTorrent support
 * - Progress tracking and speed monitoring
 * - Pause/resume/cancel operations
 */

import { logger } from '@media-bot/utils';

export interface Aria2Config {
  host: string;
  port: number;
  secret: string;
  downloadPath?: string;
  maxConnections?: number;
  splitSize?: string;
}

export interface Aria2Status {
  gid: string;
  status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed';
  totalLength: string;
  completedLength: string;
  uploadLength: string;
  downloadSpeed: string;
  uploadSpeed: string;
  connections: string;
  numSeeders?: string;
  errorCode?: string;
  errorMessage?: string;
  dir: string;
  files: Aria2File[];
  bittorrent?: {
    info?: {
      name: string;
    };
  };
}

export interface Aria2File {
  index: string;
  path: string;
  length: string;
  completedLength: string;
  selected: string;
  uris: Array<{
    uri: string;
    status: 'used' | 'waiting';
  }>;
}

export interface Aria2GlobalStat {
  downloadSpeed: string;
  uploadSpeed: string;
  numActive: string;
  numWaiting: string;
  numStopped: string;
  numStoppedTotal: string;
}

export interface Aria2DownloadOptions {
  dir?: string;
  out?: string;
  'max-connection-per-server'?: string;
  split?: string;
  'min-split-size'?: string;
  'user-agent'?: string;
  header?: string[];
  referer?: string;
  'check-integrity'?: 'true' | 'false';
  'continue'?: 'true' | 'false';
  'max-tries'?: string;
  'retry-wait'?: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: unknown[];
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

export class Aria2Client {
  private config: Aria2Config;
  private requestId: number = 0;

  constructor(config?: Partial<Aria2Config>) {
    this.config = {
      host: config?.host ?? process.env.ARIA2_HOST ?? 'localhost',
      port: config?.port ?? parseInt(process.env.ARIA2_PORT ?? '6800', 10),
      secret: config?.secret ?? process.env.ARIA2_SECRET ?? '',
      downloadPath: config?.downloadPath ?? process.env.ARIA2_DOWNLOAD_PATH,
      maxConnections: config?.maxConnections ?? 16,
      splitSize: config?.splitSize ?? '10M',
    };
  }

  private get rpcUrl(): string {
    return `http://${this.config.host}:${this.config.port}/jsonrpc`;
  }

  private get secretToken(): string {
    return this.config.secret ? `token:${this.config.secret}` : '';
  }

  /**
   * Make a JSON-RPC call to aria2
   */
  private async rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const id = `media-bot-${++this.requestId}`;
    
    // Prepend secret token if configured
    const fullParams = this.secretToken ? [this.secretToken, ...params] : params;

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method: `aria2.${method}`,
      params: fullParams,
    };

    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`aria2 RPC error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as JsonRpcResponse<T>;

    if (result.error) {
      throw new Error(`aria2 error ${result.error.code}: ${result.error.message}`);
    }

    return result.result as T;
  }

  /**
   * Check if aria2 is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.getVersion();
      return true;
    } catch (error) {
      logger.warn({ error: (error as Error).message }, 'aria2 not available');
      return false;
    }
  }

  /**
   * Get aria2 version
   */
  async getVersion(): Promise<{ version: string; enabledFeatures: string[] }> {
    return this.rpc('getVersion');
  }

  /**
   * Get global statistics
   */
  async getGlobalStat(): Promise<Aria2GlobalStat> {
    return this.rpc('getGlobalStat');
  }

  /**
   * Add a URI for download (HTTP/HTTPS/FTP)
   */
  async addUri(
    uris: string | string[],
    options: Aria2DownloadOptions = {}
  ): Promise<string> {
    const uriList = Array.isArray(uris) ? uris : [uris];
    
    const downloadOptions: Aria2DownloadOptions = {
      ...options,
    };

    // Apply default download path
    if (this.config.downloadPath && !options.dir) {
      downloadOptions.dir = this.config.downloadPath;
    }

    // Apply default connection settings
    if (this.config.maxConnections && !options['max-connection-per-server']) {
      downloadOptions['max-connection-per-server'] = String(this.config.maxConnections);
    }
    if (this.config.splitSize && !options['min-split-size']) {
      downloadOptions['min-split-size'] = this.config.splitSize;
    }

    const gid = await this.rpc<string>('addUri', [uriList, downloadOptions]);
    
    logger.info({ gid, uri: uriList[0] }, 'URI added to aria2');
    return gid;
  }

  /**
   * Add a torrent file
   */
  async addTorrent(
    torrentPath: string,
    options: Aria2DownloadOptions = {}
  ): Promise<string> {
    const fs = await import('fs/promises');
    const content = await fs.readFile(torrentPath);
    const base64 = content.toString('base64');

    const downloadOptions: Aria2DownloadOptions = {
      ...options,
    };

    if (this.config.downloadPath && !options.dir) {
      downloadOptions.dir = this.config.downloadPath;
    }

    const gid = await this.rpc<string>('addTorrent', [base64, [], downloadOptions]);
    
    logger.info({ gid, torrentPath }, 'Torrent added to aria2');
    return gid;
  }

  /**
   * Add a metalink file
   */
  async addMetalink(
    metalinkPath: string,
    options: Aria2DownloadOptions = {}
  ): Promise<string[]> {
    const fs = await import('fs/promises');
    const content = await fs.readFile(metalinkPath);
    const base64 = content.toString('base64');

    const gids = await this.rpc<string[]>('addMetalink', [base64, options]);
    
    logger.info({ gids, metalinkPath }, 'Metalink added to aria2');
    return gids;
  }

  /**
   * Get download status
   */
  async tellStatus(gid: string): Promise<Aria2Status> {
    return this.rpc('tellStatus', [gid]);
  }

  /**
   * Get progress (0-100)
   */
  async getProgress(gid: string): Promise<number> {
    const status = await this.tellStatus(gid);
    const total = BigInt(status.totalLength);
    const completed = BigInt(status.completedLength);
    
    if (total === BigInt(0)) {
      return 0;
    }
    
    return Number((completed * BigInt(100)) / total);
  }

  /**
   * Get download speed in bytes/second
   */
  async getSpeed(gid: string): Promise<{ download: number; upload: number }> {
    const status = await this.tellStatus(gid);
    return {
      download: parseInt(status.downloadSpeed, 10),
      upload: parseInt(status.uploadSpeed, 10),
    };
  }

  /**
   * Check if download is complete
   */
  async isComplete(gid: string): Promise<boolean> {
    const status = await this.tellStatus(gid);
    return status.status === 'complete';
  }

  /**
   * Check if download has error
   */
  async hasError(gid: string): Promise<{ hasError: boolean; message?: string }> {
    const status = await this.tellStatus(gid);
    if (status.status === 'error') {
      return {
        hasError: true,
        message: status.errorMessage || `Error code: ${status.errorCode}`,
      };
    }
    return { hasError: false };
  }

  /**
   * Get active downloads
   */
  async tellActive(): Promise<Aria2Status[]> {
    return this.rpc('tellActive');
  }

  /**
   * Get waiting downloads
   */
  async tellWaiting(offset: number = 0, num: number = 100): Promise<Aria2Status[]> {
    return this.rpc('tellWaiting', [offset, num]);
  }

  /**
   * Get stopped downloads
   */
  async tellStopped(offset: number = 0, num: number = 100): Promise<Aria2Status[]> {
    return this.rpc('tellStopped', [offset, num]);
  }

  /**
   * Pause a download
   */
  async pause(gid: string): Promise<string> {
    const result = await this.rpc<string>('pause', [gid]);
    logger.info({ gid }, 'Download paused');
    return result;
  }

  /**
   * Force pause (don't wait for completion of current piece)
   */
  async forcePause(gid: string): Promise<string> {
    const result = await this.rpc<string>('forcePause', [gid]);
    logger.info({ gid }, 'Download force paused');
    return result;
  }

  /**
   * Pause all downloads
   */
  async pauseAll(): Promise<string> {
    return this.rpc('pauseAll');
  }

  /**
   * Resume a paused download
   */
  async unpause(gid: string): Promise<string> {
    const result = await this.rpc<string>('unpause', [gid]);
    logger.info({ gid }, 'Download resumed');
    return result;
  }

  /**
   * Resume all paused downloads
   */
  async unpauseAll(): Promise<string> {
    return this.rpc('unpauseAll');
  }

  /**
   * Remove a download
   */
  async remove(gid: string): Promise<string> {
    const result = await this.rpc<string>('remove', [gid]);
    logger.info({ gid }, 'Download removed');
    return result;
  }

  /**
   * Force remove (don't wait for completion)
   */
  async forceRemove(gid: string): Promise<string> {
    const result = await this.rpc<string>('forceRemove', [gid]);
    logger.info({ gid }, 'Download force removed');
    return result;
  }

  /**
   * Remove download result from memory
   */
  async removeDownloadResult(gid: string): Promise<string> {
    return this.rpc('removeDownloadResult', [gid]);
  }

  /**
   * Purge completed/error/removed downloads
   */
  async purgeDownloadResult(): Promise<string> {
    return this.rpc('purgeDownloadResult');
  }

  /**
   * Change download position in queue
   */
  async changePosition(
    gid: string,
    pos: number,
    how: 'POS_SET' | 'POS_CUR' | 'POS_END'
  ): Promise<number> {
    return this.rpc('changePosition', [gid, pos, how]);
  }

  /**
   * Change download options
   */
  async changeOption(gid: string, options: Aria2DownloadOptions): Promise<string> {
    return this.rpc('changeOption', [gid, options]);
  }

  /**
   * Get download option
   */
  async getOption(gid: string): Promise<Record<string, string>> {
    return this.rpc('getOption', [gid]);
  }

  /**
   * Get global options
   */
  async getGlobalOption(): Promise<Record<string, string>> {
    return this.rpc('getGlobalOption');
  }

  /**
   * Change global options
   */
  async changeGlobalOption(options: Record<string, string>): Promise<string> {
    return this.rpc('changeGlobalOption', [options]);
  }

  /**
   * Shutdown aria2
   */
  async shutdown(): Promise<string> {
    return this.rpc('shutdown');
  }

  /**
   * Force shutdown
   */
  async forceShutdown(): Promise<string> {
    return this.rpc('forceShutdown');
  }

  /**
   * Save session to file
   */
  async saveSession(): Promise<string> {
    return this.rpc('saveSession');
  }

  /**
   * Wait for download to complete
   */
  async waitForCompletion(
    gid: string,
    options: {
      pollIntervalMs?: number;
      timeoutMs?: number;
      onProgress?: (progress: number, speed: number) => void;
    } = {}
  ): Promise<Aria2Status> {
    const pollInterval = options.pollIntervalMs ?? 2000;
    const timeout = options.timeoutMs ?? 0;
    const startTime = Date.now();

    while (true) {
      const status = await this.tellStatus(gid);

      if (status.status === 'error') {
        throw new Error(`Download error: ${status.errorMessage || status.errorCode}`);
      }

      if (status.status === 'removed') {
        throw new Error('Download was removed');
      }

      if (options.onProgress) {
        const progress = await this.getProgress(gid);
        const speed = parseInt(status.downloadSpeed, 10);
        options.onProgress(progress, speed);
      }

      if (status.status === 'complete') {
        logger.info({ gid }, 'aria2 download complete');
        return status;
      }

      if (timeout > 0 && Date.now() - startTime > timeout) {
        throw new Error(`Download timed out after ${timeout}ms`);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  /**
   * Get downloaded file paths
   */
  async getDownloadedPaths(gid: string): Promise<string[]> {
    const status = await this.tellStatus(gid);
    return status.files
      .filter(f => f.selected === 'true')
      .map(f => f.path);
  }
}

// Singleton instance
export const aria2Client = new Aria2Client();
