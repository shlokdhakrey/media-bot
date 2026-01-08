/**
 * FFmpeg Wrapper
 * 
 * Safe FFmpeg command execution with progress tracking and logging.
 */

import { executeCommand } from '@media-bot/utils';
import { EventEmitter } from 'node:events';

export interface FFmpegProgress {
  frame: number;
  fps: number;
  bitrate: string;
  totalSize: number;
  outTime: string;
  outTimeMs: number;
  speed: number;
  progress: number; // 0-100
}

export class FFmpeg extends EventEmitter {
  private ffmpegPath: string;
  private totalDurationMs: number = 0;

  constructor(ffmpegPath: string = 'ffmpeg') {
    super();
    this.ffmpegPath = ffmpegPath;
  }

  /**
   * Set the expected duration for progress calculation
   */
  setDuration(durationMs: number): void {
    this.totalDurationMs = durationMs;
  }

  /**
   * Execute an FFmpeg command
   */
  async execute(
    args: string[],
    options: { timeout?: number; cwd?: string } = {}
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    // Add progress output format
    const fullArgs = [
      '-progress', 'pipe:1',
      '-y', // Overwrite output
      ...args,
    ];

    const result = await executeCommand(this.ffmpegPath, fullArgs, {
      timeout: options.timeout ?? 3600000, // 1 hour default
      cwd: options.cwd,
    });

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  /**
   * Build a command to copy streams (no re-encode)
   */
  buildCopyCommand(
    inputFile: string,
    outputFile: string,
    options: {
      audioFilters?: string;
      mapVideo?: number;
      mapAudio?: number;
      copyChapters?: boolean;
    } = {}
  ): string[] {
    const args: string[] = ['-i', inputFile];

    // Map streams
    if (options.mapVideo !== undefined) {
      args.push('-map', `0:v:${options.mapVideo}`);
    } else {
      args.push('-map', '0:v?');
    }

    if (options.mapAudio !== undefined) {
      args.push('-map', `0:a:${options.mapAudio}`);
    } else {
      args.push('-map', '0:a?');
    }

    // Copy video without re-encoding
    args.push('-c:v', 'copy');

    // Handle audio
    if (options.audioFilters) {
      args.push('-af', options.audioFilters);
      // When filtering, we need to encode
      args.push('-c:a', 'aac', '-b:a', '256k');
    } else {
      args.push('-c:a', 'copy');
    }

    // Copy chapters
    if (options.copyChapters !== false) {
      args.push('-map_chapters', '0');
    }

    // Copy metadata
    args.push('-map_metadata', '0');

    // Output
    args.push(outputFile);

    return args;
  }

  /**
   * Check if FFmpeg is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await executeCommand(this.ffmpegPath, ['-version'], {
        timeout: 5000,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Parse progress output
   */
  parseProgress(line: string): Partial<FFmpegProgress> | null {
    const match = line.match(/^(\w+)=(.+)$/);
    if (!match) return null;

    const [, key, value] = match;
    const progress: Partial<FFmpegProgress> = {};

    switch (key) {
      case 'frame':
        progress.frame = parseInt(value ?? '0', 10);
        break;
      case 'fps':
        progress.fps = parseFloat(value ?? '0');
        break;
      case 'bitrate':
        progress.bitrate = value ?? '';
        break;
      case 'total_size':
        progress.totalSize = parseInt(value ?? '0', 10);
        break;
      case 'out_time':
        progress.outTime = value ?? '';
        break;
      case 'out_time_ms':
        const outTimeMs = parseInt(value ?? '0', 10) / 1000;
        progress.outTimeMs = outTimeMs;
        if (this.totalDurationMs > 0) {
          progress.progress = Math.min(100, (outTimeMs / this.totalDurationMs) * 100);
        }
        break;
      case 'speed':
        progress.speed = parseFloat((value ?? '0').replace('x', ''));
        break;
    }

    return progress;
  }
}
