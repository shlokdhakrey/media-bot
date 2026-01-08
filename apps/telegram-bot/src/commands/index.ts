/**
 * Telegram Bot Commands
 * 
 * All command handlers for the bot.
 */

import { Bot } from 'grammy';
import type { Logger } from 'pino';
import type { BotContext } from '../index.js';
import { prisma } from '@media-bot/core';
import { MediaAnalyzer } from '@media-bot/media';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname, extname } from 'node:path';
import { config } from '../config.js';
import { registerProcessCommand } from './process.js';

// Ensure storage directories exist
function ensureStorageDir(): string {
  const dir = config.storage.working;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Get output path - if relative, put in storage dir
function getOutputPath(outputPath: string): string {
  // If it's already an absolute path, use it
  if (outputPath.includes(':') || outputPath.startsWith('/') || outputPath.startsWith('\\')) {
    return outputPath;
  }
  // Otherwise, put it in the working directory
  const storageDir = ensureStorageDir();
  return join(storageDir, outputPath);
}

// Get codec args based on output extension
// MP4/M4A → AAC (most compatible)
// MKA/MKV/WebM → Opus (better quality at same bitrate)
// Others → Copy if possible, else Opus
function getAudioCodecArgs(outputPath: string, requiresFilter: boolean): string[] {
  const ext = extname(outputPath).toLowerCase();
  
  if (!requiresFilter) {
    // Can use stream copy (no re-encoding needed)
    return ['-c:a', 'copy'];
  }
  
  // Must re-encode due to filter
  switch (ext) {
    case '.mp4':
    case '.m4a':
    case '.mov':
      // AAC for MP4 family (best compatibility)
      return ['-c:a', 'aac', '-b:a', '256k'];
    case '.mka':
    case '.mkv':
    case '.webm':
    case '.ogg':
      // Opus for Matroska/WebM (better quality)
      return ['-c:a', 'libopus', '-b:a', '192k', '-mapping_family', '1'];
    default:
      // Default to Opus
      return ['-c:a', 'libopus', '-b:a', '192k', '-mapping_family', '1'];
  }
}

export function registerCommands(bot: Bot<BotContext>, logger: Logger): void {
  // /start - Welcome message
  bot.command('start', async (ctx) => {
    await ctx.reply(
      `🤖 *Media-Bot Control Panel*\n\n` +
      `Welcome! Use these commands:\n\n` +
      `⚡ *ALL-IN-ONE*\n` +
      `/process <video> <audio> - Full pipeline\n\n` +
      `📥 *Downloads*\n` +
      `/download <url> - Start download\n` +
      `/gdrive <link> - Download from GDrive\n` +
      `/jobs - List all jobs\n` +
      `/status <id> - Job status\n` +
      `/cancel <id> - Cancel job\n\n` +
      `🎬 *Media*\n` +
      `/analyze <path> - Analyze file\n` +
      `/releases - List releases\n\n` +
      `🔄 *Sync*\n` +
      `/sync <video> <audio> - Sync analysis\n` +
      `/delay <ms> <in> <out> - Add delay\n` +
      `/fps <src> <tgt> <in> <out> - FPS convert\n` +
      `/tempo <factor> <in> <out> - Tempo adjust\n` +
      `/mux <video> <audio> <out> - Mux files\n\n` +
      `📁 *Files*\n` +
      `/files - List output files\n` +
      `/dir - Show output directory\n\n` +
      `📊 *System*\n` +
      `/health - System health\n` +
      `/stats - Statistics\n` +
      `/binaries - Show binary paths\n` +
      `/help - Show all commands`,
      { parse_mode: 'Markdown' }
    );
  });

  // /help - Full command list with usage
  bot.command('help', async (ctx) => {
    const args = ctx.message?.text?.split(' ').slice(1) ?? [];
    const topic = args[0]?.toLowerCase();

    // Topic-specific help
    if (topic === 'process') {
      await ctx.reply(
        `⚡ */process* - All-in-One Pipeline\n\n` +
        `*Usage:*\n` +
        `\`/process "video_link" "audio_link"\`\n\n` +
        `*What it does:*\n` +
        `1️⃣ Downloads video & audio from links\n` +
        `2️⃣ Analyzes FPS & duration\n` +
        `3️⃣ Syncs audio (tempo + delay if needed)\n` +
        `4️⃣ Muxes into MKV file\n` +
        `5️⃣ Generates 30s sample\n\n` +
        `*Supported Links:*\n` +
        `• Google Drive: \`https://drive.google.com/file/d/...\`\n` +
        `• Direct HTTP: \`https://example.com/file.mkv\`\n` +
        `• Local path: \`C:\\Videos\\movie.mkv\`\n\n` +
        `*Examples:*\n` +
        `\`/process "https://drive.google.com/file/d/abc" "https://drive.google.com/file/d/xyz"\`\n` +
        `\`/process "C:\\Video.mkv" "C:\\Audio.mka"\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (topic === 'sync') {
      await ctx.reply(
        `🔄 */sync* - Sync Analysis\n\n` +
        `*Usage:*\n` +
        `\`/sync "video_path" "audio_path" [title]\`\n\n` +
        `Analyzes video and audio files to detect:\n` +
        `• FPS mismatch (24 vs 25, etc.)\n` +
        `• Duration differences\n` +
        `• Required tempo & delay corrections\n\n` +
        `*Example:*\n` +
        `\`/sync "C:\\Movie.mkv" "C:\\Hindi.mka" "Hindi DD+ 5.1"\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (topic === 'delay') {
      await ctx.reply(
        `⏱ */delay* - Add Delay to Audio\n\n` +
        `*Usage:*\n` +
        `\`/delay <milliseconds> "input" "output"\`\n\n` +
        `• Positive value = delay audio (starts later)\n` +
        `• Negative value = advance audio (starts earlier)\n\n` +
        `*Examples:*\n` +
        `\`/delay 500 "audio.mka" "delayed.mka"\`\n` +
        `\`/delay -200 "audio.mp4" "fixed.mka"\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (topic === 'fps') {
      await ctx.reply(
        `🎯 */fps* - FPS Conversion\n\n` +
        `*Usage:*\n` +
        `\`/fps <source_fps> <target_fps> "input" "output"\`\n\n` +
        `Converts audio from one FPS to another using tempo adjustment.\n\n` +
        `*Common Conversions:*\n` +
        `• 24 → 23.976 (NTSC pulldown)\n` +
        `• 25 → 23.976 (PAL to NTSC)\n` +
        `• 25 → 24 (PAL to Film)\n` +
        `• 23.976 → 24 (Reverse pulldown)\n\n` +
        `*Examples:*\n` +
        `\`/fps 25 23.976 "audio.mka" "fixed.mka"\`\n` +
        `\`/fps 24 25 "audio.mp4" "pal.mka"\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (topic === 'tempo') {
      await ctx.reply(
        `🎵 */tempo* - Tempo Adjustment\n\n` +
        `*Usage:*\n` +
        `\`/tempo <factor> "input" "output"\`\n\n` +
        `• Factor > 1.0 = faster (shorter duration)\n` +
        `• Factor < 1.0 = slower (longer duration)\n\n` +
        `*Examples:*\n` +
        `\`/tempo 1.04271 "audio.mka" "synced.mka"\`\n` +
        `\`/tempo 0.999 "audio.mp4" "slower.mka"\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (topic === 'trim') {
      await ctx.reply(
        `✂️ */trim* - Trim Audio\n\n` +
        `*Usage:*\n` +
        `\`/trim <start> <end> "input" "output"\`\n\n` +
        `Time format: HH:MM:SS.mmm or seconds\n\n` +
        `*Examples:*\n` +
        `\`/trim 0 01:30:00 "audio.mka" "trimmed.mka"\`\n` +
        `\`/trim 10.5 3600 "audio.mp4" "cut.mka"\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (topic === 'mux') {
      await ctx.reply(
        `📦 */mux* - Mux Video + Audio\n\n` +
        `*Usage:*\n` +
        `\`/mux "video" "audio" "output" [title]\`\n\n` +
        `Combines video and audio into single file.\n` +
        `Uses mkvmerge for .mkv, ffmpeg for others.\n\n` +
        `*Examples:*\n` +
        `\`/mux "Movie.mkv" "Hindi.mka" "Movie.Hindi.mkv"\`\n` +
        `\`/mux "Video.mkv" "Audio.mka" "Out.mkv" "Hindi DD+ 5.1"\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (topic === 'extract') {
      await ctx.reply(
        `📤 */extract* - Extract Stream\n\n` +
        `*Usage:*\n` +
        `\`/extract "input" <stream> "output"\`\n\n` +
        `*Stream Specifiers:*\n` +
        `• \`a:0\` - First audio track\n` +
        `• \`a:1\` - Second audio track\n` +
        `• \`s:0\` - First subtitle\n` +
        `• \`v:0\` - Video stream\n\n` +
        `*Examples:*\n` +
        `\`/extract "Movie.mkv" "a:1" "Hindi.mka"\`\n` +
        `\`/extract "Movie.mkv" "s:0" "English.srt"\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (topic === 'gdrive') {
      await ctx.reply(
        `📥 */gdrive* - Google Drive Download\n\n` +
        `*Usage:*\n` +
        `\`/gdrive <drive_link>\`\n\n` +
        `Downloads files from Google Drive using API.\n\n` +
        `*Supported Formats:*\n` +
        `• \`https://drive.google.com/file/d/FILE_ID/view\`\n` +
        `• \`https://drive.google.com/open?id=FILE_ID\`\n\n` +
        `*Example:*\n` +
        `\`/gdrive https://drive.google.com/file/d/1abc123xyz/view\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (topic === 'analyze') {
      await ctx.reply(
        `🔍 */analyze* - Media Analysis\n\n` +
        `*Usage:*\n` +
        `\`/analyze <file_path>\`\n\n` +
        `Shows detailed media info:\n` +
        `• Duration, file size\n` +
        `• Video: codec, resolution, FPS\n` +
        `• Audio: codec, channels, language\n` +
        `• Subtitles: languages\n\n` +
        `*Example:*\n` +
        `\`/analyze C:\\Videos\\Movie.mkv\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Default: show all commands overview
    await ctx.reply(
      `📚 *Media-Bot Commands*\n\n` +
      `Use \`/help <command>\` for detailed usage.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ *ALL-IN-ONE*\n` +
      `\`/process "video" "audio"\`\n` +
      `  └ Full pipeline: download→sync→mux→sample\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📥 *DOWNLOADS*\n` +
      `\`/download <url>\` - Magnet/HTTP download\n` +
      `\`/gdrive <link>\` - Google Drive download\n` +
      `\`/jobs [status]\` - List jobs\n` +
      `\`/status <id>\` - Job status\n` +
      `\`/cancel <id>\` - Cancel job\n` +
      `\`/retry <id>\` - Retry failed job\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔍 *ANALYSIS*\n` +
      `\`/analyze <path>\` - Analyze media file\n` +
      `\`/sync "video" "audio"\` - Sync analysis\n` +
      `\`/releases\` - List media assets\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔄 *AUDIO SYNC*\n` +
      `\`/delay <ms> "in" "out"\` - Add delay\n` +
      `\`/fps <src> <tgt> "in" "out"\` - FPS convert\n` +
      `\`/tempo <factor> "in" "out"\` - Speed adjust\n` +
      `\`/trim <start> <end> "in" "out"\` - Trim\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📦 *MUXING*\n` +
      `\`/mux "video" "audio" "out" [title]\`\n` +
      `\`/extract "input" <stream> "out"\`\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📁 *FILES*\n` +
      `\`/files\` - List output files\n` +
      `\`/dir\` - Show output directory\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚙️ *SYSTEM*\n` +
      `\`/health\` - System health\n` +
      `\`/stats\` - Statistics\n` +
      `\`/binaries\` - Binary paths\n` +
      `\`/config\` - Configuration\n\n` +
      `📁 Output: \`${config.storage.working}\``,
      { parse_mode: 'Markdown' }
    );
  });

  // /health - System health check
  bot.command('health', async (ctx) => {
    try {
      const dbCheck = await prisma.$queryRaw`SELECT 1 as ok`;
      const dbStatus = dbCheck ? '✅' : '❌';
      
      await ctx.reply(
        `🏥 *System Health*\n\n` +
        `Database: ${dbStatus} Connected\n` +
        `Bot: ✅ Running\n` +
        `Time: ${new Date().toISOString()}`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      logger.error({ err }, 'Health check failed');
      await ctx.reply('❌ Health check failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  });

  // /stats - Statistics
  bot.command('stats', async (ctx) => {
    try {
      const [totalJobs, activeJobs, completedJobs, failedJobs, totalAssets] = await Promise.all([
        prisma.job.count(),
        prisma.job.count({ where: { state: { in: ['PENDING', 'DOWNLOADING', 'ANALYZING', 'PROCESSING'] } } }),
        prisma.job.count({ where: { state: 'DONE' } }),
        prisma.job.count({ where: { state: 'FAILED' } }),
        prisma.mediaAsset.count(),
      ]);

      await ctx.reply(
        `📊 *Statistics*\n\n` +
        `*Jobs:*\n` +
        `├ Total: ${totalJobs}\n` +
        `├ Active: ${activeJobs}\n` +
        `├ Completed: ${completedJobs}\n` +
        `└ Failed: ${failedJobs}\n\n` +
        `*Media:*\n` +
        `└ Assets: ${totalAssets}`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      logger.error({ err }, 'Stats fetch failed');
      await ctx.reply('❌ Failed to fetch stats');
    }
  });

  // /jobs - List jobs
  bot.command('jobs', async (ctx) => {
    try {
      const args = ctx.message?.text?.split(' ').slice(1) ?? [];
      const statusFilter = args[0]?.toUpperCase();

      const where = statusFilter ? { state: statusFilter as any } : {};
      const jobs = await prisma.job.findMany({
        where,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });

      if (jobs.length === 0) {
        await ctx.reply('📭 No jobs found.');
        return;
      }

      const statusEmoji: Record<string, string> = {
        'PENDING': '⏳',
        'DOWNLOADING': '📥',
        'ANALYZING': '🔍',
        'SYNCING': '🔄',
        'PROCESSING': '⚙️',
        'VALIDATING': '✔️',
        'PACKAGED': '📦',
        'UPLOADED': '☁️',
        'DONE': '✅',
        'FAILED': '❌',
        'CANCELLED': '🚫',
      };

      const jobList = jobs.map(job => {
        const emoji = statusEmoji[job.state] ?? '❓';
        const shortId = job.id.slice(0, 8);
        return `${emoji} \`${shortId}\` ${job.type} - ${job.state}`;
      }).join('\n');

      await ctx.reply(
        `📋 *Recent Jobs*\n\n${jobList}\n\n` +
        `Use \`/status <id>\` for details`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      logger.error({ err }, 'Jobs list failed');
      await ctx.reply('❌ Failed to fetch jobs');
    }
  });

  // /status <id> - Job status
  bot.command('status', async (ctx) => {
    const args = ctx.message?.text?.split(' ').slice(1) ?? [];
    const jobId = args[0];

    if (!jobId) {
      await ctx.reply('Usage: /status <job_id>');
      return;
    }

    try {
      const job = await prisma.job.findFirst({
        where: {
          OR: [
            { id: jobId },
            { id: { startsWith: jobId } },
          ],
        },
      });

      if (!job) {
        await ctx.reply('❌ Job not found');
        return;
      }

      const statusEmoji: Record<string, string> = {
        'PENDING': '⏳',
        'DOWNLOADING': '📥',
        'ANALYZING': '🔍',
        'PROCESSING': '⚙️',
        'DONE': '✅',
        'FAILED': '❌',
        'CANCELLED': '🚫',
      };

      const emoji = statusEmoji[job.state] ?? '❓';
      const progress = job.progress ? `${job.progress}%` : 'N/A';

      await ctx.reply(
        `${emoji} *Job Status*\n\n` +
        `*ID:* \`${job.id}\`\n` +
        `*Type:* ${job.type}\n` +
        `*State:* ${job.state}\n` +
        `*Progress:* ${progress}\n` +
        `*Created:* ${job.createdAt.toISOString()}\n` +
        (job.error ? `*Error:* ${job.error}\n` : ''),
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      logger.error({ err }, 'Status fetch failed');
      await ctx.reply('❌ Failed to fetch job status');
    }
  });

  // /download <url> - Start download
  bot.command('download', async (ctx) => {
    const args = ctx.message?.text?.split(' ').slice(1) ?? [];
    const url = args.join(' ');

    if (!url) {
      await ctx.reply('Usage: /download <url>\n\nSupported: magnet links, HTTP URLs, NZB URLs');
      return;
    }

    try {
      const telegramId = ctx.from?.id?.toString() ?? '';
      
      // Find or create user by telegram ID
      let user = await prisma.user.findUnique({
        where: { telegramId },
      });
      
      if (!user) {
        user = await prisma.user.create({
          data: {
            username: ctx.from?.username ?? `tg_${telegramId}`,
            telegramId,
            role: 'ADMIN',
          },
        });
      }

      // All downloads go through DOWNLOAD job type
      const job = await prisma.job.create({
        data: {
          type: 'DOWNLOAD',
          state: 'PENDING',
          source: url,
          priority: 'NORMAL',
          options: { url, isMagnet: url.startsWith('magnet:'), isNzb: url.endsWith('.nzb') },
          userId: user.id,
        },
      });

      await ctx.reply(
        `📥 *Download Job Created*\n\n` +
        `*ID:* \`${job.id.slice(0, 8)}\`\n` +
        `*Type:* DOWNLOAD\n` +
        `*State:* PENDING\n\n` +
        `Track with: \`/status ${job.id.slice(0, 8)}\``,
        { parse_mode: 'Markdown' }
      );

      logger.info({ jobId: job.id, url }, 'Download job created via Telegram');
    } catch (err) {
      logger.error({ err }, 'Download creation failed');
      await ctx.reply('❌ Failed to create download job');
    }
  });

  // /cancel <id> - Cancel job
  bot.command('cancel', async (ctx) => {
    const args = ctx.message?.text?.split(' ').slice(1) ?? [];
    const jobId = args[0];

    if (!jobId) {
      await ctx.reply('Usage: /cancel <job_id>');
      return;
    }

    try {
      const job = await prisma.job.findFirst({
        where: {
          OR: [
            { id: jobId },
            { id: { startsWith: jobId } },
          ],
        },
      });

      if (!job) {
        await ctx.reply('❌ Job not found');
        return;
      }

      if (['DONE', 'FAILED', 'CANCELLED'].includes(job.state)) {
        await ctx.reply(`⚠️ Job is already ${job.state}`);
        return;
      }

      await prisma.job.update({
        where: { id: job.id },
        data: { state: 'CANCELLED' },
      });

      await ctx.reply(`🚫 Job \`${job.id.slice(0, 8)}\` cancelled`, { parse_mode: 'Markdown' });
      logger.info({ jobId: job.id }, 'Job cancelled via Telegram');
    } catch (err) {
      logger.error({ err }, 'Job cancellation failed');
      await ctx.reply('❌ Failed to cancel job');
    }
  });

  // /retry <id> - Retry failed job
  bot.command('retry', async (ctx) => {
    const args = ctx.message?.text?.split(' ').slice(1) ?? [];
    const jobId = args[0];

    if (!jobId) {
      await ctx.reply('Usage: /retry <job_id>');
      return;
    }

    try {
      const job = await prisma.job.findFirst({
        where: {
          OR: [
            { id: jobId },
            { id: { startsWith: jobId } },
          ],
        },
      });

      if (!job) {
        await ctx.reply('❌ Job not found');
        return;
      }

      if (job.state !== 'FAILED') {
        await ctx.reply(`⚠️ Only failed jobs can be retried. Current state: ${job.state}`);
        return;
      }

      await prisma.job.update({
        where: { id: job.id },
        data: { 
          state: 'PENDING',
          error: null,
          retryCount: { increment: 1 },
        },
      });

      await ctx.reply(
        `🔄 *Job Queued for Retry*\n\n` +
        `*ID:* \`${job.id.slice(0, 8)}\`\n` +
        `*Type:* ${job.type}\n` +
        `*State:* PENDING\n\n` +
        `Track with: \`/status ${job.id.slice(0, 8)}\``,
        { parse_mode: 'Markdown' }
      );
      logger.info({ jobId: job.id }, 'Job retry queued via Telegram');
    } catch (err) {
      logger.error({ err }, 'Job retry failed');
      await ctx.reply('❌ Failed to retry job');
    }
  });

  // /gdrive <link> - Download from Google Drive
  bot.command('gdrive', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const args = parseQuotedArgs(text.slice('/gdrive'.length).trim());
    const link = args[0];

    if (!link) {
      await ctx.reply(
        `📥 *Google Drive Download*\n\n` +
        `Usage: \`/gdrive <drive_link>\`\n\n` +
        `Example:\n` +
        `\`/gdrive https://drive.google.com/file/d/abc123/view\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (!config.gdrive.apiKey) {
      await ctx.reply('❌ Google Drive API key not configured');
      return;
    }

    const progressMsg = await ctx.reply('📥 Fetching file info...');
    const chatId = ctx.chat!.id;
    const msgId = progressMsg.message_id;

    setImmediate(async () => {
      try {
        const { GDriveApiClient } = await import('@media-bot/acquisition');
        
        const gdrive = new GDriveApiClient({
          apiKey: config.gdrive.apiKey,
          downloadPath: config.storage.working,
        });

        const fileId = GDriveApiClient.extractFileId(link);
        if (!fileId) {
          await ctx.api.editMessageText(chatId, msgId, '❌ Invalid Google Drive link');
          return;
        }

        const metadata = await gdrive.getFileMetadata(fileId);
        const sizeGB = parseInt(metadata.size) / 1024 / 1024 / 1024;
        const sizeStr = sizeGB >= 1 ? `${sizeGB.toFixed(2)} GB` : `${(parseInt(metadata.size) / 1024 / 1024).toFixed(0)} MB`;

        await ctx.api.editMessageText(
          chatId, msgId,
          `📥 *Downloading from Google Drive*\n\n` +
          `File: \`${metadata.name}\`\n` +
          `Size: ${sizeStr}\n\n` +
          `⏳ Starting download...`,
          { parse_mode: 'Markdown' }
        );

        let lastUpdate = Date.now();
        gdrive.on('progress', async (progress: any) => {
          const now = Date.now();
          if (now - lastUpdate > 2000) { // Update every 2 seconds
            lastUpdate = now;
            const speedMBps = (progress.speed / 1024 / 1024).toFixed(1);
            const etaMin = Math.floor(progress.eta / 60);
            const etaSec = Math.floor(progress.eta % 60);
            try {
              await ctx.api.editMessageText(
                chatId, msgId,
                `📥 *Downloading*\n\n` +
                `File: \`${metadata.name}\`\n` +
                `Progress: ${progress.percentage}%\n` +
                `Speed: ${speedMBps} MB/s\n` +
                `ETA: ${etaMin}m ${etaSec}s`,
                { parse_mode: 'Markdown' }
              );
            } catch { /* ignore edit errors */ }
          }
        });

        const result = await gdrive.downloadFile(link);

        if (result.success) {
          await ctx.api.editMessageText(
            chatId, msgId,
            `✅ *Download Complete*\n\n` +
            `File: \`${result.fileName}\`\n` +
            `Path: \`${result.filePath}\`\n` +
            `Time: ${result.duration.toFixed(1)}s`,
            { parse_mode: 'Markdown' }
          );
          logger.info({ fileId, fileName: result.fileName }, 'GDrive download completed');
        } else {
          await ctx.api.editMessageText(chatId, msgId, `❌ Download failed: ${result.error}`);
        }
      } catch (err) {
        logger.error({ err }, 'GDrive download failed');
        await ctx.api.editMessageText(chatId, msgId, '❌ Download failed: ' + (err instanceof Error ? err.message : 'Unknown'));
      }
    });
  });

  // /binaries - Show binary configuration
  bot.command('binaries', async (ctx) => {
    try {
      const { binaries, getBinaryFolders } = await import('@media-bot/core');
      const config = binaries();
      const folders = getBinaryFolders();

      const binaryList = Object.entries(config).map(([name, info]: [string, any]) => {
        return `• \`${name}\`: ${info.isAvailable ? '✅' : '❌'} \`${info.resolvedPath}\``;
      }).join('\n');

      await ctx.reply(
        `🔧 *Binary Configuration*\n\n` +
        `*Folder:* \`${folders.os}\`\n\n` +
        `*Binaries:*\n${binaryList}\n\n` +
        `Set paths via environment variables or place binaries in the folder above.`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      logger.error({ err }, 'Failed to get binaries config');
      await ctx.reply('❌ Failed to get binary configuration');
    }
  });

  // /config - Show current configuration
  bot.command('config', async (ctx) => {
    await ctx.reply(
      `⚙️ *Bot Configuration*\n\n` +
      `*Storage:*\n` +
      `├ Working: \`${config.storage.working}\`\n` +
      `├ Processed: \`${config.storage.processed}\`\n` +
      `└ Samples: \`${config.storage.samples}\`\n\n` +
      `*APIs:*\n` +
      `├ GDrive: ${config.gdrive.apiKey ? '✅ Configured' : '❌ Not set'}\n` +
      `└ API URL: \`${config.apiUrl}\`\n\n` +
      `*Environment:* ${config.nodeEnv}\n` +
      `*Log Level:* ${config.logLevel}`,
      { parse_mode: 'Markdown' }
    );
  });

  // /analyze <path> - Analyze media file
  bot.command('analyze', async (ctx) => {
    const args = ctx.message?.text?.split(' ').slice(1) ?? [];
    const filePath = args.join(' ');

    if (!filePath) {
      await ctx.reply('Usage: /analyze <file_path>\n\nExample: /analyze C:\\Videos\\movie.mkv');
      return;
    }

    if (!existsSync(filePath)) {
      await ctx.reply('❌ File not found: ' + filePath);
      return;
    }

    const progressMsg = await ctx.reply('🔍 Analyzing file...');

    try {
      const analyzer = new MediaAnalyzer();
      const result = await analyzer.analyze(filePath);
      const meta = result.metadata;

      // Format duration
      const duration = meta.duration;
      const hours = Math.floor(duration / 3600);
      const minutes = Math.floor((duration % 3600) / 60);
      const seconds = Math.floor(duration % 60);
      const durationStr = hours > 0 
        ? `${hours}h ${minutes}m ${seconds}s`
        : `${minutes}m ${seconds}s`;

      // Format file size
      const sizeGB = (meta.fileSize / 1024 / 1024 / 1024).toFixed(2);
      const sizeMB = (meta.fileSize / 1024 / 1024).toFixed(0);
      const sizeStr = parseFloat(sizeGB) >= 1 ? `${sizeGB} GB` : `${sizeMB} MB`;

      // Video info
      const video = meta.videoStreams[0];
      const videoInfo = video 
        ? `${video.codec} ${video.width}x${video.height} @ ${video.fps.toFixed(2)} fps`
        : 'No video';

      // Audio info
      const audioInfo = meta.audioStreams.map(a => 
        `${a.codec} ${a.channels}ch${a.language ? ` (${a.language})` : ''}`
      ).join(', ') || 'No audio';

      // Subtitle info
      const subInfo = meta.subtitleStreams.length > 0
        ? meta.subtitleStreams.map(s => s.language || s.codec).join(', ')
        : 'None';

      await ctx.api.editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        `🎬 *Media Analysis*\n\n` +
        `*File:* \`${meta.fileName}\`\n` +
        `*Size:* ${sizeStr}\n` +
        `*Duration:* ${durationStr}\n` +
        `*Format:* ${meta.format}\n\n` +
        `*Video:* ${videoInfo}\n` +
        `*Audio:* ${audioInfo}\n` +
        `*Subtitles:* ${subInfo}\n` +
        (result.warnings.length > 0 ? `\n⚠️ Warnings: ${result.warnings.join(', ')}` : ''),
        { parse_mode: 'Markdown' }
      );

      logger.info({ filePath }, 'File analyzed via Telegram');
    } catch (err) {
      logger.error({ err, filePath }, 'Analysis failed');
      await ctx.api.editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        '❌ Analysis failed: ' + (err instanceof Error ? err.message : 'Unknown error')
      );
    }
  });

  // /releases - List media assets
  bot.command('releases', async (ctx) => {
    try {
      const assets = await prisma.mediaAsset.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
      });

      if (assets.length === 0) {
        await ctx.reply('📭 No media assets found.');
        return;
      }

      const assetList = assets.map(a => {
        const shortId = a.id.slice(0, 8);
        const size = a.fileSize ? `${(Number(a.fileSize) / 1024 / 1024 / 1024).toFixed(2)} GB` : 'N/A';
        return `📀 \`${shortId}\` ${a.fileName} (${size})`;
      }).join('\n');

      await ctx.reply(
        `📀 *Recent Media Assets*\n\n${assetList}`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      logger.error({ err }, 'Assets list failed');
      await ctx.reply('❌ Failed to fetch media assets');
    }
  });

  // ===========================================
  // SYNC & PROCESSING COMMANDS
  // ===========================================

  // /sync <video> <audio> [title] - Sync analysis & report
  bot.command('sync', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const args = parseQuotedArgs(text.slice('/sync'.length).trim());
    
    if (args.length < 2) {
      await ctx.reply(
        `🔄 *Sync Analysis*\n\n` +
        `Usage: \`/sync <video> <audio> [title]\`\n\n` +
        `Example:\n` +
        `\`/sync "Movie.mkv" "Hindi.mp4" "HS DDP 5.1"\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const [videoPath, audioPath, title] = args;
    
    if (!existsSync(videoPath)) {
      await ctx.reply('❌ Video file not found: ' + videoPath);
      return;
    }
    if (!existsSync(audioPath)) {
      await ctx.reply('❌ Audio file not found: ' + audioPath);
      return;
    }

    const progressMsg = await ctx.reply('🔍 Analyzing files for sync...');

    try {
      const analyzer = new MediaAnalyzer();
      const [videoResult, audioResult] = await Promise.all([
        analyzer.analyze(videoPath),
        analyzer.analyze(audioPath),
      ]);

      const videoMeta = videoResult.metadata;
      const audioMeta = audioResult.metadata;
      
      const videoStream = videoMeta.videoStreams[0];
      const audioStream = audioMeta.audioStreams[0];
      
      if (!videoStream) {
        await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, '❌ No video stream found');
        return;
      }
      if (!audioStream) {
        await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, '❌ No audio stream found');
        return;
      }

      // Calculate sync parameters
      const videoFps = videoStream.fps;
      const audioDuration = audioMeta.duration;
      const videoDuration = videoMeta.duration;
      
      // Detect audio FPS from duration ratio
      const rawDiff = videoDuration - audioDuration;
      
      // Calculate what FPS the audio was encoded at
      let detectedAudioFps = 24; // Default assumption
      const fpsRatios = [
        { from: 24, to: 23.976, ratio: 24 / 23.976 },
        { from: 25, to: 23.976, ratio: 25 / 23.976 },
        { from: 23.976, to: 24, ratio: 23.976 / 24 },
        { from: 25, to: 24, ratio: 25 / 24 },
      ];

      // Project audio duration to video FPS
      let projectedDuration = audioDuration;
      let fpsConversionNeeded = false;
      let tempoFactor = 1.0;

      for (const fpsRatio of fpsRatios) {
        const projected = audioDuration * fpsRatio.ratio;
        const diff = Math.abs(projected - videoDuration);
        if (diff < Math.abs(projectedDuration - videoDuration)) {
          projectedDuration = projected;
          detectedAudioFps = fpsRatio.from;
          tempoFactor = fpsRatio.ratio;
          fpsConversionNeeded = true;
        }
      }

      // Calculate remaining delay after FPS conversion
      const projectedDiff = videoDuration - projectedDuration;
      const delayMs = Math.round(projectedDiff * 1000);

      // Format durations
      const formatDur = (s: number) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}`;
      };

      const formatSize = (bytes: number) => {
        const gb = bytes / 1024 / 1024 / 1024;
        return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
      };

      // Build report
      let report = `🎞 *MEDIA SYNC REPORT*\n`;
      report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      report += `🎬 \`${videoMeta.fileName}\` (${formatSize(videoMeta.fileSize)})\n`;
      report += `   └─ Stream: ${videoFps.toFixed(3)} \\[${formatDur(videoDuration)}\\]\n\n`;
      report += `🎧 \`${audioMeta.fileName}\` (${formatSize(audioMeta.fileSize)})\n`;
      report += `   └─ Stream: ${detectedAudioFps} \\[${formatDur(audioDuration)}\\]\n`;
      if (title) report += `   └─ Title: ${title}\n`;
      report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      report += `📊 *RAW DATA CHECK*\n\n`;
      report += `\`Stream        FPS     Duration\`\n`;
      report += `\`────────────  ──────  ──────────────\`\n`;
      report += `\`Video       : ${videoFps.toFixed(3).padEnd(6)} ${formatDur(videoDuration)}\`\n`;
      report += `\`Audio (Raw) : ${detectedAudioFps.toString().padEnd(6)} ${formatDur(audioDuration)}\`\n`;
      report += `\`Raw Diff    :         ${formatDur(Math.abs(rawDiff))}\`\n\n`;

      if (fpsConversionNeeded) {
        report += `📉 *PROJECTED SYNC CHECK*\n\n`;
        report += `\`Stream        FPS     Duration\`\n`;
        report += `\`────────────  ──────  ──────────────\`\n`;
        report += `\`Video Data  : ${videoFps.toFixed(3).padEnd(6)} ${formatDur(videoDuration)}\`\n`;
        report += `\`Audio Data  : ${videoFps.toFixed(3).padEnd(6)} ${formatDur(projectedDuration)}\`\n`;
        report += `\`Difference  :         ${formatDur(Math.abs(projectedDiff))}\`\n\n`;
      }

      // Actions needed
      const actions: string[] = [];
      if (fpsConversionNeeded) {
        actions.push(`1️⃣ Convert Audio: ${detectedAudioFps} ➔ ${videoFps.toFixed(3)}`);
        actions.push(`   \`/fps ${detectedAudioFps} ${videoFps.toFixed(3)} "${audioPath}" "output.mka"\``);
      }
      if (Math.abs(delayMs) > 10) {
        actions.push(`${actions.length + 1}️⃣ Add Delay: ${delayMs} ms`);
        actions.push(`   \`/delay ${delayMs} "input.mka" "output.mka"\``);
      }
      if (actions.length > 0) {
        report += `⚠️ *ACTION REQUIRED*\n`;
        report += actions.join('\n') + '\n';
      } else {
        report += `✅ *Audio is in sync!*\n`;
      }
      report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

      // Quick command summary
      if (fpsConversionNeeded || Math.abs(delayMs) > 10) {
        report += `\n💡 *Quick Command:*\n`;
        if (fpsConversionNeeded && Math.abs(delayMs) > 10) {
          report += `\`/process "${audioPath}" "${videoPath}" ${delayMs}\``;
        } else if (fpsConversionNeeded) {
          report += `\`/fps ${detectedAudioFps} ${videoFps.toFixed(3)} "${audioPath}" "synced.mka"\``;
        } else {
          report += `\`/delay ${delayMs} "${audioPath}" "synced.mka"\``;
        }
      }

      await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, report, { parse_mode: 'Markdown' });
      logger.info({ videoPath, audioPath }, 'Sync analysis completed');
    } catch (err) {
      logger.error({ err }, 'Sync analysis failed');
      await ctx.api.editMessageText(ctx.chat!.id, progressMsg.message_id, '❌ Sync analysis failed: ' + (err instanceof Error ? err.message : 'Unknown'));
    }
  });

  // /delay <ms> <input> <output> - Add delay to audio
  bot.command('delay', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const args = parseQuotedArgs(text.slice('/delay'.length).trim());
    
    if (args.length < 3) {
      await ctx.reply(
        `⏱ *Add Delay*\n\n` +
        `Usage: \`/delay <ms> <input> <output>\`\n\n` +
        `Examples:\n` +
        `\`/delay 42 "audio.mka" "delayed.mka"\`\n` +
        `\`/delay -100 "audio.mp4" "fixed.mka"\`\n\n` +
        `Positive = delay audio (audio starts later)\n` +
        `Negative = advance audio (audio starts earlier)`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const delayMs = parseInt(args[0], 10);
    const inputPath = args[1];
    const outputPath = getOutputPath(args[2]);

    if (isNaN(delayMs)) {
      await ctx.reply('❌ Invalid delay value. Must be a number in milliseconds.');
      return;
    }
    if (!existsSync(inputPath)) {
      await ctx.reply('❌ Input file not found: ' + inputPath);
      return;
    }

    const progressMsg = await ctx.reply(`⏱ Applying ${delayMs}ms delay...\n\n⏳ This may take several minutes for long files. Bot remains responsive.`);
    const chatId = ctx.chat!.id;
    const msgId = progressMsg.message_id;

    // Run FFmpeg in background (don't block bot)
    setImmediate(async () => {
      try {
        const { execFFmpeg } = await import('@media-bot/utils');
        const startTime = Date.now();
        
        // Build FFmpeg args
        // Positive delay: use adelay filter (requires re-encoding)
        // Negative delay: use -ss to skip audio start (can stream copy)
        // aformat remaps 5.1(side) to standard 5.1 for compatibility
        let ffmpegArgs: string[];
        if (delayMs >= 0) {
          const codecArgs = getAudioCodecArgs(outputPath, true);
          ffmpegArgs = ['-y', '-i', inputPath, '-af', `adelay=${delayMs}|${delayMs},aformat=channel_layouts=5.1`, ...codecArgs, outputPath];
        } else {
          ffmpegArgs = ['-y', '-ss', String(Math.abs(delayMs) / 1000), '-i', inputPath, '-c:a', 'copy', outputPath];
        }

        await execFFmpeg(ffmpegArgs);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        await ctx.api.editMessageText(
          chatId,
          msgId,
          `✅ *Delay Applied*\n\n` +
          `Input: \`${basename(inputPath)}\`\n` +
          `Output: \`${outputPath}\`\n` +
          `Delay: ${delayMs}ms\n` +
          `Time: ${elapsed}s`,
          { parse_mode: 'Markdown' }
        );
        logger.info({ inputPath, outputPath, delayMs, elapsed }, 'Delay applied');
      } catch (err) {
        logger.error({ err }, 'Delay failed');
        await ctx.api.editMessageText(chatId, msgId, '❌ Failed: ' + (err instanceof Error ? err.message : 'Unknown'));
      }
    });
  });

  // /fps <source> <target> <input> <output> - FPS conversion using tempo
  bot.command('fps', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const args = parseQuotedArgs(text.slice('/fps'.length).trim());
    
    if (args.length < 4) {
      await ctx.reply(
        `🎯 *FPS Conversion*\n\n` +
        `Usage: \`/fps <source> <target> <input> <output>\`\n\n` +
        `Examples:\n` +
        `\`/fps 24 23.976 "audio.mp4" "fixed.mka"\`\n` +
        `\`/fps 25 23.976 "audio.mka" "synced.mka"\`\n\n` +
        `Common conversions:\n` +
        `• 24 ➔ 23.976 (NTSC pulldown)\n` +
        `• 25 ➔ 23.976 (PAL to NTSC)\n` +
        `• 23.976 ➔ 24 (Reverse pulldown)`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const sourceFps = parseFloat(args[0]);
    const targetFps = parseFloat(args[1]);
    const inputPath = args[2];
    const outputPath = getOutputPath(args[3]);

    if (isNaN(sourceFps) || isNaN(targetFps)) {
      await ctx.reply('❌ Invalid FPS values. Must be numbers.');
      return;
    }
    if (!existsSync(inputPath)) {
      await ctx.reply('❌ Input file not found: ' + inputPath);
      return;
    }

    const tempoFactor = sourceFps / targetFps;
    const progressMsg = await ctx.reply(`🎯 Converting FPS ${sourceFps} ➔ ${targetFps}...\n\n⏳ This may take several minutes. Bot remains responsive.`);
    const chatId = ctx.chat!.id;
    const msgId = progressMsg.message_id;

    // Run in background
    setImmediate(async () => {
      try {
        const { execFFmpeg } = await import('@media-bot/utils');
        const startTime = Date.now();
        
        // atempo filter range is 0.5 to 2.0, chain if needed
        let remaining = tempoFactor;
        const filters: string[] = ['aformat=channel_layouts=5.1'];
        
        while (remaining > 2.0) {
          filters.push('atempo=2.0');
          remaining /= 2.0;
        }
        while (remaining < 0.5) {
          filters.push('atempo=0.5');
          remaining /= 0.5;
        }
        filters.push(`atempo=${remaining.toFixed(10)}`);
        const tempoFilter = filters.join(',');
        const codecArgs = getAudioCodecArgs(outputPath, true);

        await execFFmpeg(['-y', '-i', inputPath, '-af', tempoFilter, ...codecArgs, outputPath]);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        await ctx.api.editMessageText(
          chatId,
          msgId,
          `✅ *FPS Conversion Complete*\n\n` +
          `Input: \`${basename(inputPath)}\`\n` +
          `Output: \`${outputPath}\`\n` +
          `FPS: ${sourceFps} ➔ ${targetFps}\n` +
          `Tempo: ${tempoFactor.toFixed(6)}\n` +
          `Time: ${elapsed}s`,
          { parse_mode: 'Markdown' }
        );
        logger.info({ inputPath, outputPath, sourceFps, targetFps, tempoFactor, elapsed }, 'FPS conversion completed');
      } catch (err) {
        logger.error({ err }, 'FPS conversion failed');
        await ctx.api.editMessageText(chatId, msgId, '❌ Failed: ' + (err instanceof Error ? err.message : 'Unknown'));
      }
    });
  });

  // /tempo <factor> <input> <output> - Apply tempo adjustment
  bot.command('tempo', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const args = parseQuotedArgs(text.slice('/tempo'.length).trim());
    
    if (args.length < 3) {
      await ctx.reply(
        `🎵 *Tempo Adjustment*\n\n` +
        `Usage: \`/tempo <factor> <input> <output>\`\n\n` +
        `Examples:\n` +
        `\`/tempo 1.001 "audio.mka" "adjusted.mka"\`\n` +
        `\`/tempo 0.999 "audio.mp4" "slower.mka"\`\n\n` +
        `Factor > 1.0 = faster (shorter duration)\n` +
        `Factor < 1.0 = slower (longer duration)`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const tempoFactor = parseFloat(args[0]);
    const inputPath = args[1];
    const outputPath = getOutputPath(args[2]);

    if (isNaN(tempoFactor) || tempoFactor <= 0) {
      await ctx.reply('❌ Invalid tempo factor. Must be a positive number.');
      return;
    }
    if (!existsSync(inputPath)) {
      await ctx.reply('❌ Input file not found: ' + inputPath);
      return;
    }

    const progressMsg = await ctx.reply(`🎵 Applying tempo ${tempoFactor}...\n\n⏳ This may take several minutes. Bot remains responsive.`);
    const chatId = ctx.chat!.id;
    const msgId = progressMsg.message_id;

    // Run in background
    setImmediate(async () => {
      try {
        const { execFFmpeg } = await import('@media-bot/utils');
        const startTime = Date.now();
        
        // Chain atempo filters if needed
        let remaining = tempoFactor;
        const filters: string[] = ['aformat=channel_layouts=5.1'];
        
        while (remaining > 2.0) {
          filters.push('atempo=2.0');
          remaining /= 2.0;
        }
        while (remaining < 0.5) {
          filters.push('atempo=0.5');
          remaining /= 0.5;
        }
        filters.push(`atempo=${remaining.toFixed(10)}`);
        const codecArgs = getAudioCodecArgs(outputPath, true);

        await execFFmpeg(['-y', '-i', inputPath, '-af', filters.join(','), ...codecArgs, outputPath]);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        await ctx.api.editMessageText(
          chatId,
          msgId,
          `✅ *Tempo Applied*\n\n` +
          `Input: \`${basename(inputPath)}\`\n` +
          `Output: \`${outputPath}\`\n` +
          `Tempo: ${tempoFactor}\n` +
          `Time: ${elapsed}s`,
          { parse_mode: 'Markdown' }
        );
        logger.info({ inputPath, outputPath, tempoFactor, elapsed }, 'Tempo applied');
      } catch (err) {
        logger.error({ err }, 'Tempo failed');
        await ctx.api.editMessageText(chatId, msgId, '❌ Failed: ' + (err instanceof Error ? err.message : 'Unknown'));
      }
    });
  });

  // /trim <start> <end> <input> <output> - Trim audio
  bot.command('trim', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const args = parseQuotedArgs(text.slice('/trim'.length).trim());
    
    if (args.length < 4) {
      await ctx.reply(
        `✂️ *Trim Audio*\n\n` +
        `Usage: \`/trim <start> <end> <input> <output>\`\n\n` +
        `Time format: HH:MM:SS.mmm or seconds\n\n` +
        `Examples:\n` +
        `\`/trim 0 01:30:00 "audio.mka" "trimmed.mka"\`\n` +
        `\`/trim 10.5 3600 "audio.mp4" "cut.mka"\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const startTime = args[0];
    const endTime = args[1];
    const inputPath = args[2];
    const outputPath = getOutputPath(args[3]);

    if (!existsSync(inputPath)) {
      await ctx.reply('❌ Input file not found: ' + inputPath);
      return;
    }

    const progressMsg = await ctx.reply(`✂️ Trimming from ${startTime} to ${endTime}...\n\n⏳ Bot remains responsive.`);
    const chatId = ctx.chat!.id;
    const msgId = progressMsg.message_id;

    // Run in background
    setImmediate(async () => {
      try {
        const { execFFmpeg } = await import('@media-bot/utils');
        const startTs = Date.now();
        await execFFmpeg(['-y', '-ss', startTime, '-to', endTime, '-i', inputPath, '-c:a', 'copy', outputPath]);
        const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);

        await ctx.api.editMessageText(
          chatId,
          msgId,
          `✅ *Trim Complete*\n\n` +
          `Input: \`${basename(inputPath)}\`\n` +
          `Output: \`${outputPath}\`\n` +
          `Range: ${startTime} ➔ ${endTime}\n` +
          `Time: ${elapsed}s`,
          { parse_mode: 'Markdown' }
        );
        logger.info({ inputPath, outputPath, startTime, endTime, elapsed }, 'Trim completed');
      } catch (err) {
        logger.error({ err }, 'Trim failed');
        await ctx.api.editMessageText(chatId, msgId, '❌ Failed: ' + (err instanceof Error ? err.message : 'Unknown'));
      }
    });
  });

  // /mux <video> <audio> <output> [title] - Mux video and audio
  bot.command('mux', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const args = parseQuotedArgs(text.slice('/mux'.length).trim());
    
    if (args.length < 3) {
      await ctx.reply(
        `📦 *Mux Video + Audio*\n\n` +
        `Usage: \`/mux <video> <audio> <output> [title]\`\n\n` +
        `Examples:\n` +
        `\`/mux "Movie.mkv" "Hindi.mka" "Movie.Hindi.mkv"\`\n` +
        `\`/mux "Video.mkv" "Audio.mka" "Output.mkv" "Hindi DD+ 5.1"\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const videoPath = args[0];
    const audioPath = args[1];
    const outputPath = getOutputPath(args[2]);
    const title = args[3] || '';

    if (!existsSync(videoPath)) {
      await ctx.reply('❌ Video file not found: ' + videoPath);
      return;
    }
    if (!existsSync(audioPath)) {
      await ctx.reply('❌ Audio file not found: ' + audioPath);
      return;
    }

    const progressMsg = await ctx.reply(`📦 Muxing files...\n\n⏳ This may take a while. Bot remains responsive.`);
    const chatId = ctx.chat!.id;
    const msgId = progressMsg.message_id;

    // Run in background
    setImmediate(async () => {
      try {
        const { execFFmpeg, execMkvmerge } = await import('@media-bot/utils');
        const startTime = Date.now();
        
        // Use mkvmerge for better MKV handling
        if (outputPath.endsWith('.mkv')) {
          const mkvArgs = ['-o', outputPath, videoPath];
          if (title) mkvArgs.push('--track-name', `0:${title}`);
          mkvArgs.push('--language', '0:hin', audioPath);
          await execMkvmerge(mkvArgs);
        } else {
          // Use ffmpeg for other formats
          const ffmpegArgs = ['-y', '-i', videoPath, '-i', audioPath, '-map', '0', '-map', '1:a', '-c', 'copy'];
          if (title) ffmpegArgs.push('-metadata:s:a:0', `title=${title}`);
          ffmpegArgs.push(outputPath);
          await execFFmpeg(ffmpegArgs);
        }
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        await ctx.api.editMessageText(
          chatId,
          msgId,
          `✅ *Mux Complete*\n\n` +
          `Video: \`${basename(videoPath)}\`\n` +
          `Audio: \`${basename(audioPath)}\`\n` +
          `Output: \`${outputPath}\`\n` +
          `Time: ${elapsed}s\n` +
          (title ? `Title: ${title}` : ''),
          { parse_mode: 'Markdown' }
        );
        logger.info({ videoPath, audioPath, outputPath, title, elapsed }, 'Mux completed');
      } catch (err) {
        logger.error({ err }, 'Mux failed');
        await ctx.api.editMessageText(chatId, msgId, '❌ Failed: ' + (err instanceof Error ? err.message : 'Unknown'));
      }
    });
  });

  // /extract <input> <stream> <output> - Extract stream
  bot.command('extract', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const args = parseQuotedArgs(text.slice('/extract'.length).trim());
    
    if (args.length < 3) {
      await ctx.reply(
        `📤 *Extract Stream*\n\n` +
        `Usage: \`/extract <input> <stream> <output>\`\n\n` +
        `Stream specifiers:\n` +
        `• \`a:0\` - First audio\n` +
        `• \`a:1\` - Second audio\n` +
        `• \`s:0\` - First subtitle\n` +
        `• \`v:0\` - Video stream\n\n` +
        `Example:\n` +
        `\`/extract "Movie.mkv" "a:1" "Hindi.mka"\`\n\n` +
        `📁 Output: \`${config.storage.working}\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const inputPath = args[0];
    const streamSpec = args[1];
    const outputPath = getOutputPath(args[2]);

    if (!existsSync(inputPath)) {
      await ctx.reply('❌ Input file not found: ' + inputPath);
      return;
    }

    const progressMsg = await ctx.reply(`📤 Extracting stream ${streamSpec}...\n\n⏳ This may take a while for large files. Bot remains responsive.`);
    const chatId = ctx.chat!.id;
    const msgId = progressMsg.message_id;

    // Run in background
    setImmediate(async () => {
      try {
        const { execFFmpeg } = await import('@media-bot/utils');
        const startTime = Date.now();
        await execFFmpeg(['-y', '-i', inputPath, '-map', `0:${streamSpec}`, '-c', 'copy', outputPath]);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        await ctx.api.editMessageText(
          chatId,
          msgId,
          `✅ *Extraction Complete*\n\n` +
          `Input: \`${basename(inputPath)}\`\n` +
          `Output: \`${outputPath}\`\n` +
          `Stream: ${streamSpec}\n` +
          `Time: ${elapsed}s\n\n` +
          `📁 Use /files to list outputs`,
          { parse_mode: 'Markdown' }
        );
        logger.info({ inputPath, streamSpec, outputPath, elapsed }, 'Extraction completed');
      } catch (err) {
        logger.error({ err }, 'Extraction failed');
        await ctx.api.editMessageText(chatId, msgId, '❌ Failed: ' + (err instanceof Error ? err.message : 'Unknown'));
      }
    });
  });

  // /process <audio> <video> <delay> - Full sync pipeline (FPS + delay)
  bot.command('process', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const args = parseQuotedArgs(text.slice('/process'.length).trim());
    
    if (args.length < 3) {
      await ctx.reply(
        `⚙️ *Full Sync Process*\n\n` +
        `Usage: \`/process <audio> <video> <delay_ms>\`\n\n` +
        `This command:\n` +
        `1. Analyzes both files\n` +
        `2. Converts FPS if needed\n` +
        `3. Applies delay\n` +
        `4. Outputs synced audio\n\n` +
        `Example:\n` +
        `\`/process "Hindi.mp4" "Movie.mkv" 42\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const audioPath = args[0];
    const videoPath = args[1];
    const delayMs = parseInt(args[2], 10);

    if (!existsSync(audioPath)) {
      await ctx.reply('❌ Audio file not found: ' + audioPath);
      return;
    }
    if (!existsSync(videoPath)) {
      await ctx.reply('❌ Video file not found: ' + videoPath);
      return;
    }
    if (isNaN(delayMs)) {
      await ctx.reply('❌ Invalid delay value');
      return;
    }

    const progressMsg = await ctx.reply(`⚙️ Starting full sync process...\n\n⏳ This may take several minutes. Bot remains responsive.`);
    const chatId = ctx.chat!.id;
    const msgId = progressMsg.message_id;

    // Run in background
    setImmediate(async () => {
      try {
        const { execFFmpeg } = await import('@media-bot/utils');
        const path = await import('path');
        const startTime = Date.now();
        
        // Analyze both files
        const analyzer = new MediaAnalyzer();
        const [videoResult, audioResult] = await Promise.all([
          analyzer.analyze(videoPath),
          analyzer.analyze(audioPath),
        ]);

        const videoFps = videoResult.metadata.videoStreams[0]?.fps ?? 23.976;
        const audioDuration = audioResult.metadata.duration;
        const videoDuration = videoResult.metadata.duration;

        // Detect source FPS
        let sourceFps = 24;
        const ratios = [24, 25, 23.976];
        for (const fps of ratios) {
          const projected = audioDuration * (fps / videoFps);
          if (Math.abs(projected - videoDuration) < 1) {
            sourceFps = fps;
            break;
          }
        }

        const tempoFactor = sourceFps / videoFps;
        
        await ctx.api.editMessageText(chatId, msgId,
          `⚙️ Processing...\n\n` +
          `FPS: ${sourceFps} ➔ ${videoFps.toFixed(3)}\n` +
          `Tempo: ${tempoFactor.toFixed(6)}\n` +
          `Delay: ${delayMs}ms`
        );

        // Generate output filename
        const outputName = path.basename(audioPath, path.extname(audioPath)) + '_synced.mka';
        const outputPath = path.join(path.dirname(audioPath), outputName);

        // Build filter chain
        // Start with aformat to remap 5.1(side) to standard 5.1 for libopus compatibility
        const filters: string[] = ['aformat=channel_layouts=5.1'];
        
        // FPS conversion via tempo
        if (Math.abs(tempoFactor - 1.0) > 0.0001) {
          let remaining = tempoFactor;
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
        
        // Delay
        if (delayMs > 0) {
          filters.push(`adelay=${delayMs}|${delayMs}`);
        }

        // Build ffmpeg args
        // Use codec based on output extension
        const ffmpegArgs = ['-y', '-i', audioPath];
        if (filters.length > 0) {
          ffmpegArgs.push('-af', filters.join(','));
        }
        const codecArgs = getAudioCodecArgs(outputPath, filters.length > 0);
        ffmpegArgs.push(...codecArgs, outputPath);
        
        await execFFmpeg(ffmpegArgs);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        await ctx.api.editMessageText(
          chatId,
          msgId,
          `✅ *Sync Complete!*\n\n` +
          `Input: \`${basename(audioPath)}\`\n` +
          `Output: \`${outputPath}\`\n\n` +
          `Applied:\n` +
          `• FPS: ${sourceFps} ➔ ${videoFps.toFixed(3)}\n` +
          `• Tempo: ${tempoFactor.toFixed(6)}\n` +
          `• Delay: ${delayMs}ms\n` +
          `• Time: ${elapsed}s`,
          { parse_mode: 'Markdown' }
        );
        logger.info({ audioPath, videoPath, outputPath, tempoFactor, delayMs, elapsed }, 'Full sync process completed');
      } catch (err) {
        logger.error({ err }, 'Process failed');
        await ctx.api.editMessageText(chatId, msgId, '❌ Failed: ' + (err instanceof Error ? err.message : 'Unknown'));
      }
    });
  });

  // ===========================================
  // FILE MANAGEMENT COMMANDS
  // ===========================================

  // /files - List recent output files
  bot.command('files', async (ctx) => {
    try {
      const storageDir = config.storage.working;
      
      if (!existsSync(storageDir)) {
        await ctx.reply(`📂 Output directory not found.\n\nPath: \`${storageDir}\`\n\nNo files have been created yet.`, { parse_mode: 'Markdown' });
        return;
      }

      const files = readdirSync(storageDir)
        .map(name => {
          const fullPath = join(storageDir, name);
          try {
            const stats = statSync(fullPath);
            return { name, size: stats.size, mtime: stats.mtime, isDir: stats.isDirectory() };
          } catch {
            return null;
          }
        })
        .filter((f): f is NonNullable<typeof f> => f !== null && !f.isDir)
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
        .slice(0, 15);

      if (files.length === 0) {
        await ctx.reply(`📂 *Output Directory*\n\n\`${storageDir}\`\n\n📭 No files found.`, { parse_mode: 'Markdown' });
        return;
      }

      const formatSize = (bytes: number) => {
        if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
        if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
        return `${(bytes / 1024).toFixed(0)} KB`;
      };

      const fileList = files.map((f, i) => {
        const age = Date.now() - f.mtime.getTime();
        const ageStr = age < 60000 ? 'just now' 
          : age < 3600000 ? `${Math.floor(age / 60000)}m ago`
          : age < 86400000 ? `${Math.floor(age / 3600000)}h ago`
          : `${Math.floor(age / 86400000)}d ago`;
        return `${i + 1}. \`${f.name}\`\n   ${formatSize(f.size)} • ${ageStr}`;
      }).join('\n\n');

      await ctx.reply(
        `📂 *Recent Output Files*\n\n` +
        `📁 \`${storageDir}\`\n\n` +
        `${fileList}`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      logger.error({ err }, 'Files list failed');
      await ctx.reply('❌ Failed to list files');
    }
  });

  // /dir - Show output directory
  bot.command('dir', async (ctx) => {
    const storageDir = config.storage.working;
    const exists = existsSync(storageDir);
    
    await ctx.reply(
      `📁 *Output Directory*\n\n` +
      `Path: \`${storageDir}\`\n` +
      `Status: ${exists ? '✅ Exists' : '⚠️ Will be created on first use'}\n\n` +
      `All relative output paths will be saved here.\n` +
      `Use absolute paths to save elsewhere.`,
      { parse_mode: 'Markdown' }
    );
  });

  // ===========================================
  // PROCESS COMMAND (ALL-IN-ONE)
  // ===========================================
  registerProcessCommand(bot, logger);

  // Handle unknown commands
  bot.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) {
      await ctx.reply('❓ Unknown command. Use /help to see available commands.');
    }
  });

  logger.info('Bot commands registered');
}

// Helper to parse quoted arguments
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
