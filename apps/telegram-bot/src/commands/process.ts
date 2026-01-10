/**
 * Process Command - The All-Mighty Media Processing Pipeline
 * 
 * /process "videolink" "audiolink"
 * 
 * This command:
 * 1. Downloads video and audio from provided links (supports GDrive, HTTP, local)
 * 2. Analyzes both files for FPS, duration, delay issues
 * 3. Syncs audio if needed (tempo adjustment, delay)
 * 4. Muxes synced audio with video into MKV
 * 5. Generates a 30-second sample
 * 6. Notifies user with output location
 */

import { existsSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import type { Logger } from 'pino';
import type { Context } from 'grammy';
import type { BotContext } from '../index.js';
import { config } from '../config.js';
import { MediaAnalyzer } from '@media-bot/media';
import { execFFmpeg, execMkvmerge } from '@media-bot/utils';
import { GDriveApiClient, type GDriveProgress } from '@media-bot/acquisition';
import { AudioSyncAnalyzer, type SyncAnalysisResult as ProfessionalSyncResult } from '@media-bot/sync';

/**
 * Download result interface
 */
interface DownloadResult {
  success: boolean;
  filePath: string;
  fileName: string;
  error?: string;
}

/**
 * Sync analysis result
 */
interface SyncAnalysisResult {
  needsSync: boolean;
  videoFps: number;
  audioFps: number;
  videoDuration: number;
  audioDuration: number;
  tempoFactor: number;
  delayMs: number;
  confidence: number;
  /** Professional analysis results if available */
  professionalAnalysis?: ProfessionalSyncResult;
  /** Was professional analysis used? */
  usedProfessionalAnalysis: boolean;
}

/**
 * Parse quoted arguments from command text
 */
function parseQuotedArgs(text: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (const char of text) {
    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = '';
      if (current) {
        args.push(current);
        current = '';
      }
    } else if (char === ' ' && !inQuotes) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}

/**
 * Detect link type
 */
function detectLinkType(link: string): 'gdrive' | 'http' | 'local' {
  if (link.includes('drive.google.com') || link.startsWith('gdrive://')) {
    return 'gdrive';
  }
  if (link.startsWith('http://') || link.startsWith('https://')) {
    return 'http';
  }
  return 'local';
}

/**
 * Download file from URL or GDrive
 */
async function downloadFile(
  link: string,
  outputDir: string,
  logger: Logger,
  onProgress?: (msg: string) => void
): Promise<DownloadResult> {
  const linkType = detectLinkType(link);

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Local file - just verify it exists
  if (linkType === 'local') {
    if (!existsSync(link)) {
      return { success: false, filePath: link, fileName: basename(link), error: 'File not found' };
    }
    return { success: true, filePath: link, fileName: basename(link) };
  }

  // Google Drive download
  if (linkType === 'gdrive') {
    if (!config.gdrive.apiKey) {
      return { success: false, filePath: '', fileName: '', error: 'Google Drive API key not configured' };
    }

    const gdrive = new GDriveApiClient({
      apiKey: config.gdrive.apiKey,
      downloadPath: outputDir,
    });

    const fileId = GDriveApiClient.extractFileId(link);
    if (!fileId) {
      return { success: false, filePath: '', fileName: '', error: 'Invalid Google Drive link' };
    }

    try {
      // Get metadata first
      const metadata = await gdrive.getFileMetadata(fileId);
      onProgress?.(`[DL] Downloading: ${metadata.name} (${formatSize(parseInt(metadata.size))})`);

      gdrive.on('progress', (progress: GDriveProgress) => {
        onProgress?.(`[DL] ${metadata.name}: ${progress.percentage}% (${formatSpeed(progress.speed)})`);
      });

      const result = await gdrive.downloadFile(link, outputDir);
      
      if (result.success) {
        logger.info({ fileId, fileName: result.fileName }, 'GDrive download completed');
        return { success: true, filePath: result.filePath, fileName: result.fileName };
      } else {
        return { success: false, filePath: '', fileName: '', error: result.error };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, fileId }, 'GDrive download failed');
      return { success: false, filePath: '', fileName: '', error: errorMsg };
    }
  }

  // HTTP download using aria2c binary for better performance
  if (linkType === 'http') {
    try {
      onProgress?.(`[DL] Starting download: ${link}`);
      
      const result = await downloadWithAria2c(link, outputDir, logger, onProgress);
      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, url: link }, 'HTTP download failed');
      return { success: false, filePath: '', fileName: '', error: errorMsg };
    }
  }

  return { success: false, filePath: '', fileName: '', error: 'Unknown link type' };
}

