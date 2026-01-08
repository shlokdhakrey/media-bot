/**
 * Sample Generator
 * 
 * Generates short video samples from specific timestamps
 * for manual or automated quality verification.
 */

import { executeCommand, ensureDir } from '@media-bot/utils';
import { join, dirname } from 'node:path';

export interface Sample {
  type: 'start' | 'middle' | 'end';
  timestampMs: number;
  durationMs: number;
  filePath: string;
}

export interface SampleOptions {
  durationSec?: number;  // Sample length (default: 10s)
  outputDir?: string;    // Output directory
  format?: string;       // Output format (default: mkv)
}

export class SampleGenerator {
  private ffmpegPath: string;

  constructor(ffmpegPath: string = 'ffmpeg') {
    this.ffmpegPath = ffmpegPath;
  }

  /**
   * Generate samples at start, middle, and end of the file
   */
  async generateSamples(
    inputFile: string,
    totalDurationMs: number,
    jobId: string,
    options: SampleOptions = {}
  ): Promise<Sample[]> {
    const durationSec = options.durationSec ?? 10;
    const format = options.format ?? 'mkv';
    const outputDir = options.outputDir ?? dirname(inputFile);

    await ensureDir(outputDir);

    // Calculate sample positions
    const positions = [
      { type: 'start' as const, timestampMs: 0 },
      { type: 'middle' as const, timestampMs: Math.floor(totalDurationMs / 2) },
      { type: 'end' as const, timestampMs: Math.max(0, totalDurationMs - (durationSec * 1000)) },
    ];

    const samples: Sample[] = [];

    for (const pos of positions) {
      const outputFile = join(outputDir, `sample_${jobId}_${pos.type}.${format}`);
      
      await this.extractSample(
        inputFile,
        outputFile,
        pos.timestampMs / 1000,
        durationSec
      );

      samples.push({
        type: pos.type,
        timestampMs: pos.timestampMs,
        durationMs: durationSec * 1000,
        filePath: outputFile,
      });
    }

    return samples;
  }

  /**
   * Extract a single sample
   */
  private async extractSample(
    inputFile: string,
    outputFile: string,
    startSec: number,
    durationSec: number
  ): Promise<void> {
    const args = [
      '-ss', startSec.toString(),
      '-i', inputFile,
      '-t', durationSec.toString(),
      '-c', 'copy', // No re-encoding for speed
      '-y',
      outputFile,
    ];

    const result = await executeCommand(this.ffmpegPath, args, {
      timeout: 60000,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Failed to extract sample: ${result.stderr}`);
    }
  }
}
