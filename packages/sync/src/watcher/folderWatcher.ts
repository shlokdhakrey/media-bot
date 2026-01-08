/**
 * Folder Watcher Service
 * 
 * Monitors directories for file changes using native fs.watch with debouncing.
 * Designed for watching download directories and triggering processing pipelines.
 * 
 * Features:
 * - Recursive directory watching
 * - Debounced events (prevents duplicate triggers)
 * - Ignore patterns (temp files, partial downloads)
 * - File stability detection (wait for writes to complete)
 * - Event batching for bulk operations
 */

import { EventEmitter } from 'node:events';
import { watch, FSWatcher, stat, readdir } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { stat as statAsync, readdir as readdirAsync } from 'node:fs/promises';

export type WatchEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface WatchEvent {
  type: WatchEventType;
  path: string;
  relativePath: string;
  extension: string;
  timestamp: Date;
  size?: number;
}

export interface WatcherConfig {
  // Directories to watch
  paths: string[];
  
  // Recursive watching
  recursive?: boolean;
  
  // Debounce delay in ms
  debounceMs?: number;
  
  // Wait for file to be stable (no writes) before emitting
  stabilityThresholdMs?: number;
  
  // Patterns to ignore (glob-like)
  ignorePatterns?: string[];
  
  // File extensions to watch (empty = all)
  extensions?: string[];
  
  // Ignore hidden files/directories
  ignoreHidden?: boolean;
  
  // Ignore partial download files
  ignorePartials?: boolean;
  
  // Maximum events to batch
  batchSize?: number;
  
  // Batch timeout
  batchTimeoutMs?: number;
}

interface PendingFile {
  path: string;
  lastSize: number;
  lastModified: number;
  checkCount: number;
}

