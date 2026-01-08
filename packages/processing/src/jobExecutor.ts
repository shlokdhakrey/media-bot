/**
 * Job Executor
 * 
 * Executes processing jobs with progress tracking, cancellation,
 * and error handling.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { stat, access, constants } from 'node:fs/promises';
import { dirname } from 'node:path';
import { logger, ensureDir } from '@media-bot/utils';
import { FFmpegCommandBuilder } from './commandBuilder.js';
import { EncodingPreset, getPreset } from './presets.js';

export interface JobProgress {
  jobId: string;
  phase: 'starting' | 'running' | 'finalizing' | 'complete' | 'failed' | 'cancelled';
  progress: number;  // 0-100
  frame: number;
  fps: number;
  speed: number;
  bitrate: string;
  size: number;
  timeElapsed: number;
  timeRemaining: number;
  eta: Date | null;
}

export interface JobConfig {
  id: string;
  inputFile: string;
  outputFile: string;
  
  // Either use a preset or provide custom command
  preset?: string | EncodingPreset;
  customCommand?: FFmpegCommandBuilder;
  
  // Duration for progress calculation
  durationMs?: number;
  
  // Processing options
  overwrite?: boolean;
  tempDir?: string;
  ffmpegPath?: string;
  
  // Limits
  timeoutMs?: number;
  maxOutputSize?: number;
}

export interface JobResult {
  jobId: string;
  success: boolean;
  outputFile: string;
  
  // Timing
  startTime: Date;
  endTime: Date;
  duration: number;
  
  // Output stats
  outputSize?: number;
  
  // Command info
  command: string;
  exitCode: number;
  stderr: string;
  
  // Error info
  error?: string;
  cancelled?: boolean;
}

export class JobExecutor extends EventEmitter {
  private activeJobs: Map<string, {
    process: ChildProcess;
    config: JobConfig;
    startTime: Date;
    progress: JobProgress;
  }> = new Map();

  private ffmpegPath: string;

  constructor(ffmpegPath: string = 'ffmpeg') {
    super();
    this.ffmpegPath = ffmpegPath;
  }

  /**
   * Execute a processing job
   */
  async execute(config: JobConfig): Promise<JobResult> {
    const startTime = new Date();
    const ffmpegPath = config.ffmpegPath ?? this.ffmpegPath;

    logger.info({ jobId: config.id, input: config.inputFile }, 'Starting job execution');

    // Validate input file exists
    try {
      await access(config.inputFile, constants.R_OK);
    } catch {
      throw new Error(`Input file not accessible: ${config.inputFile}`);
    }

    // Ensure output directory exists
    await ensureDir(dirname(config.outputFile));

    // Build command
    let command: string[];
    try {
      command = await this.buildCommand(config);
    } catch (error) {
      return this.createFailedResult(config.id, startTime, (error as Error).message);
    }

    const commandStr = `${ffmpegPath} ${command.join(' ')}`;
    logger.debug({ jobId: config.id, command: commandStr }, 'FFmpeg command');

    // Initialize progress
    const progress: JobProgress = {
      jobId: config.id,
      phase: 'starting',
      progress: 0,
      frame: 0,
      fps: 0,
      speed: 0,
      bitrate: '0kbps',
      size: 0,
      timeElapsed: 0,
      timeRemaining: Infinity,
      eta: null,
    };

    // Spawn FFmpeg process
    return new Promise((resolve) => {
      const process = spawn(ffmpegPath, command, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Track active job
      this.activeJobs.set(config.id, {
        process,
        config,
        startTime,
        progress,
      });

      let stderr = '';
      const progressParser = new ProgressParser(config.durationMs ?? 0);

      // Handle stdout (progress data)
      process.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        
        for (const line of lines) {
          const parsed = progressParser.parseLine(line);
          if (parsed) {
            Object.assign(progress, parsed);
            progress.phase = 'running';
            progress.timeElapsed = Date.now() - startTime.getTime();
            
            if (progress.speed > 0 && progress.progress < 100) {
              const remaining = (100 - progress.progress) / progress.progress * progress.timeElapsed;
              progress.timeRemaining = remaining;
              progress.eta = new Date(Date.now() + remaining);
            }

            this.emit('progress', progress);
          }
        }
      });

      // Handle stderr (FFmpeg output/errors)
      process.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle timeout
      let timeoutId: NodeJS.Timeout | null = null;
      if (config.timeoutMs) {
        timeoutId = setTimeout(() => {
          logger.warn({ jobId: config.id }, 'Job timeout reached');
          process.kill('SIGTERM');
          setTimeout(() => process.kill('SIGKILL'), 10000);
        }, config.timeoutMs);
      }

      // Handle completion
      process.on('close', async (exitCode) => {
        if (timeoutId) clearTimeout(timeoutId);
        this.activeJobs.delete(config.id);

        const endTime = new Date();
        const duration = endTime.getTime() - startTime.getTime();

        // Check if cancelled
        if (progress.phase === 'cancelled') {
          resolve({
            jobId: config.id,
            success: false,
            outputFile: config.outputFile,
            startTime,
            endTime,
            duration,
            command: commandStr,
            exitCode: exitCode ?? -1,
            stderr,
            cancelled: true,
          });
          return;
        }

        // Get output file size
        let outputSize: number | undefined;
        try {
          const stats = await stat(config.outputFile);
          outputSize = stats.size;
        } catch {
          // Output file may not exist if failed
        }

        const success = exitCode === 0 && outputSize !== undefined && outputSize > 0;

        progress.phase = success ? 'complete' : 'failed';
        progress.progress = success ? 100 : progress.progress;
        this.emit('progress', progress);

        logger.info({
          jobId: config.id,
          success,
          exitCode,
          duration,
          outputSize,
        }, 'Job execution complete');

        resolve({
          jobId: config.id,
          success,
          outputFile: config.outputFile,
          startTime,
          endTime,
          duration,
          outputSize,
          command: commandStr,
          exitCode: exitCode ?? -1,
          stderr,
          error: success ? undefined : this.extractError(stderr),
        });
      });

      // Handle error
      process.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        this.activeJobs.delete(config.id);

        progress.phase = 'failed';
        this.emit('progress', progress);

        resolve(this.createFailedResult(config.id, startTime, error.message));
      });
    });
  }

  /**
   * Cancel a running job
   */
  cancel(jobId: string): boolean {
    const job = this.activeJobs.get(jobId);
    if (!job) return false;

    logger.info({ jobId }, 'Cancelling job');
    job.progress.phase = 'cancelled';
    
    job.process.kill('SIGTERM');
    setTimeout(() => {
      if (this.activeJobs.has(jobId)) {
        job.process.kill('SIGKILL');
      }
    }, 5000);

    return true;
  }

  /**
   * Get progress for a job
   */
  getProgress(jobId: string): JobProgress | null {
    return this.activeJobs.get(jobId)?.progress ?? null;
  }

  /**
   * Get all active jobs
   */
  getActiveJobs(): string[] {
    return Array.from(this.activeJobs.keys());
  }

  /**
   * Check if a job is running
   */
  isRunning(jobId: string): boolean {
    return this.activeJobs.has(jobId);
  }

  /**
   * Build FFmpeg command from config
   */
  private async buildCommand(config: JobConfig): Promise<string[]> {
    // Use custom command if provided
    if (config.customCommand) {
      return config.customCommand.build();
    }

    // Build from preset
    let preset: EncodingPreset | undefined;
    
    if (typeof config.preset === 'string') {
      preset = getPreset(config.preset);
      if (!preset) {
        throw new Error(`Unknown preset: ${config.preset}`);
      }
    } else if (config.preset) {
      preset = config.preset;
    }

    if (!preset) {
      throw new Error('No preset or custom command provided');
    }

    const builder = new FFmpegCommandBuilder()
      .addInput(config.inputFile)
      .mapVideo(0, 0)
      .mapAudio(0, 0, true)
      .setVideoCodec(preset.video)
      .setAudioCodec(preset.audio)
      .copyChapters(0)
      .copyMetadata(0)
      .setOutput(config.outputFile);

    // Add progress output
    builder.addGlobalArg('-progress', 'pipe:1');

    // Add overwrite flag
    if (config.overwrite !== false) {
      builder.addGlobalArg('-y');
    } else {
      builder.addGlobalArg('-n');
    }

    return builder.build();
  }

  /**
   * Extract error message from FFmpeg stderr
   */
  private extractError(stderr: string): string {
    // Look for common error patterns
    const patterns = [
      /Error[:\s](.+?)(?:\n|$)/i,
      /Invalid[:\s](.+?)(?:\n|$)/i,
      /No such file or directory/,
      /Permission denied/,
      /Cannot open/,
      /Conversion failed/,
    ];

    for (const pattern of patterns) {
      const match = stderr.match(pattern);
      if (match) {
        return match[1] ?? match[0];
      }
    }

    // Return last few lines if no specific error found
    const lines = stderr.trim().split('\n');
    return lines.slice(-3).join('\n');
  }

  /**
   * Create a failed result object
   */
  private createFailedResult(
    jobId: string,
    startTime: Date,
    error: string
  ): JobResult {
    const endTime = new Date();
    return {
      jobId,
      success: false,
      outputFile: '',
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
      command: '',
      exitCode: -1,
      stderr: '',
      error,
    };
  }
}

