/**
 * qBittorrent Client
 * 
 * Handles magnet and torrent downloads via qBittorrent WebUI API.
 * API Docs: https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)
 * 
 * Features:
 * - Cookie-based authentication with auto-refresh
 * - Download via magnet links or .torrent files
 * - Progress tracking and speed monitoring
 * - Pause/resume/delete operations
 * - Category and save path management
 */

import { logger } from '@media-bot/utils';

export interface QBittorrentConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  downloadPath?: string;
  category?: string;
}

export interface TorrentInfo {
  hash: string;
  name: string;
  size: number;
  progress: number;
  dlspeed: number;
  upspeed: number;
  priority: number;
  num_seeds: number;
  num_leechs: number;
  ratio: number;
  eta: number;
  state: TorrentState;
  category: string;
  save_path: string;
  added_on: number;
  completion_on: number;
  content_path: string;
}

export type TorrentState =
  | 'error'
  | 'missingFiles'
  | 'uploading'
  | 'pausedUP'
  | 'queuedUP'
  | 'stalledUP'
  | 'checkingUP'
  | 'forcedUP'
  | 'allocating'
  | 'downloading'
  | 'metaDL'
  | 'pausedDL'
  | 'queuedDL'
  | 'stalledDL'
  | 'checkingDL'
  | 'forcedDL'
  | 'checkingResumeData'
  | 'moving'
  | 'unknown';

export interface TorrentFile {
  index: number;
  name: string;
  size: number;
  progress: number;
  priority: number;
  is_seed: boolean;
  piece_range: [number, number];
  availability: number;
}

export interface AddTorrentOptions {
  savepath?: string;
  category?: string;
  paused?: boolean;
  skip_checking?: boolean;
  root_folder?: boolean;
  rename?: string;
  sequentialDownload?: boolean;
  firstLastPiecePrio?: boolean;
}

export class QBittorrentClient {
  private config: QBittorrentConfig;
  private cookie: string | null = null;
  private cookieExpiry: number = 0;
  private readonly COOKIE_LIFETIME_MS = 30 * 60 * 1000; // 30 minutes

  constructor(config?: Partial<QBittorrentConfig>) {
    this.config = {
      host: config?.host ?? process.env.QBITTORRENT_HOST ?? 'localhost',
      port: config?.port ?? parseInt(process.env.QBITTORRENT_PORT ?? '8080', 10),
      username: config?.username ?? process.env.QBITTORRENT_USER ?? 'admin',
      password: config?.password ?? process.env.QBITTORRENT_PASSWORD ?? '',
      downloadPath: config?.downloadPath ?? process.env.QBITTORRENT_DOWNLOAD_PATH,
      category: config?.category ?? process.env.QBITTORRENT_CATEGORY ?? 'media-bot',
    };
  }

  private get baseUrl(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  /**
   * Make an authenticated API request
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    await this.ensureAuthenticated();

    const url = `${this.baseUrl}/api/v2${endpoint}`;
    const headers = new Headers(options.headers);
    headers.set('Cookie', this.cookie!);

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 403) {
      // Cookie expired, re-authenticate
      this.cookie = null;
      await this.ensureAuthenticated();
      headers.set('Cookie', this.cookie!);
      
      const retryResponse = await fetch(url, { ...options, headers });
      if (!retryResponse.ok) {
        throw new Error(`qBittorrent API error: ${retryResponse.status} ${retryResponse.statusText}`);
      }
      return this.parseResponse<T>(retryResponse);
    }

    if (!response.ok) {
      throw new Error(`qBittorrent API error: ${response.status} ${response.statusText}`);
    }

    return this.parseResponse<T>(response);
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return response.json() as Promise<T>;
    }
    const text = await response.text();
    // Try to parse as JSON anyway
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  /**
   * Ensure we have a valid session cookie
   */
  private async ensureAuthenticated(): Promise<void> {
    if (this.cookie && Date.now() < this.cookieExpiry) {
      return;
    }
    await this.login();
  }

  /**
   * Authenticate with qBittorrent
   */
  async login(): Promise<void> {
    const url = `${this.baseUrl}/api/v2/auth/login`;
    const body = new URLSearchParams({
      username: this.config.username,
      password: this.config.password,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(`qBittorrent login failed: ${response.status}`);
    }

    const text = await response.text();
    if (text !== 'Ok.') {
      throw new Error(`qBittorrent login failed: ${text}`);
    }

    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) {
      throw new Error('qBittorrent login did not return session cookie');
    }

    // Extract SID from cookie
    const match = setCookie.match(/SID=([^;]+)/);
    if (!match) {
      throw new Error('qBittorrent cookie format unexpected');
    }

    this.cookie = `SID=${match[1]}`;
    this.cookieExpiry = Date.now() + this.COOKIE_LIFETIME_MS;

    logger.info('qBittorrent authenticated successfully');
  }

  /**
   * Logout from qBittorrent
   */
  async logout(): Promise<void> {
    if (!this.cookie) return;
    
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } finally {
      this.cookie = null;
      this.cookieExpiry = 0;
    }
  }

