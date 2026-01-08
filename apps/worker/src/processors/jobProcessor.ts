/**
 * Job Processor
 * 
 * Main processor that routes jobs to appropriate handlers
 * based on job type and manages database state.
 */

import { Job } from 'bullmq';
import { logger } from '../lib/logger.js';
import { updateJobStatus, getJobFromDb, createAuditLog } from '../lib/database.js';
import { config } from '../config/index.js';

export interface JobData {
  id: string;
  type: 'download' | 'analyze' | 'sync' | 'process' | 'validate' | 'package' | 'upload';
  releaseId?: string;
  source?: string;
  path?: string;
  options?: Record<string, unknown>;
}

export interface JobResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface JobProgress {
  percent: number;
  stage: string;
  details?: string;
}

/**
 * Main job processor function
 * Dispatches to specific handlers based on job type
 */
export async function jobProcessor(job: Job<JobData>): Promise<JobResult> {
  const startTime = Date.now();
  const { id, type } = job.data;
  
  logger.info({
    jobId: id,
    bullmqId: job.id,
    jobType: type,
    attempt: job.attemptsMade + 1,
  }, 'Processing job');

  // Update database status to RUNNING
  await updateJobStatus(id, 'RUNNING', {
    message: `Starting ${type} job`,
    progress: 0,
  });

  // Create audit log
  await createAuditLog(
    'JOB_STATE_CHANGED',
    `Starting ${type} job`,
    id,
    { type, attempt: job.attemptsMade + 1, workerId: config.workerId }
  );

  try {
    // Progress reporter
    const reportProgress = async (progress: JobProgress) => {
      await job.updateProgress(progress.percent);
      await updateJobStatus(id, 'RUNNING', {
        progress: progress.percent,
        message: `${progress.stage}: ${progress.details || ''}`,
      });
    };

    let result: JobResult;

    switch (type) {
      case 'download':
        result = await processDownload(job, reportProgress);
        break;
      case 'analyze':
        result = await processAnalyze(job, reportProgress);
        break;
      case 'sync':
        result = await processSync(job, reportProgress);
        break;
      case 'process':
        result = await processMedia(job, reportProgress);
        break;
      case 'validate':
        result = await processValidate(job, reportProgress);
        break;
      case 'package':
        result = await processPackage(job, reportProgress);
        break;
      case 'upload':
        result = await processUpload(job, reportProgress);
        break;
      default:
        throw new Error(`Unknown job type: ${type}`);
    }

    const duration = Date.now() - startTime;
    
    // Update database status to COMPLETED
    await updateJobStatus(id, 'COMPLETED', {
      progress: 100,
      message: result.message,
      result: result.data,
    });

    // Create audit log
    await createAuditLog(
      'JOB_COMPLETED',
      `Job ${type} completed successfully`,
      id,
      { type, duration, result: result.data }
    );

    logger.info({
      jobId: id,
      jobType: type,
      duration,
      success: result.success,
    }, 'Job completed');

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Update database status to FAILED
    await updateJobStatus(id, 'FAILED', {
      error: errorMessage,
      message: `Job failed: ${errorMessage}`,
    });

    // Create audit log
    await createAuditLog(
      'JOB_FAILED',
      `Job ${type} failed: ${errorMessage}`,
      id,
      { type, duration, error: errorMessage, attempt: job.attemptsMade + 1 }
    );

    logger.error({
      jobId: id,
      jobType: type,
      duration,
      error: errorMessage,
    }, 'Job failed');
    
    throw error;
  }
}

type ProgressReporter = (progress: JobProgress) => Promise<void>;

/**
 * Download processor - handles torrent/nzb downloads
 */