/**
 * Download file using aria2c binary
 */
async function downloadWithAria2c(
  url: string,
  outputDir: string,
  logger: Logger,
  onProgress?: (msg: string) => void
): Promise<DownloadResult> {
  return new Promise((resolve) => {
    const aria2cPath = config.binaries.aria2c;
    
    // aria2c arguments for fast downloading
    const args = [
      url,
      '-d', outputDir,               // Output directory
      '-x', '16',                    // Max connections per server
      '-s', '16',                    // Split file into 16 pieces
      '-k', '1M',                    // Min split size
      '--file-allocation=none',     // Don't pre-allocate
      '--auto-file-renaming=false', // Don't rename on conflict
      '--allow-overwrite=true',     // Overwrite if exists
      '--console-log-level=notice', // Log level
      '--summary-interval=2',       // Progress interval
      '--download-result=full',     // Show download result
    ];

    logger.info({ aria2cPath, url, outputDir }, 'Starting aria2c download');
    
    const proc = spawn(aria2cPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let fileName = '';
    let filePath = '';
    let lastProgress = '';

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      
      // Parse progress from aria2c output
      // Example: [#abc123 1.2MiB/10MiB(12%) CN:16 DL:5.2MiB]
      const progressMatch = text.match(/\[#\w+\s+[\d.]+\w+\/([\d.]+\w+)\((\d+)%\).*?DL:([\d.]+\w+)/);
      if (progressMatch) {
        const [, total, percent, speed] = progressMatch;
        const progressMsg = `[DL] ${percent}% of ${total} (${speed}/s)`;
        if (progressMsg !== lastProgress) {
          lastProgress = progressMsg;
          onProgress?.(progressMsg);
        }
      }
      
      // Parse filename from output
      // Example: Download complete: /path/to/file.mkv
      const completeMatch = text.match(/Download complete:\s*(.+)/);
      if (completeMatch) {
        filePath = completeMatch[1].trim();
        fileName = basename(filePath);
      }
      
      // Also try to get filename from "Downloading X item(s)"
      const fileMatch = text.match(/\[DL\]\s+(\S+)/);
      if (fileMatch && !fileName) {
        fileName = fileMatch[1];
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        // If we didn't get the filename from output, try to find it in the directory
        if (!filePath) {
          try {
            // Get the most recently modified file in the output directory
            const files = readdirSync(outputDir)
              .map(f => ({ name: f, path: join(outputDir, f) }))
              .filter(f => {
                try {
                  const stat = require('fs').statSync(f.path);
                  return stat.isFile();
                } catch {
                  return false;
                }
              });
            
            if (files.length > 0) {
              // Find file that matches URL filename or most recent
              const urlFileName = basename(new URL(url).pathname);
              const matchingFile = files.find(f => f.name === urlFileName);
              if (matchingFile) {
                filePath = matchingFile.path;
                fileName = matchingFile.name;
              }
            }
          } catch (e) {
            logger.warn({ error: e }, 'Could not determine downloaded file');
          }
        }
        
        if (filePath && existsSync(filePath)) {
          logger.info({ url, filePath, fileName }, 'aria2c download completed');
          resolve({ success: true, filePath, fileName });
        } else {
          resolve({ success: false, filePath: '', fileName: '', error: 'Download completed but file not found' });
        }
      } else {
        logger.error({ code, stderr }, 'aria2c download failed');
        resolve({ success: false, filePath: '', fileName: '', error: stderr || `aria2c exited with code ${code}` });
      }
    });

    proc.on('error', (error) => {
      logger.error({ error }, 'aria2c process error - is aria2c installed?');
      resolve({ success: false, filePath: '', fileName: '', error: `aria2c not found or failed: ${error.message}` });
    });
  });
}

/**
 * Analyze files and determine sync parameters
 * Uses the professional AudioSyncAnalyzer for waveform-based analysis
 */
async function analyzeSync(
  videoPath: string,
  audioPath: string,
  logger: Logger,
  options: { useProfessionalAnalysis?: boolean } = {}
): Promise<SyncAnalysisResult> {
  const mediaAnalyzer = new MediaAnalyzer();
  const useProfessional = options.useProfessionalAnalysis ?? true;

  const [videoResult, audioResult] = await Promise.all([
    mediaAnalyzer.analyze(videoPath),
    mediaAnalyzer.analyze(audioPath),
  ]);

  const videoMeta = videoResult.metadata;
  const audioMeta = audioResult.metadata;

  const videoStream = videoMeta.videoStreams[0];
  const videoFps = videoStream?.fps ?? 23.976;
  const videoDuration = videoMeta.duration;
  const audioDuration = audioMeta.duration;

  // Calculate duration difference
  const rawDiff = videoDuration - audioDuration;

  // FPS detection - check common conversions
  const fpsRatios = [
    { from: 24, to: 23.976 },
    { from: 25, to: 23.976 },
    { from: 25, to: 24 },
    { from: 23.976, to: 24 },
    { from: 24, to: 25 },
  ];

  let detectedAudioFps = videoFps; // Assume same if no pattern matches
  let tempoFactor = 1.0;
  let bestMatch = Math.abs(rawDiff);

  for (const { from, to } of fpsRatios) {
    const ratio = from / to;
    const projected = audioDuration * ratio;
    const diff = Math.abs(projected - videoDuration);

    if (diff < bestMatch && diff < 5) { // Within 5 seconds is a good match
      bestMatch = diff;
      detectedAudioFps = from;
      tempoFactor = from / videoFps;
    }
  }

  // Calculate delay after tempo correction (basic method)
  const projectedDuration = audioDuration * tempoFactor;
  let delayMs = Math.round((videoDuration - projectedDuration) * 1000);

  // Confidence based on how well the pattern matches
  let confidence = bestMatch < 0.5 ? 0.95 : bestMatch < 2 ? 0.8 : bestMatch < 5 ? 0.6 : 0.4;

  // Try professional audio sync analysis (waveform comparison like Audacity)
  let professionalAnalysis: ProfessionalSyncResult | undefined;
  let usedProfessionalAnalysis = false;

  if (useProfessional) {
    try {
      logger.info('Running professional audio sync analysis (waveform comparison)...');
      
      const syncAnalyzer = new AudioSyncAnalyzer({
        useFingerprinting: true,
        deepAnalysis: false, // Use fast mode for initial analysis
        maxOffsetSec: 30,
        minConfidence: 0.5,
      });

      // Extract audio from video for comparison
      professionalAnalysis = await syncAnalyzer.analyze(videoPath, audioPath);
      
      if (professionalAnalysis.confidence > 0.6) {
        usedProfessionalAnalysis = true;
        
        // Use professional analysis results
        delayMs = professionalAnalysis.globalDelayMs;
        confidence = professionalAnalysis.confidence;

        // Check for tempo/drift issues
        if (professionalAnalysis.hasDrift) {
          const driftInfo = `Drift detected: ${professionalAnalysis.driftRate.toFixed(2)}ms/sec`;
          logger.warn({ driftRate: professionalAnalysis.driftRate }, driftInfo);
        }

        // Apply recommended tempo if provided
        if (professionalAnalysis.correction.parameters.tempoFactor) {
          tempoFactor = professionalAnalysis.correction.parameters.tempoFactor;
        }

        logger.info({
          method: 'professional',
          status: professionalAnalysis.status,
          delayMs,
          confidence,
          isSameSource: professionalAnalysis.isSameSource,
          similarity: professionalAnalysis.similarity,
          hasDrift: professionalAnalysis.hasDrift,
          hasStructuralDifferences: professionalAnalysis.hasStructuralDifferences,
        }, 'Professional sync analysis completed');
      } else {
        logger.info({ confidence: professionalAnalysis.confidence }, 
          'Professional analysis confidence too low, using duration-based analysis');
      }
    } catch (error) {
      logger.warn({ error }, 'Professional sync analysis failed, falling back to duration-based');
    }
  }

  // Determine if sync is needed
  const needsSync = Math.abs(tempoFactor - 1.0) > 0.0001 || Math.abs(delayMs) > 50;

  logger.info({
    videoFps,
    detectedAudioFps,
    tempoFactor,
    delayMs,
    confidence,
    needsSync,
    usedProfessionalAnalysis,
  }, 'Sync analysis completed');

  return {
    needsSync,
    videoFps,
    audioFps: detectedAudioFps,
    videoDuration,
    audioDuration,
    tempoFactor,
    delayMs,
    confidence,
    professionalAnalysis,
    usedProfessionalAnalysis,
  };
}

/**
 * Sync audio file (apply tempo and delay)
 * IMPORTANT: Preserves original format - uses stream copy when possible
 */
async function syncAudio(
  inputPath: string,
  outputPath: string,
  tempoFactor: number,
  delayMs: number,
  logger: Logger
): Promise<void> {
  const filters: string[] = [];
  const needsTempo = Math.abs(tempoFactor - 1.0) > 0.0001;
  const needsPositiveDelay = delayMs > 0;
  const needsNegativeDelay = delayMs < 0;
  
  // Only add filters if tempo change is needed
  if (needsTempo) {
    // Fix channel layout for 5.1(side) compatibility when re-encoding
    filters.push('aformat=channel_layouts=5.1');
    
    let remaining = tempoFactor;
    
    // Chain atempo filters (range: 0.5-2.0)
    while (remaining > 2.0) {
      filters.push('atempo=2.0');
      remaining /= 2.0;
    }
    while (remaining < 0.5) {
      filters.push('atempo=0.5');
      remaining /= 0.5;
    }
    filters.push(`atempo=${remaining.toFixed(10)}`);
  }

  // Add delay filter only if positive delay AND tempo change (requires re-encoding anyway)
  if (needsPositiveDelay && needsTempo) {
    filters.push(`adelay=${delayMs}|${delayMs}`);
  }

  // Build FFmpeg command
  const ffmpegArgs: string[] = ['-y'];

  // Handle negative delay with -ss (works with stream copy)
  if (needsNegativeDelay) {
    ffmpegArgs.push('-ss', String(Math.abs(delayMs) / 1000));
  }

  ffmpegArgs.push('-i', inputPath);

  // If we need tempo change, we MUST re-encode
  if (needsTempo) {
    ffmpegArgs.push('-af', filters.join(','));
    
    // Use codec based on extension to preserve format
    const ext = extname(outputPath).toLowerCase();
    switch (ext) {
      case '.mp4':
      case '.m4a':
        ffmpegArgs.push('-c:a', 'aac', '-b:a', '320k');
        break;
      case '.flac':
        ffmpegArgs.push('-c:a', 'flac');
        break;
      case '.ac3':
        ffmpegArgs.push('-c:a', 'ac3', '-b:a', '640k');
        break;
      case '.eac3':
      case '.ec3':
        ffmpegArgs.push('-c:a', 'eac3', '-b:a', '640k');
        break;
      case '.dts':
        ffmpegArgs.push('-c:a', 'dca', '-b:a', '1536k');
        break;
      case '.opus':
        ffmpegArgs.push('-c:a', 'libopus', '-b:a', '192k');
        break;
      case '.ogg':
        ffmpegArgs.push('-c:a', 'libvorbis', '-b:a', '192k');
        break;
      case '.mp3':
        ffmpegArgs.push('-c:a', 'libmp3lame', '-b:a', '320k');
        break;
      case '.mka':
      case '.mkv':
        // For MKA/MKV, try to use the best available codec
        ffmpegArgs.push('-c:a', 'libopus', '-b:a', '192k', '-mapping_family', '1');
        break;
      default:
        // Default: try to preserve with high quality AAC
        ffmpegArgs.push('-c:a', 'aac', '-b:a', '320k');
    }
  } else if (needsPositiveDelay && !needsTempo) {
    // Positive delay only, no tempo - we need adelay filter which requires re-encoding
    filters.push('aformat=channel_layouts=5.1');
    filters.push(`adelay=${delayMs}|${delayMs}`);
    ffmpegArgs.push('-af', filters.join(','));
    
    // Use same codec logic
    const ext = extname(outputPath).toLowerCase();
    switch (ext) {
      case '.mp4':
      case '.m4a':
        ffmpegArgs.push('-c:a', 'aac', '-b:a', '320k');
        break;
      case '.flac':
        ffmpegArgs.push('-c:a', 'flac');
        break;
      case '.ac3':
        ffmpegArgs.push('-c:a', 'ac3', '-b:a', '640k');
        break;
      case '.eac3':
      case '.ec3':
        ffmpegArgs.push('-c:a', 'eac3', '-b:a', '640k');
        break;
      default:
        ffmpegArgs.push('-c:a', 'aac', '-b:a', '320k');
    }
  } else {
    // No tempo, negative delay only (or no changes) - use stream copy!
    ffmpegArgs.push('-c:a', 'copy');
  }

  ffmpegArgs.push(outputPath);

  logger.info({ inputPath, outputPath, tempoFactor, delayMs, filters, needsTempo }, 'Syncing audio');
  await execFFmpeg(ffmpegArgs);
}

/**
 * Mux video and audio into MKV
 */
async function muxToMkv(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  audioTitle: string,
  logger: Logger
): Promise<void> {
  const mkvArgs = [
    '-o', outputPath,
    '--no-audio', videoPath, // Only video from source
    '--track-name', `0:${audioTitle}`,
    '--language', '0:hin',
    audioPath,
  ];

  logger.info({ videoPath, audioPath, outputPath }, 'Muxing to MKV');
  await execMkvmerge(mkvArgs);
}

/**
 * Generate 30-second sample from middle of video
 */
async function generateSample(
  inputPath: string,
  outputPath: string,
  logger: Logger
): Promise<void> {
  // First, get video duration
  const analyzer = new MediaAnalyzer();
  const result = await analyzer.analyze(inputPath);
  const duration = result.metadata.duration;

  // Start sample from 1/3 into the video
  const startTime = Math.floor(duration / 3);
  const sampleDuration = 30;

  const ffmpegArgs = [
    '-y',
    '-ss', String(startTime),
    '-i', inputPath,
    '-t', String(sampleDuration),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath,
  ];

  logger.info({ inputPath, outputPath, startTime, sampleDuration }, 'Generating sample');
  await execFFmpeg(ffmpegArgs);
}

/**
 * Format file size
 */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * Format speed
 */
function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
}

