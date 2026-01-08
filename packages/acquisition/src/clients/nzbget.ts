/**
 * NZBGet Client
 * 
 * Handles NZB downloads via NZBGet JSON-RPC API.
 * API Docs: https://nzbget.net/api/
 * 
 * Features:
 * - Add NZB by URL or file content
 * - Priority and category management
 * - Progress tracking and history
 * - Pause/resume/cancel operations
 * - Post-processing status
 */

import { logger } from '@media-bot/utils';

export interface NzbgetConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  useHttps: boolean;
}

export interface NzbgetStatus {
  RemainingSizeLo: number;
  RemainingSizeHi: number;
  RemainingSizeMB: number;
  ForcedSizeLo: number;
  ForcedSizeHi: number;
  ForcedSizeMB: number;
  DownloadedSizeLo: number;
  DownloadedSizeHi: number;
  DownloadedSizeMB: number;
  ArticleCacheLo: number;
  ArticleCacheHi: number;
  ArticleCacheMB: number;
  DownloadRate: number;
  AverageDownloadRate: number;
  DownloadLimit: number;
  ThreadCount: number;
  ParJobCount: number;
  PostJobCount: number;
  UrlCount: number;
  UpTimeSec: number;
  DownloadTimeSec: number;
  ServerPaused: boolean;
  DownloadPaused: boolean;
  Download2Paused: boolean;
  ServerStandBy: boolean;
  PostPaused: boolean;
  ScanPaused: boolean;
  QuotaReached: boolean;
  FreeDiskSpaceLo: number;
  FreeDiskSpaceHi: number;
  FreeDiskSpaceMB: number;
  NewsServers: Array<{
    ID: number;
    Active: boolean;
  }>;
}

export interface NzbgetGroup {
  NZBID: number;
  NZBName: string;
  NZBNicename: string;
  Kind: string;
  URL: string;
  NZBFilename: string;
  DestDir: string;
  FinalDir: string;
  Category: string;
  ParStatus: string;
  ExParStatus: string;
  UnpackStatus: string;
  MoveStatus: string;
  ScriptStatus: string;
  DeleteStatus: string;
  MarkStatus: string;
  UrlStatus: string;
  FileSizeLo: number;
  FileSizeHi: number;
  FileSizeMB: number;
  FileCount: number;
  MinPostTime: number;
  MaxPostTime: number;
  TotalArticles: number;
  SuccessArticles: number;
  FailedArticles: number;
  Health: number;
  CriticalHealth: number;
  DupeKey: string;
  DupeScore: number;
  DupeMode: string;
  Deleted: boolean;
  DownloadedSizeLo: number;
  DownloadedSizeHi: number;
  DownloadedSizeMB: number;
  DownloadTimeSec: number;
  PostTotalTimeSec: number;
  ParTimeSec: number;
  RepairTimeSec: number;
  UnpackTimeSec: number;
  MessageCount: number;
  ExtraParBlocks: number;
  Parameters: Array<{ Name: string; Value: string }>;
  ServerStats: Array<{
    ServerID: number;
    SuccessArticles: number;
    FailedArticles: number;
  }>;
  PostInfoText: string;
  PostStageProgress: number;
  PostStageTimeSec: number;
  Status: string;
  RemainingSizeLo: number;
  RemainingSizeHi: number;
  RemainingSizeMB: number;
  PausedSizeLo: number;
  PausedSizeHi: number;
  PausedSizeMB: number;
  RemainingFileCount: number;
  RemainingParCount: number;
  MinPriority: number;
  MaxPriority: number;
  ActiveDownloads: number;
  FirstID: number;
  LastID: number;
}

