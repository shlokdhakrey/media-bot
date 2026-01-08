/**
 * FFProbe Wrapper
 * 
 * Safe wrapper for ffprobe command execution.
 * Extracts comprehensive metadata in JSON format.
 */

import { executeCommand } from '@media-bot/utils';

export interface FFProbeResult {
  format: {
    filename: string;
    nb_streams: number;
    nb_programs: number;
    format_name: string;
    format_long_name: string;
    start_time: string;
    duration: string;
    size: string;
    bit_rate: string;
    probe_score: number;
    tags?: Record<string, string>;
  };
  streams: Array<{
    index: number;
    codec_name: string;
    codec_long_name: string;
    profile?: string;
    codec_type: 'video' | 'audio' | 'subtitle' | 'data';
    codec_time_base?: string;
    time_base: string;
    start_pts?: number;
    start_time?: string;
    duration_ts?: number;
    duration?: string;
    bit_rate?: string;
    // Video specific
    width?: number;
    height?: number;
    display_aspect_ratio?: string;
    pix_fmt?: string;
    level?: number;
    color_range?: string;
    color_space?: string;
    color_transfer?: string;
    color_primaries?: string;
    r_frame_rate?: string;
    avg_frame_rate?: string;
    // Audio specific
    sample_rate?: string;
    channels?: number;
    channel_layout?: string;
    bits_per_sample?: number;
    initial_padding?: number;
    // Common
    disposition?: Record<string, number>;
    tags?: Record<string, string>;
    side_data_list?: Array<Record<string, unknown>>;
  }>;
  chapters?: Array<{
    id: number;
    time_base: string;
    start: number;
    start_time: string;
    end: number;
    end_time: string;
    tags?: Record<string, string>;
  }>;
}

export class FFProbe {
  private ffprobePath: string;

  constructor(ffprobePath: string = 'ffprobe') {
    this.ffprobePath = ffprobePath;
  }

  /**
   * Probe a media file and return detailed metadata
   */
  async probe(filePath: string): Promise<FFProbeResult> {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-show_chapters',
      '-show_error',
      filePath,
    ];

    const result = await executeCommand(this.ffprobePath, args, {
      timeout: 60000, // 1 minute timeout
    });

    if (result.exitCode !== 0) {
      throw new Error(`ffprobe failed: ${result.stderr}`);
    }

    try {
      return JSON.parse(result.stdout) as FFProbeResult;
    } catch {
      throw new Error(`Failed to parse ffprobe output: ${result.stdout.substring(0, 200)}`);
    }
  }

  /**
   * Check if ffprobe is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await executeCommand(this.ffprobePath, ['-version'], {
        timeout: 5000,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }
}
