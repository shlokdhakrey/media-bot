/**
 * Packager
 * 
 * Prepares processed files for upload.
 */

import { ensureDir, moveFile, safeWriteFile, calculateFileHash, getFileSizeBytes } from '@media-bot/utils';
import { join, basename } from 'node:path';

export interface PackageManifest {
  jobId: string;
  createdAt: Date;
  
  files: Array<{
    filename: string;
    size: number;
    md5: string;
    sha256: string;
    type: 'video' | 'audio' | 'subtitle' | 'sample' | 'nfo' | 'other';
  }>;
  
  totalSize: number;
  
  metadata: {
    title?: string;
    year?: string;
    resolution?: string;
    source?: string;
    audioCodec?: string;
    videoCodec?: string;
  };
}

export interface PackageResult {
  success: boolean;
  packageDir: string;
  manifest: PackageManifest;
  error?: string;
}

export class Packager {
  /**
   * Package processed files for upload
   */
  async package(
    jobId: string,
    files: {
      videoFile: string;
      audioFiles?: string[];
      subtitleFiles?: string[];
      sampleFiles?: string[];
    },
    outputDir: string,
    metadata?: PackageManifest['metadata']
  ): Promise<PackageResult> {
    const packageDir = join(outputDir, jobId);
    
    try {
      await ensureDir(packageDir);
      
      const manifestFiles: PackageManifest['files'] = [];
      let totalSize = 0;

      // Move video file
      const videoFilename = basename(files.videoFile);
      const videoDestination = join(packageDir, videoFilename);
      await moveFile(files.videoFile, videoDestination);
      
      const videoSize = await getFileSizeBytes(videoDestination);
      const videoMd5 = await calculateFileHash(videoDestination, 'md5');
      const videoSha256 = await calculateFileHash(videoDestination, 'sha256');
      
      manifestFiles.push({
        filename: videoFilename,
        size: videoSize,
        md5: videoMd5,
        sha256: videoSha256,
        type: 'video',
      });
      totalSize += videoSize;

      // Move audio files
      if (files.audioFiles) {
        for (const audioFile of files.audioFiles) {
          const filename = basename(audioFile);
          const destination = join(packageDir, filename);
          await moveFile(audioFile, destination);
          
          const size = await getFileSizeBytes(destination);
          const md5 = await calculateFileHash(destination, 'md5');
          const sha256 = await calculateFileHash(destination, 'sha256');
          
          manifestFiles.push({
            filename,
            size,
            md5,
            sha256,
            type: 'audio',
          });
          totalSize += size;
        }
      }

      // Move subtitle files
      if (files.subtitleFiles) {
        for (const subFile of files.subtitleFiles) {
          const filename = basename(subFile);
          const destination = join(packageDir, filename);
          await moveFile(subFile, destination);
          
          const size = await getFileSizeBytes(destination);
          const md5 = await calculateFileHash(destination, 'md5');
          const sha256 = await calculateFileHash(destination, 'sha256');
          
          manifestFiles.push({
            filename,
            size,
            md5,
            sha256,
            type: 'subtitle',
          });
          totalSize += size;
        }
      }

      // Move sample files
      if (files.sampleFiles) {
        const samplesDir = join(packageDir, 'Samples');
        await ensureDir(samplesDir);
        
        for (const sampleFile of files.sampleFiles) {
          const filename = basename(sampleFile);
          const destination = join(samplesDir, filename);
          await moveFile(sampleFile, destination);
          
          const size = await getFileSizeBytes(destination);
          const md5 = await calculateFileHash(destination, 'md5');
          const sha256 = await calculateFileHash(destination, 'sha256');
          
          manifestFiles.push({
            filename: `Samples/${filename}`,
            size,
            md5,
            sha256,
            type: 'sample',
          });
          totalSize += size;
        }
      }

      // Create manifest
      const manifest: PackageManifest = {
        jobId,
        createdAt: new Date(),
        files: manifestFiles,
        totalSize,
        metadata: metadata ?? {},
      };

      // Write manifest file
      await safeWriteFile(
        join(packageDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      );

      return {
        success: true,
        packageDir,
        manifest,
      };
    } catch (error) {
      return {
        success: false,
        packageDir,
        manifest: {
          jobId,
          createdAt: new Date(),
          files: [],
          totalSize: 0,
          metadata: {},
        },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