export interface NzbgetHistory {
  NZBID: number;
  Kind: string;
  NZBName: string;
  NZBNicename: string;
  NZBFilename: string;
  URL: string;
  DestDir: string;
  FinalDir: string;
  Category: string;
  ParStatus: string;
  ExParStatus: string;
  UnpackStatus: string;
  MoveStatus: string;
  ScriptStatus: string;
  DeleteStatus: string;
  MarkStatus: string;
  UrlStatus: string;
  FileSizeLo: number;
  FileSizeHi: number;
  FileSizeMB: number;
  FileCount: number;
  MinPostTime: number;
  MaxPostTime: number;
  TotalArticles: number;
  SuccessArticles: number;
  FailedArticles: number;
  Health: number;
  CriticalHealth: number;
  DupeKey: string;
  DupeScore: number;
  DupeMode: string;
  Deleted: boolean;
  DownloadedSizeLo: number;
  DownloadedSizeHi: number;
  DownloadedSizeMB: number;
  DownloadTimeSec: number;
  PostTotalTimeSec: number;
  ParTimeSec: number;
  RepairTimeSec: number;
  UnpackTimeSec: number;
  MessageCount: number;
  ExtraParBlocks: number;
  Parameters: Array<{ Name: string; Value: string }>;
  ServerStats: Array<{
    ServerID: number;
    SuccessArticles: number;
    FailedArticles: number;
  }>;
  Status: string;
}

export interface AddNzbOptions {
  category?: string;
  priority?: number; // -100 (very low) to 900 (force)
  addTop?: boolean;
  addPaused?: boolean;
  dupeKey?: string;
  dupeScore?: number;
  dupeMode?: 'score' | 'all' | 'force';
}

interface JsonRpcResponse<T = unknown> {
  version: string;
  result: T;
  error?: {
    name: string;
    code: number;
    message: string;
  };
}

export class NzbgetClient {
  private config: NzbgetConfig;

  constructor(config?: Partial<NzbgetConfig>) {
    this.config = {
      host: config?.host ?? process.env.NZBGET_HOST ?? 'localhost',
      port: config?.port ?? parseInt(process.env.NZBGET_PORT ?? '6789', 10),
      username: config?.username ?? process.env.NZBGET_USER ?? 'nzbget',
      password: config?.password ?? process.env.NZBGET_PASSWORD ?? '',
      useHttps: config?.useHttps ?? process.env.NZBGET_HTTPS === 'true',
    };
  }

  private get baseUrl(): string {
    const protocol = this.config.useHttps ? 'https' : 'http';
    return `${protocol}://${this.config.host}:${this.config.port}`;
  }

  private get authHeader(): string {
    const credentials = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
    return `Basic ${credentials}`;
  }

  /**
   * Make a JSON-RPC call to NZBGet
   */
  private async rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(`${this.baseUrl}/jsonrpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.authHeader,
      },
      body: JSON.stringify({
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`NZBGet API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as JsonRpcResponse<T>;

    if (result.error) {
      throw new Error(`NZBGet error ${result.error.code}: ${result.error.message}`);
    }

    return result.result;
  }

  /**
   * Check if NZBGet is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.version();
      return true;
    } catch (error) {
      logger.warn({ error: (error as Error).message }, 'NZBGet not available');
      return false;
    }
  }

  /**
   * Get NZBGet version
   */
  async version(): Promise<string> {
    return this.rpc<string>('version');
  }

  /**
   * Get server status
   */
  async status(): Promise<NzbgetStatus> {
    return this.rpc<NzbgetStatus>('status');
  }

  /**
   * Add NZB by URL
   */
  async addUrl(
    url: string,
    options: AddNzbOptions = {}
  ): Promise<number> {
    const nzbName = '';
    const category = options.category ?? '';
    const priority = options.priority ?? 0;
    const addToTop = options.addTop ?? false;
    const addPaused = options.addPaused ?? false;
    const dupeKey = options.dupeKey ?? '';
    const dupeScore = options.dupeScore ?? 0;
    const dupeMode = options.dupeMode ?? 'score';

    const nzbId = await this.rpc<number>('append', [
      nzbName,
      url,
      category,
      priority,
      addToTop,
      addPaused,
      dupeKey,
      dupeScore,
      dupeMode,
    ]);

    logger.info({ nzbId, url }, 'NZB URL added to NZBGet');
    return nzbId;
  }

  /**
   * Add NZB by file content
   */
  async addFile(
    filename: string,
    content: Buffer,
    options: AddNzbOptions = {}
  ): Promise<number> {
    const base64Content = content.toString('base64');
    const category = options.category ?? '';
    const priority = options.priority ?? 0;
    const addToTop = options.addTop ?? false;
    const addPaused = options.addPaused ?? false;
    const dupeKey = options.dupeKey ?? '';
    const dupeScore = options.dupeScore ?? 0;
    const dupeMode = options.dupeMode ?? 'score';

    const nzbId = await this.rpc<number>('append', [
      filename,
      base64Content,
      category,
      priority,
      addToTop,
      addPaused,
      dupeKey,
      dupeScore,
      dupeMode,
    ]);

    logger.info({ nzbId, filename }, 'NZB file added to NZBGet');
    return nzbId;
  }