export class FolderWatcher extends EventEmitter {
  private config: Required<WatcherConfig>;
  private watchers: Map<string, FSWatcher> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingFiles: Map<string, PendingFile> = new Map();
  private stabilityCheckInterval: NodeJS.Timeout | null = null;
  private eventBatch: WatchEvent[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;
  private isRunning = false;

  // Common partial download patterns
  private static readonly PARTIAL_PATTERNS = [
    /\.part$/i,
    /\.partial$/i,
    /\.crdownload$/i,
    /\.download$/i,
    /\.tmp$/i,
    /\.temp$/i,
    /~$/,
    /\.!qB$/i,      // qBittorrent
    /\.!ut$/i,      // uTorrent
    /\.bc!$/i,      // BitComet
    /\.aria2$/i,    // aria2
  ];

  // Media file extensions
  private static readonly MEDIA_EXTENSIONS = new Set([
    '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
    '.mp3', '.flac', '.aac', '.wav', '.ogg', '.m4a', '.opus', '.ac3', '.dts',
    '.srt', '.ass', '.ssa', '.sub', '.idx', '.vtt',
    '.nfo', '.sfv', '.txt',
  ]);

  constructor(config: WatcherConfig) {
    super();
    
    this.config = {
      paths: config.paths,
      recursive: config.recursive ?? true,
      debounceMs: config.debounceMs ?? 500,
      stabilityThresholdMs: config.stabilityThresholdMs ?? 2000,
      ignorePatterns: config.ignorePatterns ?? [],
      extensions: config.extensions ?? [],
      ignoreHidden: config.ignoreHidden ?? true,
      ignorePartials: config.ignorePartials ?? true,
      batchSize: config.batchSize ?? 100,
      batchTimeoutMs: config.batchTimeoutMs ?? 1000,
    };
  }

  /**
   * Start watching configured directories
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Watcher is already running');
    }

    this.isRunning = true;

    for (const watchPath of this.config.paths) {
      await this.watchDirectory(watchPath);
    }

    // Start stability check interval
    this.stabilityCheckInterval = setInterval(
      () => this.checkFileStability(),
      this.config.stabilityThresholdMs / 2
    );

    this.emit('ready', { paths: this.config.paths });
  }

  /**
   * Stop watching all directories
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    // Clear all watchers
    for (const [path, watcher] of this.watchers) {
      watcher.close();
      this.watchers.delete(path);
    }

    // Clear timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.stabilityCheckInterval) {
      clearInterval(this.stabilityCheckInterval);
      this.stabilityCheckInterval = null;
    }

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    // Flush remaining events
    this.flushBatch();

    this.emit('close');
  }

  /**
   * Add a directory to watch
   */
  async addPath(watchPath: string): Promise<void> {
    if (!this.config.paths.includes(watchPath)) {
      this.config.paths.push(watchPath);
    }
    
    if (this.isRunning) {
      await this.watchDirectory(watchPath);
    }
  }

  /**
   * Remove a directory from watching
   */
  removePath(watchPath: string): void {
    const index = this.config.paths.indexOf(watchPath);
    if (index !== -1) {
      this.config.paths.splice(index, 1);
    }

    const watcher = this.watchers.get(watchPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(watchPath);
    }
  }

  /**
   * Get currently watched paths
   */
  getWatchedPaths(): string[] {
    return Array.from(this.watchers.keys());
  }

  /**
   * Check if watcher is running
   */
  get running(): boolean {
    return this.isRunning;
  }

  // Private methods

  private async watchDirectory(dirPath: string): Promise<void> {
    if (this.watchers.has(dirPath)) {
      return;
    }

    try {
      const watcher = watch(
        dirPath,
        { recursive: this.config.recursive },
        (eventType, filename) => {
          if (filename) {
            this.handleFileEvent(eventType, dirPath, filename);
          }
        }
      );

      watcher.on('error', (error) => {
        this.emit('error', { path: dirPath, error });
      });

      this.watchers.set(dirPath, watcher);

      // Do initial scan
      await this.scanDirectory(dirPath);
    } catch (error) {
      this.emit('error', { path: dirPath, error });
    }
  }

  private async scanDirectory(dirPath: string, basePath?: string): Promise<void> {
    const base = basePath ?? dirPath;
    
    try {
      const entries = await readdirAsync(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        const relativePath = relative(base, fullPath);

        if (this.shouldIgnore(fullPath, entry.name)) {
          continue;
        }

        if (entry.isDirectory() && this.config.recursive) {
          await this.scanDirectory(fullPath, base);
        } else if (entry.isFile()) {
          // Don't emit during initial scan, just track
          // Uncomment below to emit 'add' for existing files on startup
          // this.queueEvent('add', fullPath, base);
        }
      }
    } catch (error) {
      this.emit('error', { path: dirPath, error });
    }
  }

  private handleFileEvent(eventType: string, basePath: string, filename: string): void {
    const fullPath = join(basePath, filename);
    
    if (this.shouldIgnore(fullPath, filename)) {
      return;
    }

    // Debounce the event
    const debounceKey = `${eventType}:${fullPath}`;
    const existingTimer = this.debounceTimers.get(debounceKey);
    
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(debounceKey);
      this.processFileEvent(eventType, fullPath, basePath);
    }, this.config.debounceMs);

