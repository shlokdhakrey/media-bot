/**
 * MinIO Uploader
 * 
 * S3-compatible object storage upload via MinIO client.
 */

import { Client } from 'minio';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

export interface MinioConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

export interface UploadProgress {
  file: string;
  uploaded: number;
  total: number;
  percentage: number;
}

export class MinioUploader {
  private client: Client;
  private bucket: string;

  constructor(config: MinioConfig) {
    this.client = new Client({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
    this.bucket = config.bucket;
  }

  /**
   * Ensure the bucket exists
   */
  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
  }

  /**
   * Upload a file to MinIO
   */
  async upload(
    filePath: string,
    remotePath?: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<{ bucket: string; key: string; etag: string }> {
    const key = remotePath ?? basename(filePath);
    const fileStat = await stat(filePath);
    const fileSize = fileStat.size;

    // For large files, use fPutObject with multipart
    // For progress tracking, we'd need to implement custom stream
    const stream = createReadStream(filePath);
    
    let uploaded = 0;
    stream.on('data', (chunk) => {
      uploaded += chunk.length;
      onProgress?.({
        file: filePath,
        uploaded,
        total: fileSize,
        percentage: (uploaded / fileSize) * 100,
      });
    });

    const result = await this.client.putObject(
      this.bucket,
      key,
      stream,
      fileSize,
      {
        'Content-Type': this.getMimeType(key),
      }
    );

    return {
      bucket: this.bucket,
      key,
      etag: result.etag,
    };
  }

  /**
   * Upload a directory
   */
  async uploadDirectory(
    localDir: string,
    remotePrefix: string,
    files: string[]
  ): Promise<Array<{ file: string; key: string; etag: string }>> {
    const results: Array<{ file: string; key: string; etag: string }> = [];

    for (const file of files) {
      const remotePath = `${remotePrefix}/${file}`;
      const localPath = `${localDir}/${file}`;
      
      const result = await this.upload(localPath, remotePath);
      results.push({
        file,
        key: result.key,
        etag: result.etag,
      });
    }

    return results;
  }

  /**
   * Check if MinIO is accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.listBuckets();
      return true;
    } catch {
      return false;
    }
  }

  private getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      'mkv': 'video/x-matroska',
      'mp4': 'video/mp4',
      'avi': 'video/x-msvideo',
      'srt': 'text/plain',
      'ass': 'text/plain',
      'json': 'application/json',
      'nfo': 'text/plain',
    };
    return mimeTypes[ext ?? ''] ?? 'application/octet-stream';
  }
}
