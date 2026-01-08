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

import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import type { Logger } from 'pino';
import type { Context } from 'grammy';
import type { BotContext } from '../index.js';
import { config } from '../config.js';
import { MediaAnalyzer } from '@media-bot/media';
import { execFFmpeg, execMkvmerge } from '@media-bot/utils';
import { GDriveApiClient, type GDriveProgress } from '@media-bot/acquisition';

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
      onProgress?.(`📥 Downloading: ${metadata.name} (${formatSize(parseInt(metadata.size))})`);

      gdrive.on('progress', (progress: GDriveProgress) => {
        onProgress?.(`📥 ${metadata.name}: ${progress.percentage}% (${formatSpeed(progress.speed)})`);
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

  // HTTP download using fetch + streaming
  if (linkType === 'http') {
    try {
      onProgress?.(`📥 Fetching: ${link}`);
      
      const response = await fetch(link);
      if (!response.ok) {
        return { success: false, filePath: '', fileName: '', error: `HTTP ${response.status}` };
      }

      // Extract filename from URL or Content-Disposition
      let fileName = basename(new URL(link).pathname);
      const contentDisposition = response.headers.get('content-disposition');
      if (contentDisposition) {
        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match?.[1]) {
          fileName = match[1].replace(/['"]/g, '');
        }
      }
      if (!fileName || fileName === '/') {
        fileName = `download_${Date.now()}`;
      }

      const filePath = join(outputDir, fileName);
      const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);
      
      if (!response.body) {
        return { success: false, filePath: '', fileName: '', error: 'No response body' };
      }

      // Stream to file
      const fs = await import('node:fs');
      const { pipeline } = await import('node:stream/promises');
      const { Readable } = await import('node:stream');

      let downloaded = 0;
      const transform = new (await import('node:stream')).Transform({
        transform(chunk, _encoding, callback) {
          downloaded += chunk.length;
          if (totalBytes > 0 && downloaded % (1024 * 1024) < chunk.length) {
            const pct = Math.round((downloaded / totalBytes) * 100);
            onProgress?.(`📥 ${fileName}: ${pct}%`);
          }
          callback(null, chunk);
        }
      });

      const readable = Readable.fromWeb(response.body as any);
      const writeStream = fs.createWriteStream(filePath);
      
      await pipeline(readable, transform, writeStream);
      
      logger.info({ url: link, fileName }, 'HTTP download completed');
      return { success: true, filePath, fileName };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, url: link }, 'HTTP download failed');
      return { success: false, filePath: '', fileName: '', error: errorMsg };
    }
  }

  return { success: false, filePath: '', fileName: '', error: 'Unknown link type' };
}

/**
 * Analyze files and determine sync parameters
 */