    this.debounceTimers.set(debounceKey, timer);
  }

  private async processFileEvent(eventType: string, fullPath: string, basePath: string): Promise<void> {
    try {
      const stats = await statAsync(fullPath).catch(() => null);

      if (eventType === 'rename') {
        if (stats) {
          if (stats.isDirectory()) {
            this.queueEvent('addDir', fullPath, basePath, stats.size);
          } else {
            // File appeared - add to pending for stability check
            this.pendingFiles.set(fullPath, {
              path: fullPath,
              lastSize: stats.size,
              lastModified: stats.mtimeMs,
              checkCount: 0,
            });
          }
        } else {
          // File/dir was deleted
          this.queueEvent('unlink', fullPath, basePath);
        }
      } else if (eventType === 'change' && stats) {
        // File was modified - reset stability check
        this.pendingFiles.set(fullPath, {
          path: fullPath,
          lastSize: stats.size,
          lastModified: stats.mtimeMs,
          checkCount: 0,
        });
      }
    } catch (error) {
      this.emit('error', { path: fullPath, error });
    }
  }

  private async checkFileStability(): Promise<void> {
    for (const [path, pending] of this.pendingFiles) {
      try {
        const stats = await statAsync(path).catch(() => null);
        
        if (!stats) {
          // File was deleted
          this.pendingFiles.delete(path);
          continue;
        }

        if (stats.size === pending.lastSize && stats.mtimeMs === pending.lastModified) {
          // File is stable (no changes)
          pending.checkCount++;
          
          if (pending.checkCount >= 2) {
            // File has been stable for long enough
            this.pendingFiles.delete(path);
            
            // Find the base path
            const basePath = this.config.paths.find(p => path.startsWith(p)) ?? this.config.paths[0];
            
            if (basePath) {
              this.queueEvent('add', path, basePath, stats.size);
            }
          }
        } else {
          // File changed, reset
          pending.lastSize = stats.size;
          pending.lastModified = stats.mtimeMs;
          pending.checkCount = 0;
        }
      } catch {
        this.pendingFiles.delete(path);
      }
    }
  }

  private queueEvent(type: WatchEventType, fullPath: string, basePath: string, size?: number): void {
    const event: WatchEvent = {
      type,
      path: fullPath,
      relativePath: relative(basePath, fullPath),
      extension: extname(fullPath).toLowerCase(),
      timestamp: new Date(),
      size,
    };

    this.eventBatch.push(event);
    this.emit('event', event);

    // Check if we should flush the batch
    if (this.eventBatch.length >= this.config.batchSize) {
      this.flushBatch();
    } else if (!this.batchTimeout) {
      this.batchTimeout = setTimeout(() => {
        this.flushBatch();
      }, this.config.batchTimeoutMs);
    }
  }

  private flushBatch(): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    if (this.eventBatch.length > 0) {
      this.emit('batch', [...this.eventBatch]);
      this.eventBatch = [];
    }
  }

  private shouldIgnore(fullPath: string, filename: string): boolean {
    // Ignore hidden files
    if (this.config.ignoreHidden && filename.startsWith('.')) {
      return true;
    }

    // Ignore partial downloads
    if (this.config.ignorePartials) {
      for (const pattern of FolderWatcher.PARTIAL_PATTERNS) {
        if (pattern.test(filename)) {
          return true;
        }
      }
    }

    // Check extension filter
    if (this.config.extensions.length > 0) {
      const ext = extname(filename).toLowerCase();
      if (!this.config.extensions.includes(ext)) {
        return true;
      }
    }

    // Check ignore patterns
    for (const pattern of this.config.ignorePatterns) {
      if (this.matchPattern(fullPath, pattern) || this.matchPattern(filename, pattern)) {
        return true;
      }
    }

    return false;
  }

  private matchPattern(path: string, pattern: string): boolean {
    // Simple glob matching
    const regex = new RegExp(
      '^' + pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') + '$',
      'i'
    );
    return regex.test(path);
  }

  /**
   * Check if a file extension is a known media type
   */
  static isMediaFile(filename: string): boolean {
    const ext = extname(filename).toLowerCase();
    return FolderWatcher.MEDIA_EXTENSIONS.has(ext);
  }

  /**
   * Get the type of media file
   */
  static getMediaType(filename: string): 'video' | 'audio' | 'subtitle' | 'other' | null {
    const ext = extname(filename).toLowerCase();
    
    if (['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(ext)) {
      return 'video';
    }
    if (['.mp3', '.flac', '.aac', '.wav', '.ogg', '.m4a', '.opus', '.ac3', '.dts'].includes(ext)) {
      return 'audio';
    }
    if (['.srt', '.ass', '.ssa', '.sub', '.idx', '.vtt'].includes(ext)) {
      return 'subtitle';
    }
    if (['.nfo', '.sfv', '.txt'].includes(ext)) {
      return 'other';
    }
    
    return null;
  }
}

/**
 * Create a media-focused watcher
 */
export function createMediaWatcher(paths: string[]): FolderWatcher {
  return new FolderWatcher({
    paths,
    recursive: true,
    debounceMs: 500,
    stabilityThresholdMs: 3000,  // Media files can take time to finish writing
    ignoreHidden: true,
    ignorePartials: true,
    extensions: [...FolderWatcher['MEDIA_EXTENSIONS']],
  });
}

/**
 * Create a download directory watcher
 */
export function createDownloadWatcher(paths: string[]): FolderWatcher {
  return new FolderWatcher({
    paths,
    recursive: true,
    debounceMs: 1000,
    stabilityThresholdMs: 5000,  // Wait longer for downloads to complete
    ignoreHidden: true,
    ignorePartials: true,  // Will watch for final files only
    ignorePatterns: [
      '*.log',
      '*.nfo',
      'Thumbs.db',
      'desktop.ini',
    ],
  });
}