/**
 * @media-bot/upload
 * 
 * Upload layer.
 * 
 * Supported targets:
 * - MinIO (S3 compatible) - default
 * - Google Drive via rclone
 * 
 * Features:
 * - Resumable uploads
 * - Upload manifests
 * - Integrity verification
 */

// MinIO client
export { MinioUploader, type MinioConfig } from './targets/minio.js';

// Rclone client (for Google Drive, etc.)
export { RcloneUploader, type RcloneConfig } from './targets/rclone.js';

// Upload router
export { UploadRouter, type UploadResult, type UploadManifest } from './router.js';