/**
 * Format duration
 */
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Register the /process command
 */
export function registerProcessCommand(
  bot: any,
  logger: Logger
): void {
  bot.command('process', async (ctx: BotContext) => {
    const text = ctx.message?.text ?? '';
    const args = parseQuotedArgs(text.slice('/process'.length).trim());

    if (args.length < 2) {
      await ctx.reply(
        `[PIPELINE] *All-Mighty Process Command*\n\n` +
        `Usage: \`/process "video_link" "audio_link"\`\n\n` +
        `*Supported Links:*\n` +
        `- Google Drive: \`https://drive.google.com/file/d/...\`\n` +
        `- Direct HTTP: \`https://example.com/file.mkv\`\n` +
        `- Local path: \`C:\\Videos\\movie.mkv\`\n\n` +
        `*What it does:*\n` +
        `1. Downloads video & audio\n` +
        `2. Analyzes FPS & duration\n` +
        `3. Syncs audio (tempo + delay)\n` +
        `4. Muxes into MKV\n` +
        `5. Generates 30s sample\n\n` +
        `*Example:*\n` +
        `\`/process "https://drive.google.com/file/d/abc123" "https://drive.google.com/file/d/xyz789"\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const videoLink = args[0];
    const audioLink = args[1];

    const progressMsg = await ctx.reply(
      `[PIPELINE] *Starting Process Pipeline*\n\n` +
      `[VIDEO] Video: ${videoLink.length > 50 ? videoLink.slice(0, 47) + '...' : videoLink}\n` +
      `[AUDIO] Audio: ${audioLink.length > 50 ? audioLink.slice(0, 47) + '...' : audioLink}\n\n` +
      `(waiting) Initializing...`,
      { parse_mode: 'Markdown' }
    );
    const chatId = ctx.chat!.id;
    const msgId = progressMsg.message_id;

    // Update status helper
    const updateStatus = async (status: string) => {
      try {
        await ctx.api.editMessageText(chatId, msgId, status, { parse_mode: 'Markdown' });
      } catch {
        // Ignore edit errors (message might be same)
      }
    };

    // Run pipeline in background
    setImmediate(async () => {
      const startTime = Date.now();
      const workDir = config.storage.working;
      const samplesDir = config.storage.samples;

      // Ensure directories exist
      if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });
      if (!existsSync(samplesDir)) mkdirSync(samplesDir, { recursive: true });

      let videoPath = '';
      let audioPath = '';
      let syncedAudioPath = '';
      let muxedPath = '';
      let samplePath = '';

      try {
        // ===== STEP 1: Download Video =====
        await updateStatus(
          `[PIPELINE] *Process Pipeline*\n\n` +
          `[VIDEO] *Step 1/5: Downloading Video...*\n` +
          `(waiting) Please wait...`
        );

        const videoResult = await downloadFile(
          videoLink,
          workDir,
          logger,
          async (msg) => {
            await updateStatus(
              `[PIPELINE] *Process Pipeline*\n\n` +
              `[VIDEO] *Step 1/5: Downloading Video*\n${msg}`
            );
          }
        );

        if (!videoResult.success) {
          throw new Error(`Video download failed: ${videoResult.error}`);
        }
        videoPath = videoResult.filePath;
        logger.info({ videoPath }, 'Video downloaded');

        // ===== STEP 2: Download Audio =====
        await updateStatus(
          `[PIPELINE] *Process Pipeline*\n\n` +
          `[OK] Video: \`${videoResult.fileName}\`\n\n` +
          `[AUDIO] *Step 2/5: Downloading Audio...*\n` +
          `(waiting) Please wait...`
        );

        const audioResult = await downloadFile(
          audioLink,
          workDir,
          logger,
          async (msg) => {
            await updateStatus(
              `[PIPELINE] *Process Pipeline*\n\n` +
              `[OK] Video: \`${videoResult.fileName}\`\n\n` +
              `[AUDIO] *Step 2/5: Downloading Audio*\n${msg}`
            );
          }
        );

        if (!audioResult.success) {
          throw new Error(`Audio download failed: ${audioResult.error}`);
        }
        audioPath = audioResult.filePath;
        logger.info({ audioPath }, 'Audio downloaded');

        // ===== STEP 3: Analyze & Sync =====
        await updateStatus(
          `[PIPELINE] *Process Pipeline*\n\n` +
          `[OK] Video: \`${videoResult.fileName}\`\n` +
          `[OK] Audio: \`${audioResult.fileName}\`\n\n` +
          `[SYNC] *Step 3/5: Analyzing & Syncing...*\n` +
          `(waiting) Detecting FPS and timing...`
        );

        const syncResult = await analyzeSync(videoPath, audioPath, logger);

        // Output synced audio with same extension as original
        const originalExt = extname(audioPath);
        const audioBasename = basename(audioPath, originalExt);
        syncedAudioPath = join(workDir, `${audioBasename}_synced${originalExt}`);

        if (syncResult.needsSync) {
          const analysisMethod = syncResult.usedProfessionalAnalysis ? '🎯 Professional (Waveform)' : '📊 Duration-based';
          const professionalInfo = syncResult.professionalAnalysis 
            ? `\nSimilarity: ${(syncResult.professionalAnalysis.similarity * 100).toFixed(0)}%` +
              (syncResult.professionalAnalysis.hasDrift ? `\n⚠️ Drift: ${syncResult.professionalAnalysis.driftRate.toFixed(2)}ms/s` : '') +
              (syncResult.professionalAnalysis.hasStructuralDifferences ? `\n⚠️ Structural changes detected` : '')
            : '';
          
          await updateStatus(
            `[PIPELINE] *Process Pipeline*\n\n` +
            `[OK] Video: \`${videoResult.fileName}\`\n` +
            `[OK] Audio: \`${audioResult.fileName}\`\n\n` +
            `[SYNC] *Step 3/5: Syncing Audio*\n` +
            `Method: ${analysisMethod}\n` +
            `FPS: ${syncResult.audioFps} -> ${syncResult.videoFps.toFixed(3)}\n` +
            `Tempo: ${syncResult.tempoFactor.toFixed(6)}\n` +
            `Delay: ${syncResult.delayMs}ms\n` +
            `Confidence: ${(syncResult.confidence * 100).toFixed(0)}%${professionalInfo}\n` +
            `(waiting) Processing...`
          );

          await syncAudio(
            audioPath,
            syncedAudioPath,
            syncResult.tempoFactor,
            syncResult.delayMs,
            logger
          );
        } else {
          // No sync needed, use original
          syncedAudioPath = audioPath;
        }

        // ===== STEP 4: Mux to MKV =====
        const videoBasename = basename(videoPath, extname(videoPath));
        muxedPath = join(workDir, `${videoBasename}.SYNCED.mkv`);

        await updateStatus(
          `[PIPELINE] *Process Pipeline*\n\n` +
          `[OK] Video: \`${videoResult.fileName}\`\n` +
          `[OK] Audio: \`${audioResult.fileName}\`\n` +
          `[OK] Sync: ${syncResult.needsSync ? `Applied (${syncResult.tempoFactor.toFixed(4)}x, ${syncResult.delayMs}ms)` : 'Not needed'}\n\n` +
          `[PKG] *Step 4/5: Muxing to MKV...*\n` +
          `(waiting) Creating final output...`
        );

        await muxToMkv(
          videoPath,
          syncedAudioPath,
          muxedPath,
          'Hindi Synced',
          logger
        );

        // ===== STEP 5: Generate Sample =====
        samplePath = join(samplesDir, `${videoBasename}_sample.mp4`);

        await updateStatus(
          `[PIPELINE] *Process Pipeline*\n\n` +
          `[OK] Video: \`${videoResult.fileName}\`\n` +
          `[OK] Audio: \`${audioResult.fileName}\`\n` +
          `[OK] Sync: Applied\n` +
          `[OK] Muxed: \`${basename(muxedPath)}\`\n\n` +
          `[SAMPLE] *Step 5/5: Generating Sample...*\n` +
          `(waiting) Creating 30s preview...`
        );

        await generateSample(muxedPath, samplePath, logger);

        // ===== COMPLETE =====
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        // Get final file sizes
        const fs = await import('node:fs/promises');
        const muxedStats = await fs.stat(muxedPath);
        const sampleStats = await fs.stat(samplePath);

        const analysisMethod = syncResult.usedProfessionalAnalysis ? '🎯 Professional (Waveform)' : '📊 Duration-based';
        const professionalInfo = syncResult.professionalAnalysis 
          ? `| Similarity: ${(syncResult.professionalAnalysis.similarity * 100).toFixed(0)}%\n` +
            (syncResult.professionalAnalysis.hasDrift ? `| ⚠️ Drift: ${syncResult.professionalAnalysis.driftRate.toFixed(2)}ms/s\n` : '') +
            (syncResult.professionalAnalysis.hasStructuralDifferences ? `| ⚠️ Structural changes\n` : '')
          : '';

        await ctx.api.editMessageText(
          chatId,
          msgId,
          `[OK] *Process Complete!*\n\n` +
          `------------------------\n` +
          `[VIDEO] *Video:* \`${videoResult.fileName}\`\n` +
          `[AUDIO] *Audio:* \`${audioResult.fileName}\`\n` +
          `------------------------\n\n` +
          `[SYNC] *Sync Analysis:*\n` +
          `| Method: ${analysisMethod}\n` +
          `| Video FPS: ${syncResult.videoFps.toFixed(3)}\n` +
          `| Audio FPS: ${syncResult.audioFps}\n` +
          `| Tempo: ${syncResult.tempoFactor.toFixed(6)}x\n` +
          `| Delay: ${syncResult.delayMs}ms\n` +
          `| Confidence: ${(syncResult.confidence * 100).toFixed(0)}%\n` +
          professionalInfo +
          `\n[PKG] *Output:*\n` +
          `| File: \`${basename(muxedPath)}\`\n` +
          `| Size: ${formatSize(muxedStats.size)}\n` +
          `| Path: \`${dirname(muxedPath)}\`\n\n` +
          `[SAMPLE] *Sample:*\n` +
          `| File: \`${basename(samplePath)}\`\n` +
          `| Size: ${formatSize(sampleStats.size)}\n\n` +
          `(time) Total Time: ${elapsed}s`,
          { parse_mode: 'Markdown' }
        );

        logger.info({
          videoPath: muxedPath,
          samplePath,
          elapsed,
          syncResult,
        }, 'Process pipeline completed');

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ error }, 'Process pipeline failed');

        await ctx.api.editMessageText(
          chatId,
          msgId,
          `[ERR] *Process Failed*\n\n` +
          `Error: ${errorMsg}\n\n` +
          `Please check the links and try again.`,
          { parse_mode: 'Markdown' }
        );
      }
    });
  });

  logger.info('Process command registered');
}