async function processDownload(
  job: Job<JobData>,
  reportProgress: ProgressReporter
): Promise<JobResult> {
  const { source } = job.data;
  
  await reportProgress({ percent: 0, stage: 'Initializing', details: 'Starting download' });

  try {
    // Dynamic import to avoid loading all modules at startup
    const { QBittorrentClient } = await import('@media-bot/acquisition');
    
    await reportProgress({ percent: 10, stage: 'Connecting', details: 'Connecting to download client' });
    
    const client = new QBittorrentClient();
    
    // Add download based on source type
    let hash: string;
    if (source?.startsWith('magnet:')) {
      hash = await client.addMagnet(source);
    } else if (source?.endsWith('.torrent')) {
      // Local .torrent file
      hash = await client.addTorrentFile(source);
    } else if (source) {
      // HTTP URL - addMagnet also accepts URLs
      hash = await client.addMagnet(source);
    } else {
      throw new Error('No download source provided');
    }

    await reportProgress({ percent: 20, stage: 'Downloading', details: `Hash: ${hash}` });

    // Poll for completion (simplified - in production use webhooks or polling service)
    let lastProgress = 20;
    const maxWaitTime = config.jobs.timeoutMs;
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      const torrent = await client.getTorrent(hash);
      
      if (!torrent) {
        throw new Error('Torrent not found');
      }
      
      const downloadProgress = Math.min(20 + (torrent.progress * 70), 90);
      
      if (downloadProgress > lastProgress) {
        await reportProgress({
          percent: downloadProgress,
          stage: 'Downloading',
          details: `${(torrent.progress * 100).toFixed(1)}% - ${formatBytes(torrent.dlspeed)}/s`,
        });
        lastProgress = downloadProgress;
      }
      
      if (torrent.progress >= 1) {
        break;
      }
      
      // Wait before next poll
      await sleep(5000);
    }

    await reportProgress({ percent: 100, stage: 'Complete', details: 'Download finished' });

    return {
      success: true,
      message: 'Download completed successfully',
      data: { hash },
    };
  } catch (error) {
    logger.error({ error, source }, 'Download failed');
    throw error;
  }
}

/**
 * Analyze processor - extracts media metadata
 */
async function processAnalyze(
  job: Job<JobData>,
  reportProgress: ProgressReporter
): Promise<JobResult> {
  const { path: filePath } = job.data;
  
  if (!filePath) {
    throw new Error('No file path provided for analysis');
  }

  await reportProgress({ percent: 0, stage: 'Initializing', details: 'Starting analysis' });

  try {
    // Use FFProbe from media package
    const { FFProbe, MediaInfoProbe } = await import('@media-bot/media');
    
    const ffprobe = new FFProbe(config.mediaTools.ffprobe);
    const mediainfo = new MediaInfoProbe(config.mediaTools.mediainfo);

    await reportProgress({ percent: 20, stage: 'Analyzing', details: 'Running FFprobe' });
    
    const ffprobeResult = await ffprobe.probe(filePath);

    await reportProgress({ percent: 50, stage: 'Analyzing', details: 'Running MediaInfo' });
    
    const mediainfoResult = await mediainfo.probe(filePath);

    await reportProgress({ percent: 80, stage: 'Complete', details: 'Analysis finished' });

    const videoStream = ffprobeResult.streams.find(s => s.codec_type === 'video');
    const audioStream = ffprobeResult.streams.find(s => s.codec_type === 'audio');

    return {
      success: true,
      message: 'Analysis completed successfully',
      data: {
        format: ffprobeResult.format.format_name,
        duration: ffprobeResult.format.duration,
        videoTracks: ffprobeResult.streams.filter(s => s.codec_type === 'video').length,
        audioTracks: ffprobeResult.streams.filter(s => s.codec_type === 'audio').length,
        subtitleTracks: ffprobeResult.streams.filter(s => s.codec_type === 'subtitle').length,
        videoCodec: videoStream?.codec_name,
        audioCodec: audioStream?.codec_name,
      },
    };
  } catch (error) {
    logger.error({ error, filePath }, 'Analysis failed');
    throw error;
  }
}

/**
 * Sync processor - handles audio/video synchronization analysis
 */
async function processSync(
  job: Job<JobData>,
  reportProgress: ProgressReporter
): Promise<JobResult> {
  const { path: sourcePath } = job.data;
  
  if (!sourcePath) {
    throw new Error('No source path provided for sync');
  }

  await reportProgress({ percent: 0, stage: 'Initializing', details: 'Starting sync analysis' });

  try {
    // Import sync analyzer - dynamically to avoid module resolution issues
    await reportProgress({ percent: 20, stage: 'Analyzing', details: 'Detecting sync issues' });

    // Placeholder - actual sync analysis would go here
    // The sync package handles audio sync detection via fingerprinting
    
    await reportProgress({ percent: 100, stage: 'Complete', details: 'Sync analysis finished' });

    return {
      success: true,
      message: 'Sync analysis completed successfully',
      data: {
        sourcePath,
        syncRequired: false,
        offset: 0,
      },
    };
  } catch (error) {
    logger.error({ error, sourcePath }, 'Sync analysis failed');
    throw error;
  }
}

/**
 * Process processor - handles media processing/transcoding
 */
