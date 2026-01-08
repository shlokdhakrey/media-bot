/**
 * Silence Detection
 * 
 * Uses FFmpeg silencedetect filter to find actual audio boundaries.
 * Critical for determining true start/end of audio content.
 */

import { executeCommand } from '@media-bot/utils';

export interface SilenceRegion {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface SilenceResult {
  audioStartMs: number;    // First non-silent audio
  audioEndMs: number;      // Last non-silent audio
  regions: SilenceRegion[];
  totalSilenceMs: number;
  totalDurationMs: number;
}

export class SilenceDetector {
  private ffmpegPath: string;

  constructor(ffmpegPath: string = 'ffmpeg') {
    this.ffmpegPath = ffmpegPath;
  }

  /**
   * Detect silence regions in an audio file
   */
  async detect(
    filePath: string,
    options: {
      noiseDb?: number;      // Noise floor in dB (default: -50)
      durationSec?: number;  // Minimum silence duration (default: 0.1)
    } = {}
  ): Promise<SilenceResult> {
    const noiseDb = options.noiseDb ?? -50;
    const durationSec = options.durationSec ?? 0.1;

    const args = [
      '-i', filePath,
      '-af', `silencedetect=noise=${noiseDb}dB:d=${durationSec}`,
      '-f', 'null',
      '-',
    ];

    const result = await executeCommand(this.ffmpegPath, args, {
      timeout: 300000, // 5 minutes
    });

    // FFmpeg outputs to stderr
    return this.parseOutput(result.stderr);
  }

  private parseOutput(output: string): SilenceResult {
    const regions: SilenceRegion[] = [];
    let totalDurationMs = 0;
    
    // Parse silence_start and silence_end pairs
    const lines = output.split('\n');
    let currentStart: number | null = null;

    for (const line of lines) {
      // Match: [silencedetect @ 0x...] silence_start: 0.123
      const startMatch = line.match(/silence_start:\s*([\d.]+)/);
      if (startMatch) {
        currentStart = parseFloat(startMatch[1] ?? '0') * 1000;
      }

      // Match: [silencedetect @ 0x...] silence_end: 1.234 | silence_duration: 1.111
      const endMatch = line.match(/silence_end:\s*([\d.]+)/);
      if (endMatch && currentStart !== null) {
        const endMs = parseFloat(endMatch[1] ?? '0') * 1000;
        regions.push({
          startMs: currentStart,
          endMs,
          durationMs: endMs - currentStart,
        });
        currentStart = null;
      }

      // Parse total duration
      const durationMatch = line.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (durationMatch) {
        const hours = parseInt(durationMatch[1] ?? '0', 10);
        const minutes = parseInt(durationMatch[2] ?? '0', 10);
        const seconds = parseFloat(durationMatch[3] ?? '0');
        totalDurationMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
      }
    }

    // Calculate audio boundaries
    const audioStartMs = regions.length > 0 && regions[0]!.startMs === 0
      ? regions[0]!.endMs
      : 0;
    
    const lastRegion = regions[regions.length - 1];
    const audioEndMs = lastRegion && Math.abs(lastRegion.endMs - totalDurationMs) < 100
      ? lastRegion.startMs
      : totalDurationMs;

    const totalSilenceMs = regions.reduce((sum, r) => sum + r.durationMs, 0);

    return {
      audioStartMs,
      audioEndMs,
      regions,
      totalSilenceMs,
      totalDurationMs,
    };
  }
}
