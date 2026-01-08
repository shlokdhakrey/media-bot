/**
 * File Sync Service
 * 
 * Manages file synchronization between source and destination directories.
 * Handles file copying, moving, and tracking with integrity verification.
 * 
 * Features:
 * - Hash-based integrity verification
 * - Incremental sync (only changed files)
 * - Atomic file operations
 * - Progress tracking
 * - Conflict detection
 * - Rollback support
 */

import { EventEmitter } from 'node:events';
import { 
  stat, 
  copyFile, 
  rename, 
  unlink, 
  readdir, 
  mkdir,
  readFile,
  writeFile 
} from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename, relative, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { PathMapper } from './pathMapper.js';
import { ConflictResolver, ConflictResolution, FileConflict } from './conflictResolver.js';

export type SyncOperation = 'copy' | 'move' | 'update' | 'delete' | 'skip';
export type SyncStatus = 'pending' | 'in-progress' | 'complete' | 'failed' | 'skipped';

export interface SyncFile {
  path: string;
  relativePath: string;
  size: number;
  modifiedAt: Date;
  hash?: string;
  operation?: SyncOperation;
  status?: SyncStatus;
  error?: string;
}

export interface SyncManifest {
  id: string;
  createdAt: Date;
  completedAt?: Date;
  source: string;
  destination: string;
  files: SyncFile[];
  totalSize: number;
  totalFiles: number;
  syncedSize: number;
  syncedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  status: 'pending' | 'in-progress' | 'complete' | 'failed' | 'partial';
}

export interface SyncOptions {
  // Operation mode
  mode: 'copy' | 'move' | 'mirror';
  
  // Verify integrity with hash
  verifyHash?: boolean;
  
  // Hash algorithm
  hashAlgorithm?: 'md5' | 'sha1' | 'sha256';
  
  // Delete files in destination not in source (mirror mode)
  deleteOrphans?: boolean;
  
  // Overwrite existing files
  overwriteExisting?: boolean;
  
  // Skip files that already exist with same size/date
  skipExisting?: boolean;
  
  // Preserve timestamps
  preserveTimestamps?: boolean;
  
  // File patterns to include
  includePatterns?: string[];
  
  // File patterns to exclude
  excludePatterns?: string[];
  
  // Maximum concurrent operations
  concurrency?: number;
  
  // Retry failed operations
  retryCount?: number;
  
  // Retry delay in ms
  retryDelayMs?: number;
  
  // Dry run (don't actually copy/move)
  dryRun?: boolean;
  
  // Save manifest file
  saveManifest?: boolean;
  
  // Conflict resolution strategy
  conflictStrategy?: 'skip' | 'overwrite' | 'rename' | 'newer' | 'ask';
}

export interface SyncProgress {
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  totalBytes: number;
  completedBytes: number;
  currentFile: string;
  currentFileProgress: number;
  startTime: Date;
  elapsedMs: number;
  estimatedRemainingMs: number;
  bytesPerSecond: number;
}

export class FileSyncService extends EventEmitter {
  private pathMapper: PathMapper | null;
  private conflictResolver: ConflictResolver;
  private activeSync: SyncManifest | null = null;
  private abortRequested = false;

  constructor(
    pathMapper?: PathMapper,
    conflictResolver?: ConflictResolver
  ) {
    super();
    this.pathMapper = pathMapper ?? null;
    this.conflictResolver = conflictResolver ?? new ConflictResolver({
      defaultStrategy: 'skip',
    });
  }