async function analyzeSync(
  videoPath: string,
  audioPath: string,
  logger: Logger
): Promise<SyncAnalysisResult> {
  const analyzer = new MediaAnalyzer();

  const [videoResult, audioResult] = await Promise.all([
    analyzer.analyze(videoPath),
    analyzer.analyze(audioPath),
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

  // Calculate delay after tempo correction
  const projectedDuration = audioDuration * tempoFactor;
  const delayMs = Math.round((videoDuration - projectedDuration) * 1000);

  // Determine if sync is needed
  const needsSync = Math.abs(tempoFactor - 1.0) > 0.0001 || Math.abs(delayMs) > 50;

  // Confidence based on how well the pattern matches
  const confidence = bestMatch < 0.5 ? 0.95 : bestMatch < 2 ? 0.8 : bestMatch < 5 ? 0.6 : 0.4;

  logger.info({
    videoFps,
    detectedAudioFps,
    tempoFactor,
    delayMs,
    confidence,
    needsSync,
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
        `⚡ *All-Mighty Process Command*\n\n` +
        `Usage: \`/process "video_link" "audio_link"\`\n\n` +
        `*Supported Links:*\n` +
        `• Google Drive: \`https://drive.google.com/file/d/...\`\n` +
        `• Direct HTTP: \`https://example.com/file.mkv\`\n` +
        `• Local path: \`C:\\Videos\\movie.mkv\`\n\n` +
        `*What it does:*\n` +
        `1️⃣ Downloads video & audio\n` +
        `2️⃣ Analyzes FPS & duration\n` +
        `3️⃣ Syncs audio (tempo + delay)\n` +
        `4️⃣ Muxes into MKV\n` +
        `5️⃣ Generates 30s sample\n\n` +
        `*Example:*\n` +
        `\`/process "https://drive.google.com/file/d/abc123" "https://drive.google.com/file/d/xyz789"\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const videoLink = args[0];
    const audioLink = args[1];

    const progressMsg = await ctx.reply(
      `⚡ *Starting Process Pipeline*\n\n` +
      `📹 Video: ${videoLink.length > 50 ? videoLink.slice(0, 47) + '...' : videoLink}\n` +
      `🎧 Audio: ${audioLink.length > 50 ? audioLink.slice(0, 47) + '...' : audioLink}\n\n` +
      `⏳ Initializing...`,
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
          `⚡ *Process Pipeline*\n\n` +
          `📹 *Step 1/5: Downloading Video...*\n` +
          `⏳ Please wait...`
        );

        const videoResult = await downloadFile(
          videoLink,
          workDir,
          logger,
          async (msg) => {
            await updateStatus(
              `⚡ *Process Pipeline*\n\n` +
              `📹 *Step 1/5: Downloading Video*\n${msg}`
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
          `⚡ *Process Pipeline*\n\n` +
          `✅ Video: \`${videoResult.fileName}\`\n\n` +
          `🎧 *Step 2/5: Downloading Audio...*\n` +
          `⏳ Please wait...`
        );

        const audioResult = await downloadFile(
          audioLink,
          workDir,
          logger,
          async (msg) => {
            await updateStatus(
              `⚡ *Process Pipeline*\n\n` +
              `✅ Video: \`${videoResult.fileName}\`\n\n` +
              `🎧 *Step 2/5: Downloading Audio*\n${msg}`
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
          `⚡ *Process Pipeline*\n\n` +
          `✅ Video: \`${videoResult.fileName}\`\n` +
          `✅ Audio: \`${audioResult.fileName}\`\n\n` +
          `🔍 *Step 3/5: Analyzing & Syncing...*\n` +
          `⏳ Detecting FPS and timing...`
        );

        const syncResult = await analyzeSync(videoPath, audioPath, logger);

        // Output synced audio with same extension as original
        const originalExt = extname(audioPath);
        const audioBasename = basename(audioPath, originalExt);
        syncedAudioPath = join(workDir, `${audioBasename}_synced${originalExt}`);

        if (syncResult.needsSync) {
          await updateStatus(
            `⚡ *Process Pipeline*\n\n` +
            `✅ Video: \`${videoResult.fileName}\`\n` +
            `✅ Audio: \`${audioResult.fileName}\`\n\n` +
            `🔍 *Step 3/5: Syncing Audio*\n` +
            `FPS: ${syncResult.audioFps} ➔ ${syncResult.videoFps.toFixed(3)}\n` +
            `Tempo: ${syncResult.tempoFactor.toFixed(6)}\n` +
            `Delay: ${syncResult.delayMs}ms\n` +
            `Confidence: ${(syncResult.confidence * 100).toFixed(0)}%\n` +
            `⏳ Processing...`
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
          `⚡ *Process Pipeline*\n\n` +
          `✅ Video: \`${videoResult.fileName}\`\n` +
          `✅ Audio: \`${audioResult.fileName}\`\n` +
          `✅ Sync: ${syncResult.needsSync ? `Applied (${syncResult.tempoFactor.toFixed(4)}x, ${syncResult.delayMs}ms)` : 'Not needed'}\n\n` +
          `📦 *Step 4/5: Muxing to MKV...*\n` +
          `⏳ Creating final output...`
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
          `⚡ *Process Pipeline*\n\n` +
          `✅ Video: \`${videoResult.fileName}\`\n` +
          `✅ Audio: \`${audioResult.fileName}\`\n` +
          `✅ Sync: Applied\n` +
          `✅ Muxed: \`${basename(muxedPath)}\`\n\n` +
          `🎬 *Step 5/5: Generating Sample...*\n` +
          `⏳ Creating 30s preview...`
        );

        await generateSample(muxedPath, samplePath, logger);

        // ===== COMPLETE =====
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        // Get final file sizes
        const fs = await import('node:fs/promises');
        const muxedStats = await fs.stat(muxedPath);
        const sampleStats = await fs.stat(samplePath);

        await ctx.api.editMessageText(
          chatId,
          msgId,
          `✅ *Process Complete!*\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📹 *Video:* \`${videoResult.fileName}\`\n` +
          `🎧 *Audio:* \`${audioResult.fileName}\`\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `📊 *Sync Analysis:*\n` +
          `├ Video FPS: ${syncResult.videoFps.toFixed(3)}\n` +
          `├ Audio FPS: ${syncResult.audioFps}\n` +
          `├ Tempo: ${syncResult.tempoFactor.toFixed(6)}x\n` +
          `├ Delay: ${syncResult.delayMs}ms\n` +
          `└ Confidence: ${(syncResult.confidence * 100).toFixed(0)}%\n\n` +
          `📦 *Output:*\n` +
          `├ File: \`${basename(muxedPath)}\`\n` +
          `├ Size: ${formatSize(muxedStats.size)}\n` +
          `└ Path: \`${dirname(muxedPath)}\`\n\n` +
          `🎬 *Sample:*\n` +
          `├ File: \`${basename(samplePath)}\`\n` +
          `└ Size: ${formatSize(sampleStats.size)}\n\n` +
          `⏱ Total Time: ${elapsed}s`,
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
          `❌ *Process Failed*\n\n` +
          `Error: ${errorMsg}\n\n` +
          `Please check the links and try again.`,
          { parse_mode: 'Markdown' }
        );
      }
    });
  });

  logger.info('Process command registered');
}