  /**
   * Add NZB from local file path
   */
  async addNzbFile(
    filePath: string,
    options: AddNzbOptions = {}
  ): Promise<number> {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const content = await fs.readFile(filePath);
    const filename = path.basename(filePath);
    
    return this.addFile(filename, content, options);
  }

  /**
   * Get download queue (groups)
   */
  async listGroups(): Promise<NzbgetGroup[]> {
    return this.rpc<NzbgetGroup[]>('listgroups');
  }

  /**
   * Get download history
   */
  async history(hidden: boolean = false): Promise<NzbgetHistory[]> {
    return this.rpc<NzbgetHistory[]>('history', [hidden]);
  }

  /**
   * Get a specific group by ID
   */
  async getGroup(nzbId: number): Promise<NzbgetGroup | null> {
    const groups = await this.listGroups();
    return groups.find(g => g.NZBID === nzbId) ?? null;
  }

  /**
   * Get a specific history item by ID
   */
  async getHistoryItem(nzbId: number): Promise<NzbgetHistory | null> {
    const hist = await this.history(true);
    return hist.find(h => h.NZBID === nzbId) ?? null;
  }

  /**
   * Get download progress (0-100)
   */
  async getProgress(nzbId: number): Promise<number> {
    const group = await this.getGroup(nzbId);
    if (!group) {
      // Check history
      const histItem = await this.getHistoryItem(nzbId);
      if (histItem) {
        return 100; // Completed
      }
      throw new Error(`NZB not found: ${nzbId}`);
    }

    const total = this.combineSizes(group.FileSizeHi, group.FileSizeLo);
    const remaining = this.combineSizes(group.RemainingSizeHi, group.RemainingSizeLo);
    
    if (total === 0) return 0;
    return Math.round(((total - remaining) / total) * 100);
  }

  /**
   * Get download speed in bytes/second
   */
  async getSpeed(): Promise<number> {
    const stat = await this.status();
    return stat.DownloadRate;
  }

  /**
   * Check if download is complete
   */
  async isComplete(nzbId: number): Promise<boolean> {
    const group = await this.getGroup(nzbId);
    if (group) {
      return false; // Still in queue
    }

    const histItem = await this.getHistoryItem(nzbId);
    return histItem !== null;
  }

  /**
   * Get completion status from history
   */
  async getCompletionStatus(nzbId: number): Promise<{
    success: boolean;
    status: string;
    destDir: string;
  } | null> {
    const histItem = await this.getHistoryItem(nzbId);
    if (!histItem) {
      return null;
    }

    const success = histItem.Status === 'SUCCESS' || 
                    (histItem.Status.startsWith('SUCCESS') && 
                     !histItem.Status.includes('FAILURE'));

    return {
      success,
      status: histItem.Status,
      destDir: histItem.FinalDir || histItem.DestDir,
    };
  }

  /**
   * Pause a download
   */
  async pause(nzbId: number): Promise<boolean> {
    const result = await this.rpc<boolean>('editqueue', ['GroupPause', '', [nzbId]]);
    logger.info({ nzbId }, 'NZB paused');
    return result;
  }

  /**
   * Resume a download
   */
  async resume(nzbId: number): Promise<boolean> {
    const result = await this.rpc<boolean>('editqueue', ['GroupResume', '', [nzbId]]);
    logger.info({ nzbId }, 'NZB resumed');
    return result;
  }

  /**
   * Delete a download
   */
  async delete(nzbId: number): Promise<boolean> {
    const result = await this.rpc<boolean>('editqueue', ['GroupDelete', '', [nzbId]]);
    logger.info({ nzbId }, 'NZB deleted');
    return result;
  }

  /**
   * Delete from history
   */
  async deleteHistory(nzbId: number, deleteFiles: boolean = false): Promise<boolean> {
    const command = deleteFiles ? 'HistoryFinalDelete' : 'HistoryDelete';
    const result = await this.rpc<boolean>('editqueue', [command, '', [nzbId]]);
    logger.info({ nzbId, deleteFiles }, 'NZB history deleted');
    return result;
  }

