/**
 * Muxer
 * 
 * Combines video and audio streams, preserving all metadata.
 * 
 * CRITICAL: Never re-encode video unless explicitly requested.
 */

import { FFmpeg } from './ffmpeg.js';
import { ensureDir } from '@media-bot/utils';
import { dirname, basename } from 'node:path';
import type { CorrectionPlan } from '@media-bot/sync';

export interface MuxOptions {
  videoFile: string;
  audioFile?: string;
  outputFile: string;
  
  // Correction from sync engine
  correctionPlan?: CorrectionPlan;
  
  // Stream selection
  videoStreamIndex?: number;
  audioStreamIndex?: number;
  
  // Metadata preservation
  preserveChapters?: boolean;
  preserveMetadata?: boolean;
  
  // Subtitle handling
  subtitleFiles?: string[];
  embedSubtitles?: boolean;
}

export interface MuxResult {
  success: boolean;
  outputFile: string;
  ffmpegCommand: string;
  ffmpegOutput: string;
  duration: number;
  error?: string;
}

export class Muxer {
  private ffmpeg: FFmpeg;

  constructor(ffmpegPath: string = 'ffmpeg') {
    this.ffmpeg = new FFmpeg(ffmpegPath);
  }

  /**
   * Mux video and audio together
   */
  async mux(options: MuxOptions): Promise<MuxResult> {
    const startTime = Date.now();
    
    // Ensure output directory exists
    await ensureDir(dirname(options.outputFile));

    // Build FFmpeg arguments
    const args = this.buildMuxCommand(options);
    const commandStr = `ffmpeg ${args.join(' ')}`;

    try {
      const result = await this.ffmpeg.execute(args);

      return {
        success: result.exitCode === 0,
        outputFile: options.outputFile,
        ffmpegCommand: commandStr,
        ffmpegOutput: result.stderr,
        duration: Date.now() - startTime,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    } catch (error) {
      return {
        success: false,
        outputFile: options.outputFile,
        ffmpegCommand: commandStr,
        ffmpegOutput: '',
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private buildMuxCommand(options: MuxOptions): string[] {
    const args: string[] = [];

    // Input files
    args.push('-i', options.videoFile);
    if (options.audioFile) {
      args.push('-i', options.audioFile);
    }

    // Add subtitle inputs
    if (options.subtitleFiles) {
      for (const subFile of options.subtitleFiles) {
        args.push('-i', subFile);
      }
    }

    // Map video from first input (always copy, never re-encode)
    const videoIndex = options.videoStreamIndex ?? 0;
    args.push('-map', `0:v:${videoIndex}`);
    args.push('-c:v', 'copy');

    // Map audio
    if (options.audioFile) {
      const audioIndex = options.audioStreamIndex ?? 0;
      args.push('-map', `1:a:${audioIndex}`);
      
      // Apply audio corrections if needed
      if (options.correctionPlan && options.correctionPlan.steps.length > 0) {
        const filterArgs = options.correctionPlan.steps
          .filter(s => s.type === 'filter')
          .flatMap(s => s.ffmpegArgs);
        
        if (filterArgs.length > 0) {
          args.push(...filterArgs);
          // When filtering, we need to encode
          args.push('-c:a', 'aac', '-b:a', '256k');
        } else {
          args.push('-c:a', 'copy');
        }
      } else {
        args.push('-c:a', 'copy');
      }
    } else {
      // Use audio from video file
      args.push('-map', '0:a?');
      args.push('-c:a', 'copy');
    }

    // Map subtitles
    if (options.subtitleFiles && options.embedSubtitles) {
      for (let i = 0; i < options.subtitleFiles.length; i++) {
        const inputIndex = options.audioFile ? i + 2 : i + 1;
        args.push('-map', `${inputIndex}:s?`);
      }
      args.push('-c:s', 'copy');
    }

    // Preserve chapters from video
    if (options.preserveChapters !== false) {
      args.push('-map_chapters', '0');
    }

    // Preserve metadata
    if (options.preserveMetadata !== false) {
      args.push('-map_metadata', '0');
    }

    // Output format options
    args.push('-movflags', '+faststart'); // Enable streaming

    // Output file
    args.push(options.outputFile);

    return args;
  }
}
