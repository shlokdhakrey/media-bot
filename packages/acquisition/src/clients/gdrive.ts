/**
 * Google Drive API Client
 * 
 * Downloads files from Google Drive using the API with key authentication.
 * Supports both direct file downloads and getting file metadata.
 * 
 * Uses: ?key=API_KEY&alt=media for downloading
 */

import { EventEmitter } from 'events';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export interface GDriveConfig {
  apiKey: string;
  downloadPath: string;
  maxRetries?: number;
  chunkSize?: number;
}

export interface GDriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  md5Checksum?: string;
  modifiedTime?: string;
  webContentLink?: string;
  parents?: string[];
}

export interface GDriveProgress {
  fileId: string;
  fileName: string;
  bytesDownloaded: number;
  totalBytes: number;
  percentage: number;
  speed: number; // bytes per second
  eta: number; // seconds
}

export interface GDriveDownloadResult {
  success: boolean;
  fileId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  duration: number;
  error?: string;
}

export class GDriveApiClient extends EventEmitter {
  private config: GDriveConfig;
  private activeDownloads: Map<string, AbortController> = new Map();

  constructor(config: GDriveConfig) {
    super();
    this.config = {
      maxRetries: 3,
      chunkSize: 32 * 1024 * 1024, // 32MB chunks
      ...config,
    };
  }

  /**
   * Extract file ID from various Google Drive URL formats
   */
  static extractFileId(url: string): string | null {
    const patterns = [
      /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
      /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
      /drive\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]+)/,
      /drive\.google\.com\/.*[?&]id=([a-zA-Z0-9_-]+)/,
      /^([a-zA-Z0-9_-]{25,})$/, // Direct file ID
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Get file metadata from Google Drive
   * Supports shared drives with supportsAllDrives=true
   */
  async getFileMetadata(fileId: string): Promise<GDriveFileMetadata> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?key=${this.config.apiKey}&fields=id,name,mimeType,size,md5Checksum,modifiedTime,webContentLink,parents&supportsAllDrives=true`;

    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get file metadata: ${response.status} - ${error}`);
    }

    return await response.json() as GDriveFileMetadata;
  }

  /**
   * Download a file from Google Drive
   * Supports shared drives with supportsAllDrives=true
   */
  async downloadFile(
    fileIdOrUrl: string,
    outputDir?: string,
    customFileName?: string
  ): Promise<GDriveDownloadResult> {
    const fileId = GDriveApiClient.extractFileId(fileIdOrUrl) ?? fileIdOrUrl;
    const destDir = outputDir ?? this.config.downloadPath;
    const startTime = Date.now();

    // Ensure destination directory exists
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    // Create abort controller for this download
    const abortController = new AbortController();
    this.activeDownloads.set(fileId, abortController);

    try {
      // Get file metadata first (with shared drive support)
      const metadata = await this.getFileMetadata(fileId);
      const fileName = customFileName ?? metadata.name;
      const filePath = join(destDir, fileName);
      const totalBytes = parseInt(metadata.size, 10);

      this.emit('start', {
        fileId,
        fileName,
        totalBytes,
      });

      // Download using API with alt=media and supportsAllDrives for shared drives
      const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?key=${this.config.apiKey}&alt=media&supportsAllDrives=true`;

      const response = await fetch(downloadUrl, {
        signal: abortController.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Download failed: ${response.status} - ${error}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Track progress
      let bytesDownloaded = 0;
      let lastUpdate = Date.now();
      let lastBytes = 0;

      const trackProgress = new TransformStream({
        transform: (chunk, controller) => {
          bytesDownloaded += chunk.length;
          
          const now = Date.now();
          const elapsed = (now - lastUpdate) / 1000;
          
          // Update progress every 500ms
          if (elapsed >= 0.5) {
            const speed = (bytesDownloaded - lastBytes) / elapsed;
            const remaining = totalBytes - bytesDownloaded;
            const eta = speed > 0 ? remaining / speed : 0;

            const progress: GDriveProgress = {
              fileId,
              fileName,
              bytesDownloaded,
              totalBytes,
              percentage: Math.round((bytesDownloaded / totalBytes) * 100),
              speed,
              eta,
            };

            this.emit('progress', progress);
            lastUpdate = now;
            lastBytes = bytesDownloaded;
          }

          controller.enqueue(chunk);
        },
      });

      // Pipe through progress tracker and to file
      const writeStream = createWriteStream(filePath);
      const readable = Readable.fromWeb(
        response.body.pipeThrough(trackProgress) as any
      );

      await pipeline(readable, writeStream);

      const duration = (Date.now() - startTime) / 1000;

      // Verify file size
      const stats = await stat(filePath);
      if (stats.size !== totalBytes) {
        throw new Error(`Size mismatch: expected ${totalBytes}, got ${stats.size}`);
      }

      const result: GDriveDownloadResult = {
        success: true,
        fileId,
        fileName,
        filePath,
        fileSize: stats.size,
        duration,
      };

      this.emit('complete', result);
      return result;

    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      const result: GDriveDownloadResult = {
        success: false,
        fileId,
        fileName: customFileName ?? fileId,
        filePath: join(destDir, customFileName ?? fileId),
        fileSize: 0,
        duration,
        error: errorMessage,
      };

      this.emit('error', result);
      return result;

    } finally {
      this.activeDownloads.delete(fileId);
    }
  }

  /**
   * Cancel an active download
   */
  cancelDownload(fileId: string): boolean {
    const controller = this.activeDownloads.get(fileId);
    if (controller) {
      controller.abort();
      this.activeDownloads.delete(fileId);
      return true;
    }
    return false;
  }

  /**
   * Cancel all active downloads
   */
  cancelAll(): void {
    for (const [fileId, controller] of this.activeDownloads) {
      controller.abort();
      this.emit('cancelled', { fileId });
    }
    this.activeDownloads.clear();
  }

  /**
   * List files in a folder (supports shared drives)
   */
  async listFolder(folderId: string): Promise<GDriveFileMetadata[]> {
    const url = `https://www.googleapis.com/drive/v3/files?key=${this.config.apiKey}&q='${folderId}' in parents&fields=files(id,name,mimeType,size,md5Checksum)&supportsAllDrives=true&includeItemsFromAllDrives=true`;

    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list folder: ${response.status} - ${error}`);
    }

    const data = await response.json() as { files: GDriveFileMetadata[] };
    return data.files;
  }

  /**
   * Check if the API key is valid
   */
  async validateApiKey(): Promise<boolean> {
    try {
      // Try to access the about endpoint
      const url = `https://www.googleapis.com/drive/v3/about?key=${this.config.apiKey}&fields=user`;
      const response = await fetch(url);
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Create a GDrive client from environment variables
 */
export function createGDriveClient(
  apiKey?: string,
  downloadPath?: string
): GDriveApiClient {
  return new GDriveApiClient({
    apiKey: apiKey ?? process.env.GDRIVE_API_KEY ?? '',
    downloadPath: downloadPath ?? process.env.STORAGE_INCOMING ?? './downloads',
  });
}

/**
 * Simple download function for one-off downloads
 */
export async function downloadFromGDrive(
  fileIdOrUrl: string,
  outputDir: string,
  apiKey: string,
  onProgress?: (progress: GDriveProgress) => void
): Promise<GDriveDownloadResult> {
  const client = new GDriveApiClient({
    apiKey,
    downloadPath: outputDir,
  });

  if (onProgress) {
    client.on('progress', onProgress);
  }

  return client.downloadFile(fileIdOrUrl, outputDir);
}
