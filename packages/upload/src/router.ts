/**
 * Upload Router
 * 
 * Routes uploads to appropriate target based on configuration.
 */

import { MinioUploader, type MinioConfig } from './targets/minio.js';
import { RcloneUploader, type RcloneConfig } from './targets/rclone.js';

// Local type definition for PackageManifest to avoid circular dependency issues
export interface PackageManifest {
  jobId: string;
  createdAt: Date;
  files: Array<{
    filename: string;
    path: string;
    size: number;
    type: string;
    md5?: string;
  }>;
  totalSize: number;
  metadata?: Record<string, unknown>;
}

export interface UploadManifest {
  jobId: string;
  uploadedAt: Date;
  target: 'minio' | 'gdrive' | 'other';
  location: string;
  files: Array<{
    filename: string;
    remotePath: string;
    size: number;
    etag?: string;
  }>;
  totalSize: number;
}

export interface UploadResult {
  success: boolean;
  manifest: UploadManifest;
  error?: string;
}

export class UploadRouter {
  private minioUploader?: MinioUploader;
  private rcloneUploader?: RcloneUploader;

  constructor(
    minioConfig?: MinioConfig,
    rcloneConfig?: RcloneConfig
  ) {
    if (minioConfig) {
      this.minioUploader = new MinioUploader(minioConfig);
    }
    if (rcloneConfig) {
      this.rcloneUploader = new RcloneUploader(rcloneConfig);
    }
  }

  /**
   * Upload a package to MinIO
   */
  async uploadToMinio(
    packageDir: string,
    packageManifest: PackageManifest
  ): Promise<UploadResult> {
    if (!this.minioUploader) {
      return {
        success: false,
        manifest: this.createEmptyManifest(packageManifest.jobId, 'minio'),
        error: 'MinIO not configured',
      };
    }

    try {
      await this.minioUploader.ensureBucket();

      const files = packageManifest.files.map((f: { filename: string }) => f.filename);
      const results = await this.minioUploader.uploadDirectory(
        packageDir,
        packageManifest.jobId,
        files
      );

      const uploadedFiles = results.map((r, i) => ({
        filename: files[i]!,
        remotePath: r.key,
        size: packageManifest.files[i]!.size,
        etag: r.etag,
      }));

      return {
        success: true,
        manifest: {
          jobId: packageManifest.jobId,
          uploadedAt: new Date(),
          target: 'minio',
          location: `minio://${packageManifest.jobId}`,
          files: uploadedFiles,
          totalSize: packageManifest.totalSize,
        },
      };
    } catch (error) {
      return {
        success: false,
        manifest: this.createEmptyManifest(packageManifest.jobId, 'minio'),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Upload a package to Google Drive via rclone
   */
  async uploadToGDrive(
    packageDir: string,
    packageManifest: PackageManifest
  ): Promise<UploadResult> {
    if (!this.rcloneUploader) {
      return {
        success: false,
        manifest: this.createEmptyManifest(packageManifest.jobId, 'gdrive'),
        error: 'Rclone not configured',
      };
    }

    try {
      const result = await this.rcloneUploader.upload(
        packageDir,
        packageManifest.jobId
      );

      if (!result.success) {
        throw new Error('Rclone upload failed');
      }

      const uploadedFiles = packageManifest.files.map((f: { filename: string; size: number }) => ({
        filename: f.filename,
        remotePath: `${packageManifest.jobId}/${f.filename}`,
        size: f.size,
      }));

      return {
        success: true,
        manifest: {
          jobId: packageManifest.jobId,
          uploadedAt: new Date(),
          target: 'gdrive',
          location: result.path,
          files: uploadedFiles,
          totalSize: packageManifest.totalSize,
        },
      };
    } catch (error) {
      return {
        success: false,
        manifest: this.createEmptyManifest(packageManifest.jobId, 'gdrive'),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check health of all upload targets
   */
  async healthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    if (this.minioUploader) {
      results.minio = await this.minioUploader.healthCheck();
    }
    if (this.rcloneUploader) {
      results.gdrive = await this.rcloneUploader.healthCheck();
    }

    return results;
  }

  private createEmptyManifest(
    jobId: string,
    target: UploadManifest['target']
  ): UploadManifest {
    return {
      jobId,
      uploadedAt: new Date(),
      target,
      location: '',
      files: [],
      totalSize: 0,
    };
  }
}