/**
 * FFmpeg progress output parser
 */
class ProgressParser {
  private durationMs: number;
  private currentProgress: Partial<JobProgress> = {};

  constructor(durationMs: number) {
    this.durationMs = durationMs;
  }

  parseLine(line: string): Partial<JobProgress> | null {
    const match = line.match(/^(\w+)=(.+)$/);
    if (!match) return null;

    const [, key, value] = match;

    switch (key) {
      case 'frame':
        this.currentProgress.frame = parseInt(value ?? '0', 10);
        break;
      case 'fps':
        this.currentProgress.fps = parseFloat(value ?? '0');
        break;
      case 'bitrate':
        this.currentProgress.bitrate = value ?? '0kbps';
        break;
      case 'total_size':
        this.currentProgress.size = parseInt(value ?? '0', 10);
        break;
      case 'out_time_ms': {
        const outTimeMs = parseInt(value ?? '0', 10) / 1000;
        if (this.durationMs > 0) {
          this.currentProgress.progress = Math.min(100, (outTimeMs / this.durationMs) * 100);
        }
        break;
      }
      case 'speed': {
        const speedStr = (value ?? '0').replace('x', '');
        this.currentProgress.speed = parseFloat(speedStr);
        break;
      }
      case 'progress':
        // End of a progress block, return accumulated values
        if (value === 'continue' || value === 'end') {
          const result = { ...this.currentProgress };
          return result;
        }
        break;
    }

    return null;
  }
}

// Singleton instance
export const jobExecutor = new JobExecutor();