  /**
   * Check if qBittorrent is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.login();
      return true;
    } catch (error) {
      logger.warn({ error: (error as Error).message }, 'qBittorrent not available');
      return false;
    }
  }

  /**
   * Get qBittorrent version
   */
  async getVersion(): Promise<string> {
    return this.request<string>('/app/version');
  }

  /**
   * Get API version
   */
  async getApiVersion(): Promise<string> {
    return this.request<string>('/app/webapiVersion');
  }

  /**
   * Add a torrent via magnet link
   */
  async addMagnet(
    magnetLink: string,
    options: AddTorrentOptions = {}
  ): Promise<string> {
    const formData = new URLSearchParams();
    formData.append('urls', magnetLink);

    if (options.savepath ?? this.config.downloadPath) {
      formData.append('savepath', options.savepath ?? this.config.downloadPath!);
    }
    if (options.category ?? this.config.category) {
      formData.append('category', options.category ?? this.config.category!);
    }
    if (options.paused !== undefined) {
      formData.append('paused', options.paused ? 'true' : 'false');
    }
    if (options.sequentialDownload) {
      formData.append('sequentialDownload', 'true');
    }
    if (options.firstLastPiecePrio) {
      formData.append('firstLastPiecePrio', 'true');
    }

    await this.request('/torrents/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    // Extract hash from magnet link
    const hashMatch = magnetLink.match(/xt=urn:btih:([a-fA-F0-9]{40})/i);
    if (hashMatch?.[1]) {
      return hashMatch[1].toLowerCase();
    }

    // For v2 magnets or if hash extraction fails, get from torrent list
    // Wait a moment for the torrent to be added
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const torrents = await this.getTorrents();
    const latest = torrents.sort((a, b) => b.added_on - a.added_on)[0];
    
    if (!latest) {
      throw new Error('Failed to get torrent hash after adding');
    }

    logger.info({ hash: latest.hash, name: latest.name }, 'Magnet added to qBittorrent');
    return latest.hash;
  }

  /**
   * Add a torrent via .torrent file
   */
  async addTorrentFile(
    torrentPath: string,
    options: AddTorrentOptions = {}
  ): Promise<string> {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const fileContent = await fs.readFile(torrentPath);
    const fileName = path.basename(torrentPath);

    // Build multipart form data
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
    let body = '';

    // Add file
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="torrents"; filename="${fileName}"\r\n`;
    body += 'Content-Type: application/x-bittorrent\r\n\r\n';
    
    const bodyBuffer = Buffer.concat([
      Buffer.from(body, 'utf-8'),
      fileContent,
      Buffer.from('\r\n', 'utf-8'),
    ]);

    // Add options
    let optionsBody = '';
    if (options.savepath ?? this.config.downloadPath) {
      optionsBody += `--${boundary}\r\n`;
      optionsBody += 'Content-Disposition: form-data; name="savepath"\r\n\r\n';
      optionsBody += `${options.savepath ?? this.config.downloadPath}\r\n`;
    }
    if (options.category ?? this.config.category) {
      optionsBody += `--${boundary}\r\n`;
      optionsBody += 'Content-Disposition: form-data; name="category"\r\n\r\n';
      optionsBody += `${options.category ?? this.config.category}\r\n`;
    }
    optionsBody += `--${boundary}--\r\n`;

    const fullBody = Buffer.concat([bodyBuffer, Buffer.from(optionsBody, 'utf-8')]);

    await this.request('/torrents/add', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: fullBody,
    });

    // Get the added torrent's hash
    await new Promise(resolve => setTimeout(resolve, 500));
    const torrents = await this.getTorrents();
    const latest = torrents.sort((a, b) => b.added_on - a.added_on)[0];

    if (!latest) {
      throw new Error('Failed to get torrent hash after adding');
    }

    logger.info({ hash: latest.hash, name: latest.name }, 'Torrent file added to qBittorrent');
    return latest.hash;
  }

  /**
   * Get all torrents
   */
  async getTorrents(filter?: {
    category?: string;
    hashes?: string[];
    status?: 'all' | 'downloading' | 'seeding' | 'completed' | 'paused' | 'active' | 'inactive' | 'stalled';
  }): Promise<TorrentInfo[]> {
    const params = new URLSearchParams();
    
    if (filter?.category) {
      params.append('category', filter.category);
    }
    if (filter?.hashes) {
      params.append('hashes', filter.hashes.join('|'));
    }
    if (filter?.status) {
      params.append('filter', filter.status);
    }

    const query = params.toString();
    return this.request<TorrentInfo[]>(`/torrents/info${query ? '?' + query : ''}`);
  }

  /**
   * Get a specific torrent by hash
   */
  async getTorrent(hash: string): Promise<TorrentInfo | null> {
    const torrents = await this.getTorrents({ hashes: [hash] });
    return torrents[0] ?? null;
  }

  /**
   * Get torrent files
   */
  async getTorrentFiles(hash: string): Promise<TorrentFile[]> {
    const params = new URLSearchParams({ hash });
    return this.request<TorrentFile[]>(`/torrents/files?${params}`);
  }

  /**
   * Get download progress (0-100)
   */
  async getProgress(hash: string): Promise<number> {
    const torrent = await this.getTorrent(hash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${hash}`);
    }
    return Math.round(torrent.progress * 100);
  }

  /**
   * Get download speed in bytes/second
   */
  async getSpeed(hash: string): Promise<{ download: number; upload: number }> {
    const torrent = await this.getTorrent(hash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${hash}`);
    }
    return {
      download: torrent.dlspeed,
      upload: torrent.upspeed,
    };
  }

  /**
   * Check if torrent is complete
   */
  async isComplete(hash: string): Promise<boolean> {
    const torrent = await this.getTorrent(hash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${hash}`);
    }
    return torrent.progress >= 1 || ['uploading', 'pausedUP', 'stalledUP'].includes(torrent.state);
  }

  /**
   * Pause a torrent
   */
  async pause(hash: string): Promise<void> {
    await this.request('/torrents/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `hashes=${hash}`,
    });
    logger.info({ hash }, 'Torrent paused');
  }

  /**
   * Resume a torrent
   */
  async resume(hash: string): Promise<void> {
    await this.request('/torrents/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `hashes=${hash}`,
    });
    logger.info({ hash }, 'Torrent resumed');
  }

  /**
   * Delete a torrent
   */
  async delete(hash: string, deleteFiles: boolean = false): Promise<void> {
    await this.request('/torrents/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `hashes=${hash}&deleteFiles=${deleteFiles}`,
    });
    logger.info({ hash, deleteFiles }, 'Torrent deleted');
  }

  /**
   * Set download location
   */
  async setLocation(hash: string, location: string): Promise<void> {
    await this.request('/torrents/setLocation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `hashes=${hash}&location=${encodeURIComponent(location)}`,
    });
  }

  /**
   * Set torrent category
   */
  async setCategory(hash: string, category: string): Promise<void> {
    await this.request('/torrents/setCategory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `hashes=${hash}&category=${encodeURIComponent(category)}`,
    });
  }

  /**
   * Create a category
   */
  async createCategory(name: string, savePath?: string): Promise<void> {
    const body = new URLSearchParams({ category: name });
    if (savePath) {
      body.append('savePath', savePath);
    }
    await this.request('/torrents/createCategory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }

  /**
   * Get all categories
   */
  async getCategories(): Promise<Record<string, { name: string; savePath: string }>> {
    return this.request('/torrents/categories');
  }

  /**
   * Wait for torrent to complete
   */
  async waitForCompletion(
    hash: string,
    options: {
      pollIntervalMs?: number;
      timeoutMs?: number;
      onProgress?: (progress: number, speed: number) => void;
    } = {}
  ): Promise<TorrentInfo> {
    const pollInterval = options.pollIntervalMs ?? 5000;
    const timeout = options.timeoutMs ?? 0; // 0 = no timeout
    const startTime = Date.now();

    while (true) {
      const torrent = await this.getTorrent(hash);
      
      if (!torrent) {
        throw new Error(`Torrent not found: ${hash}`);
      }

      if (torrent.state === 'error' || torrent.state === 'missingFiles') {
        throw new Error(`Torrent error: ${torrent.state}`);
      }

      if (options.onProgress) {
        options.onProgress(torrent.progress * 100, torrent.dlspeed);
      }

      if (await this.isComplete(hash)) {
        logger.info({ hash, name: torrent.name }, 'Torrent download complete');
        return torrent;
      }

      if (timeout > 0 && Date.now() - startTime > timeout) {
        throw new Error(`Torrent download timed out after ${timeout}ms`);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  /**
   * Get downloaded file paths for a completed torrent
   */
  async getDownloadedPaths(hash: string): Promise<string[]> {
    const torrent = await this.getTorrent(hash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${hash}`);
    }

    const files = await this.getTorrentFiles(hash);
    const basePath = torrent.content_path || torrent.save_path;

    // For single file torrents
    if (files.length === 1) {
      return [basePath];
    }

    // For multi-file torrents
    const path = await import('path');
    return files.map(f => path.join(torrent.save_path, f.name));
  }
}

// Singleton instance
export const qbittorrentClient = new QBittorrentClient();