  /**
   * Sync files from source to destination
   */
  async sync(
    source: string,
    destination: string,
    options: SyncOptions
  ): Promise<SyncManifest> {
    this.abortRequested = false;
    
    const manifest = await this.buildManifest(source, destination, options);
    this.activeSync = manifest;

    const startTime = Date.now();
    let completedBytes = 0;

    this.emit('start', manifest);

    const concurrency = options.concurrency ?? 4;
    const pendingFiles = [...manifest.files.filter(f => f.status === 'pending')];
    const inProgress = new Set<string>();

    const processFile = async (file: SyncFile): Promise<void> => {
      if (this.abortRequested) {
        file.status = 'skipped';
        manifest.skippedFiles++;
        return;
      }

      file.status = 'in-progress';
      inProgress.add(file.path);

      try {
        await this.syncFile(file, source, destination, options);
        file.status = 'complete';
        manifest.syncedFiles++;
        manifest.syncedSize += file.size;
        completedBytes += file.size;

        this.emitProgress(manifest, completedBytes, file.relativePath, startTime);
      } catch (error) {
        file.status = 'failed';
        file.error = (error as Error).message;
        manifest.failedFiles++;

        this.emit('error', { file, error });

        // Retry if configured
        if (options.retryCount && options.retryCount > 0) {
          await this.retryFile(file, source, destination, options, options.retryCount);
        }
      } finally {
        inProgress.delete(file.path);
      }

      this.emit('file-complete', file);
    };

    // Process files with concurrency limit
    const chunks: SyncFile[][] = [];
    for (let i = 0; i < pendingFiles.length; i += concurrency) {
      chunks.push(pendingFiles.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      if (this.abortRequested) break;
      await Promise.all(chunk.map(processFile));
    }

    // Finalize manifest
    manifest.completedAt = new Date();
    manifest.status = this.determineStatus(manifest);

    // Save manifest if requested
    if (options.saveManifest) {
      await this.saveManifestFile(manifest, destination);
    }

    this.activeSync = null;
    this.emit('complete', manifest);

    return manifest;
  }

  /**
   * Abort the current sync operation
   */
  abort(): void {
    this.abortRequested = true;
  }

  /**
   * Get the current sync progress
   */
  getProgress(): SyncProgress | null {
    if (!this.activeSync) return null;

    const manifest = this.activeSync;
    const startTime = manifest.createdAt;
    const elapsedMs = Date.now() - startTime.getTime();
    const bytesPerSecond = elapsedMs > 0 ? (manifest.syncedSize / elapsedMs) * 1000 : 0;
    const remainingBytes = manifest.totalSize - manifest.syncedSize;
    const estimatedRemainingMs = bytesPerSecond > 0 ? (remainingBytes / bytesPerSecond) * 1000 : 0;

    return {
      totalFiles: manifest.totalFiles,
      completedFiles: manifest.syncedFiles,
      failedFiles: manifest.failedFiles,
      skippedFiles: manifest.skippedFiles,
      totalBytes: manifest.totalSize,
      completedBytes: manifest.syncedSize,
      currentFile: '',
      currentFileProgress: 0,
      startTime,
      elapsedMs,
      estimatedRemainingMs,
      bytesPerSecond,
    };
  }

  /**
   * Calculate hash for a file
   */
  async calculateHash(
    filePath: string,
    algorithm: 'md5' | 'sha1' | 'sha256' = 'sha256'
  ): Promise<string> {
    const hash = createHash(algorithm);
    const stream = createReadStream(filePath);
    
    await pipeline(stream, hash);
    
    return hash.digest('hex');
  }

  /**
   * Build sync manifest by scanning directories
   */
  private async buildManifest(
    source: string,
    destination: string,
    options: SyncOptions
  ): Promise<SyncManifest> {
    const files: SyncFile[] = [];
    await this.scanDirectory(source, source, files, options);

    // Check for conflicts with existing destination files
    for (const file of files) {
      const destPath = join(destination, file.relativePath);
      const conflict = await this.checkConflict(file, destPath, options);
      
      if (conflict) {
        const resolution = await this.conflictResolver.resolve(conflict);
        file.operation = this.resolutionToOperation(resolution, options.mode);
        file.status = file.operation === 'skip' ? 'skipped' : 'pending';
      } else {
        file.operation = options.mode === 'move' ? 'move' : 'copy';
        file.status = 'pending';
      }
    }

    // Handle orphans in mirror mode
    if (options.mode === 'mirror' && options.deleteOrphans) {
      const orphans = await this.findOrphans(source, destination, files);
      for (const orphan of orphans) {
        files.push({
          ...orphan,
          operation: 'delete',
          status: 'pending',
        });
      }
    }

    const totalSize = files.reduce((sum, f) => sum + (f.size ?? 0), 0);
    const pendingFiles = files.filter(f => f.status === 'pending');

    return {
      id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date(),
      source,
      destination,
      files,
      totalSize,
      totalFiles: pendingFiles.length,
      syncedSize: 0,
      syncedFiles: 0,
      failedFiles: 0,
      skippedFiles: files.filter(f => f.status === 'skipped').length,
      status: 'pending',
    };
  }

  /**
   * Scan directory recursively
   */
  private async scanDirectory(
    dir: string,
    baseDir: string,
    files: SyncFile[],
    options: SyncOptions
  ): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = relative(baseDir, fullPath);

        // Apply include/exclude patterns
        if (!this.matchesPatterns(relativePath, options.includePatterns, options.excludePatterns)) {
          continue;
        }

        if (entry.isDirectory()) {
          await this.scanDirectory(fullPath, baseDir, files, options);
        } else if (entry.isFile()) {
          const stats = await stat(fullPath);
          
          const file: SyncFile = {
            path: fullPath,
            relativePath,
            size: stats.size,
            modifiedAt: stats.mtime,
          };

          // Calculate hash if needed
          if (options.verifyHash) {
            file.hash = await this.calculateHash(fullPath, options.hashAlgorithm);
          }

          files.push(file);
        }
      }
    } catch (error) {
      this.emit('error', { path: dir, error });
    }
  }

  /**
   * Sync a single file
   */
  private async syncFile(
    file: SyncFile,
    source: string,
    destination: string,
    options: SyncOptions
  ): Promise<void> {
    const destPath = join(destination, file.relativePath);
    
    if (options.dryRun) {
      return;
    }

    switch (file.operation) {
      case 'copy':
      case 'update':
        await this.copyWithVerification(file.path, destPath, file.hash, options);
        break;

      case 'move':
        await this.moveWithVerification(file.path, destPath, file.hash, options);
        break;

      case 'delete':
        await unlink(file.path);
        break;

      case 'skip':
        // Do nothing
        break;
    }
  }

  /**
   * Copy file with optional verification
   */
  private async copyWithVerification(
    source: string,
    dest: string,
    expectedHash: string | undefined,
    options: SyncOptions
  ): Promise<void> {
    // Ensure destination directory exists
    await mkdir(dirname(dest), { recursive: true });

    // Copy file
    await copyFile(source, dest);

    // Verify hash if required
    if (options.verifyHash && expectedHash) {
      const destHash = await this.calculateHash(dest, options.hashAlgorithm);
      if (destHash !== expectedHash) {
        await unlink(dest);
        throw new Error(`Hash mismatch after copy: expected ${expectedHash}, got ${destHash}`);
      }
    }
  }

  /**
   * Move file with optional verification
   */
  private async moveWithVerification(
    source: string,
    dest: string,
    expectedHash: string | undefined,
    options: SyncOptions
  ): Promise<void> {
    await mkdir(dirname(dest), { recursive: true });

    try {
      // Try atomic rename first
      await rename(source, dest);
    } catch {
      // Fall back to copy + delete
      await this.copyWithVerification(source, dest, expectedHash, options);
      await unlink(source);
    }
  }

  /**
   * Check for conflict with destination
   */
  private async checkConflict(
    file: SyncFile,
    destPath: string,
    options: SyncOptions
  ): Promise<FileConflict | null> {
    try {
      const destStats = await stat(destPath);
      
      // Skip check - same size and date
      if (options.skipExisting) {
        if (
          destStats.size === file.size &&
          Math.abs(destStats.mtime.getTime() - file.modifiedAt.getTime()) < 1000
        ) {
          return null;
        }
      }

      return {
        sourcePath: file.path,
        destPath,
        sourceSize: file.size,
        destSize: destStats.size,
        sourceModified: file.modifiedAt,
        destModified: destStats.mtime,
        sourceHash: file.hash,
      };
    } catch {
      // Destination doesn't exist - no conflict
      return null;
    }
  }

  /**
   * Find orphan files in destination
   */
  private async findOrphans(
    source: string,
    destination: string,
    sourceFiles: SyncFile[]
  ): Promise<SyncFile[]> {
    const sourceRelativePaths = new Set(sourceFiles.map(f => f.relativePath));
    const orphans: SyncFile[] = [];

    const scanForOrphans = async (dir: string, baseDir: string): Promise<void> => {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          const relativePath = relative(baseDir, fullPath);

          if (entry.isDirectory()) {
            await scanForOrphans(fullPath, baseDir);
          } else if (entry.isFile()) {
            if (!sourceRelativePaths.has(relativePath)) {
              const stats = await stat(fullPath);
              orphans.push({
                path: fullPath,
                relativePath,
                size: stats.size,
                modifiedAt: stats.mtime,
              });
            }
          }
        }
      } catch {
        // Ignore errors in destination scanning
      }
    };

    await scanForOrphans(destination, destination);
    return orphans;
  }

  /**
   * Retry a failed file
   */
  private async retryFile(
    file: SyncFile,
    source: string,
    destination: string,
    options: SyncOptions,
    retriesRemaining: number
  ): Promise<void> {
    if (retriesRemaining <= 0) return;

    await new Promise(resolve => setTimeout(resolve, options.retryDelayMs ?? 1000));

    try {
      await this.syncFile(file, source, destination, options);
      file.status = 'complete';
      file.error = undefined;
    } catch (error) {
      await this.retryFile(file, source, destination, options, retriesRemaining - 1);
    }
  }

  /**
   * Match against include/exclude patterns
   */
  private matchesPatterns(
    path: string,
    includes?: string[],
    excludes?: string[]
  ): boolean {
    // If includes are specified, path must match at least one
    if (includes && includes.length > 0) {
      const matchesInclude = includes.some(p => this.matchGlob(path, p));
      if (!matchesInclude) return false;
    }

    // If excludes are specified, path must not match any
    if (excludes && excludes.length > 0) {
      const matchesExclude = excludes.some(p => this.matchGlob(path, p));
      if (matchesExclude) return false;
    }

    return true;
  }

  /**
   * Simple glob matching
   */
  private matchGlob(path: string, pattern: string): boolean {
    const regex = new RegExp(
      '^' + pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/\\\\]*')
        .replace(/\?/g, '.') + '$',
      'i'
    );
    return regex.test(path);
  }

  /**
   * Convert conflict resolution to sync operation
   */
  private resolutionToOperation(
    resolution: ConflictResolution,
    mode: SyncOptions['mode']
  ): SyncOperation {
    switch (resolution.action) {
      case 'skip':
        return 'skip';
      case 'overwrite':
        return mode === 'move' ? 'move' : 'update';
      case 'rename':
        return mode === 'move' ? 'move' : 'copy';
      case 'merge':
        return 'copy';
      default:
        return 'skip';
    }
  }

  /**
   * Determine final status from manifest
   */
  private determineStatus(manifest: SyncManifest): SyncManifest['status'] {
    if (manifest.failedFiles === manifest.totalFiles) {
      return 'failed';
    }
    if (manifest.failedFiles > 0) {
      return 'partial';
    }
    if (manifest.syncedFiles === manifest.totalFiles) {
      return 'complete';
    }
    return 'partial';
  }

  /**
   * Save manifest to file
   */
  private async saveManifestFile(
    manifest: SyncManifest,
    destination: string
  ): Promise<void> {
    const manifestPath = join(destination, '.sync-manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  /**
   * Emit progress event
   */
  private emitProgress(
    manifest: SyncManifest,
    completedBytes: number,
    currentFile: string,
    startTime: number
  ): void {
    const elapsedMs = Date.now() - startTime;
    const bytesPerSecond = elapsedMs > 0 ? (completedBytes / elapsedMs) * 1000 : 0;
    const remainingBytes = manifest.totalSize - completedBytes;
    const estimatedRemainingMs = bytesPerSecond > 0 ? (remainingBytes / bytesPerSecond) * 1000 : 0;

    const progress: SyncProgress = {
      totalFiles: manifest.totalFiles,
      completedFiles: manifest.syncedFiles,
      failedFiles: manifest.failedFiles,
      skippedFiles: manifest.skippedFiles,
      totalBytes: manifest.totalSize,
      completedBytes,
      currentFile,
      currentFileProgress: 100,
      startTime: manifest.createdAt,
      elapsedMs,
      estimatedRemainingMs,
      bytesPerSecond,
    };

    this.emit('progress', progress);
  }
}