  /**
   * Move download to top of queue
   */
  async moveToTop(nzbId: number): Promise<boolean> {
    return this.rpc<boolean>('editqueue', ['GroupMoveTop', '', [nzbId]]);
  }

  /**
   * Move download to bottom of queue
   */
  async moveToBottom(nzbId: number): Promise<boolean> {
    return this.rpc<boolean>('editqueue', ['GroupMoveBottom', '', [nzbId]]);
  }

  /**
   * Set download priority
   */
  async setPriority(nzbId: number, priority: number): Promise<boolean> {
    return this.rpc<boolean>('editqueue', ['GroupSetPriority', String(priority), [nzbId]]);
  }

  /**
   * Set download category
   */
  async setCategory(nzbId: number, category: string): Promise<boolean> {
    return this.rpc<boolean>('editqueue', ['GroupSetCategory', category, [nzbId]]);
  }

  /**
   * Pause all downloads
   */
  async pauseAll(): Promise<boolean> {
    return this.rpc<boolean>('pausedownload');
  }

  /**
   * Resume all downloads
   */
  async resumeAll(): Promise<boolean> {
    return this.rpc<boolean>('resumedownload');
  }

  /**
   * Set download rate limit (bytes/second, 0 = unlimited)
   */
  async setRateLimit(limit: number): Promise<boolean> {
    return this.rpc<boolean>('rate', [limit]);
  }

  /**
   * Reload config
   */
  async reload(): Promise<boolean> {
    return this.rpc<boolean>('reload');
  }

  /**
   * Shutdown NZBGet
   */
  async shutdown(): Promise<boolean> {
    return this.rpc<boolean>('shutdown');
  }

  /**
   * Scan incoming directory for NZB files
   */
  async scan(): Promise<boolean> {
    return this.rpc<boolean>('scan');
  }

  /**
   * Get server configuration
   */
  async getServerConfig(): Promise<Array<{ Name: string; Value: string }>> {
    return this.rpc<Array<{ Name: string; Value: string }>>('config');
  }

  /**
   * Combine high and low 32-bit values into 64-bit number
   */
  private combineSizes(high: number, low: number): number {
    return (high * 4294967296) + low;
  }

  /**
   * Wait for download to complete
   */
  async waitForCompletion(
    nzbId: number,
    options: {
      pollIntervalMs?: number;
      timeoutMs?: number;
      onProgress?: (progress: number, speed: number) => void;
    } = {}
  ): Promise<NzbgetHistory> {
    const pollInterval = options.pollIntervalMs ?? 5000;
    const timeout = options.timeoutMs ?? 0;
    const startTime = Date.now();

    while (true) {
      // Check if still in queue
      const group = await this.getGroup(nzbId);
      
      if (group) {
        if (options.onProgress) {
          const progress = await this.getProgress(nzbId);
          const speed = await this.getSpeed();
          options.onProgress(progress, speed);
        }
      } else {
        // Check history
        const histItem = await this.getHistoryItem(nzbId);
        if (histItem) {
          if (histItem.Status.includes('FAILURE')) {
            throw new Error(`NZB download failed: ${histItem.Status}`);
          }
          
          logger.info({ nzbId, status: histItem.Status }, 'NZBGet download complete');
          return histItem;
        }
        
        throw new Error(`NZB not found in queue or history: ${nzbId}`);
      }

      if (timeout > 0 && Date.now() - startTime > timeout) {
        throw new Error(`NZB download timed out after ${timeout}ms`);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  /**
   * Get downloaded file paths
   */
  async getDownloadedPaths(nzbId: number): Promise<string[]> {
    const histItem = await this.getHistoryItem(nzbId);
    if (!histItem) {
      throw new Error(`NZB not found in history: ${nzbId}`);
    }

    const destDir = histItem.FinalDir || histItem.DestDir;
    if (!destDir) {
      return [];
    }

    const fs = await import('fs/promises');
    const path = await import('path');

    const files: string[] = [];
    const walkDir = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walkDir(fullPath);
          } else {
            files.push(fullPath);
          }
        }
      } catch {
        // Directory might not exist yet
      }
    };

    await walkDir(destDir);
    return files;
  }
}

// Singleton instance
export const nzbgetClient = new NzbgetClient();