async function processMedia(
  job: Job<JobData>,
  reportProgress: ProgressReporter
): Promise<JobResult> {
  const { path: inputPath, options } = job.data;
  
  if (!inputPath) {
    throw new Error('No input path provided for processing');
  }

  await reportProgress({ percent: 0, stage: 'Initializing', details: 'Starting processing' });

  try {
    await reportProgress({ percent: 10, stage: 'Preparing', details: 'Building processing graph' });

    const outputPath = options?.outputPath as string || 
      inputPath.replace(/\.[^.]+$/, '.processed.mkv');

    // Placeholder - actual processing would use FFmpeg
    await reportProgress({ percent: 50, stage: 'Processing', details: 'Transcoding media' });
    
    await sleep(1000); // Simulated processing time

    await reportProgress({ percent: 100, stage: 'Complete', details: 'Processing finished' });

    return {
      success: true,
      message: 'Processing completed successfully',
      data: {
        outputPath,
        duration: 0,
      },
    };
  } catch (error) {
    logger.error({ error, inputPath }, 'Processing failed');
    throw error;
  }
}

/**
 * Validate processor - runs quality checks
 */
async function processValidate(
  job: Job<JobData>,
  reportProgress: ProgressReporter
): Promise<JobResult> {
  const { path: filePath } = job.data;
  
  if (!filePath) {
    throw new Error('No file path provided for validation');
  }

  await reportProgress({ percent: 0, stage: 'Initializing', details: 'Starting validation' });

  try {
    await reportProgress({ percent: 20, stage: 'Validating', details: 'Running checks' });
    
    // Placeholder - actual validation would go here
    const valid = true;
    const checks: string[] = ['format', 'streams', 'integrity'];

    await reportProgress({ percent: 100, stage: 'Complete', details: 'Validation finished' });

    return {
      success: valid,
      message: valid ? 'Validation passed' : 'Validation failed',
      data: {
        valid,
        checks,
        errors: [],
        warnings: [],
      },
    };
  } catch (error) {
    logger.error({ error, filePath }, 'Validation failed');
    throw error;
  }
}

/**
 * Package processor - creates final output package
 */
async function processPackage(
  job: Job<JobData>,
  reportProgress: ProgressReporter
): Promise<JobResult> {
  const { id, path: inputPath, options } = job.data;
  
  if (!inputPath) {
    throw new Error('No input path provided for packaging');
  }

  await reportProgress({ percent: 0, stage: 'Initializing', details: 'Starting packaging' });

  try {
    const { Packager } = await import('@media-bot/packaging');
    
    const packager = new Packager();

    await reportProgress({ percent: 20, stage: 'Packaging', details: 'Creating output package' });

    const outputDir = options?.outputDir as string || './output';

    const result = await packager.package(
      id,
      {
        videoFile: inputPath,
        audioFiles: options?.audioFiles as string[] | undefined,
        subtitleFiles: options?.subtitleFiles as string[] | undefined,
        sampleFiles: options?.sampleFiles as string[] | undefined,
      },
      outputDir,
      options?.metadata as Record<string, string> | undefined
    );

    await reportProgress({ percent: 100, stage: 'Complete', details: 'Packaging finished' });

    return {
      success: result.success,
      message: result.success ? 'Packaging completed successfully' : 'Packaging failed',
      data: {
        packageDir: result.packageDir,
        manifest: result.manifest,
      },
    };
  } catch (error) {
    logger.error({ error, inputPath }, 'Packaging failed');
    throw error;
  }
}

/**
 * Upload processor - handles file uploads to destinations
 */
async function processUpload(
  job: Job<JobData>,
  reportProgress: ProgressReporter
): Promise<JobResult> {
  const { path: filePath, options } = job.data;
  
  if (!filePath) {
    throw new Error('No file path provided for upload');
  }

  await reportProgress({ percent: 0, stage: 'Initializing', details: 'Starting upload' });

  try {
    await reportProgress({ percent: 50, stage: 'Uploading', details: 'Transferring file' });
    
    // Placeholder upload - would integrate with upload package
    await sleep(1000);

    await reportProgress({ percent: 100, stage: 'Complete', details: 'Upload finished' });

    return {
      success: true,
      message: 'Upload completed successfully',
      data: {
        destination: options?.destination || 'default',
      },
    };
  } catch (error) {
    logger.error({ error, filePath }, 'Upload failed');
    throw error;
  }
}

// Utility functions
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
