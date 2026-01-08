/**
 * Bitrate Analyzer
 * 
 * Analyzes video bitrate on a per-frame and per-GOP basis.
 * Useful for:
 * - Quality assessment
 * - Encoding optimization
 * - Detecting compression artifacts
 * - Bandwidth estimation
 */

import { executeCommand, logger } from '@media-bot/utils';

export interface FrameInfo {
  type: 'I' | 'P' | 'B' | 'unknown';
  timestamp: number;
  size: number; // bytes
  duration: number; // seconds
  bitrate: number; // bits per second for this frame
}

export interface GOPInfo {
  startFrame: number;
  endFrame: number;
  frameCount: number;
  iFrameCount: number;
  pFrameCount: number;
  bFrameCount: number;
  totalSize: number;
  duration: number;
  averageBitrate: number;
}

export interface BitrateStats {
  average: number;
  min: number;
  max: number;
  median: number;
  standardDeviation: number;
  percentile95: number;
}

export interface BitrateAnalysisResult {
  // Overall stats
  overallBitrate: number;
  duration: number;
  totalSize: number;
  
  // Frame stats
  frameCount: number;
  iFrameCount: number;
  pFrameCount: number;
  bFrameCount: number;
  
  // Bitrate statistics
  bitrateStats: BitrateStats;
  iFrameStats: BitrateStats;
  pFrameStats: BitrateStats;
  bFrameStats: BitrateStats;
  
  // GOP analysis
  gopCount: number;
  averageGopSize: number;
  gops: GOPInfo[];
  
  // Per-second bitrate (for graphs)
  bitratePerSecond: { timestamp: number; bitrate: number }[];
  
  // Quality indicators
  isConstantBitrate: boolean;
  bitrateVariability: number; // coefficient of variation
}

export interface BitrateAnalyzerOptions {
  ffprobePath?: string;
  timeout?: number;
  /** Analyze only first N frames (0 = all) */
  maxFrames?: number;
}

export class BitrateAnalyzer {
  private ffprobePath: string;
  private timeout: number;
  private maxFrames: number;

  constructor(options: BitrateAnalyzerOptions = {}) {
    this.ffprobePath = options.ffprobePath ?? 'ffprobe';
    this.timeout = options.timeout ?? 1800000; // 30 minutes (can be slow for large files)
    this.maxFrames = options.maxFrames ?? 0;
  }

  /**
   * Analyze bitrate of a video file
   */
  async analyze(
    filePath: string,
    options: { streamIndex?: number; gopAnalysis?: boolean } = {}
  ): Promise<BitrateAnalysisResult> {
    const streamIndex = options.streamIndex ?? 0;
    const gopAnalysis = options.gopAnalysis ?? true;

    logger.info({ filePath, streamIndex }, 'Starting bitrate analysis');

    // Get frame-by-frame data
    const frames = await this.getFrameData(filePath, streamIndex);

    if (frames.length === 0) {
      throw new Error('No frames found in video');
    }

    // Calculate basic stats
    const lastFrame = frames[frames.length - 1]!;
    const totalSize = frames.reduce((sum, f) => sum + f.size, 0);
    const duration = lastFrame.timestamp + lastFrame.duration;
    const overallBitrate = (totalSize * 8) / duration;

    // Count frame types
    const iFrames = frames.filter(f => f.type === 'I');
    const pFrames = frames.filter(f => f.type === 'P');
    const bFrames = frames.filter(f => f.type === 'B');

    // Calculate bitrate statistics
    const bitrateStats = this.calculateStats(frames.map(f => f.bitrate));
    const iFrameStats = this.calculateStats(iFrames.map(f => f.bitrate));
    const pFrameStats = this.calculateStats(pFrames.map(f => f.bitrate));
    const bFrameStats = this.calculateStats(bFrames.map(f => f.bitrate));

    // GOP analysis
    const gops = gopAnalysis ? this.analyzeGOPs(frames) : [];

    // Per-second bitrate
    const bitratePerSecond = this.calculatePerSecondBitrate(frames, duration);

    // Quality indicators
    const bitrateVariability = bitrateStats.standardDeviation / bitrateStats.average;
    const isConstantBitrate = bitrateVariability < 0.1; // CV < 10%

    const result: BitrateAnalysisResult = {
      overallBitrate,
      duration,
      totalSize,
      
      frameCount: frames.length,
      iFrameCount: iFrames.length,
      pFrameCount: pFrames.length,
      bFrameCount: bFrames.length,
      
      bitrateStats,
      iFrameStats,
      pFrameStats,
      bFrameStats,
      
      gopCount: gops.length,
      averageGopSize: gops.length > 0 
        ? gops.reduce((sum, g) => sum + g.frameCount, 0) / gops.length 
        : 0,
      gops,
      
      bitratePerSecond,
      
      isConstantBitrate,
      bitrateVariability,
    };

    logger.info({
      filePath,
      frameCount: frames.length,
      overallBitrate: Math.round(overallBitrate / 1000) + ' kbps',
      gopCount: gops.length,
    }, 'Bitrate analysis complete');

    return result;
  }

  /**
   * Get frame-by-frame data from FFprobe
   */
  private async getFrameData(filePath: string, streamIndex: number): Promise<FrameInfo[]> {
    const args = [
      '-v', 'error',
      '-select_streams', `v:${streamIndex}`,
      '-show_frames',
      '-show_entries', 'frame=pkt_pts_time,pkt_duration_time,pkt_size,pict_type',
      '-of', 'json',
    ];

    if (this.maxFrames > 0) {
      args.push('-read_intervals', `%+#${this.maxFrames}`);
    }

    args.push(filePath);

    const result = await executeCommand(this.ffprobePath, args, {
      timeout: this.timeout,
    });

    if (result.exitCode !== 0) {
      throw new Error(`FFprobe failed: ${result.stderr}`);
    }

    const data = JSON.parse(result.stdout);
    const frames: FrameInfo[] = [];

    for (const frame of data.frames ?? []) {
      const timestamp = parseFloat(frame.pkt_pts_time ?? '0');
      const duration = parseFloat(frame.pkt_duration_time ?? '0.0416'); // default ~24fps
      const size = parseInt(frame.pkt_size ?? '0', 10);
      
      let type: FrameInfo['type'] = 'unknown';
      const pictType = frame.pict_type?.toUpperCase() ?? '';
      if (pictType === 'I') type = 'I';
      else if (pictType === 'P') type = 'P';
      else if (pictType === 'B') type = 'B';

      frames.push({
        type,
        timestamp,
        duration,
        size,
        bitrate: duration > 0 ? (size * 8) / duration : 0,
      });
    }

    return frames;
  }

  /**
   * Calculate statistics for an array of values
   */
  private calculateStats(values: number[]): BitrateStats {
    if (values.length === 0) {
      return {
        average: 0,
        min: 0,
        max: 0,
        median: 0,
        standardDeviation: 0,
        percentile95: 0,
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const average = sum / values.length;

    // Variance and standard deviation
    const squaredDiffs = values.map(v => Math.pow(v - average, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    const standardDeviation = Math.sqrt(variance);

    // Percentiles
    const medianIndex = Math.floor(values.length / 2);
    const p95Index = Math.floor(values.length * 0.95);

    return {
      average,
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      median: values.length % 2 === 0
        ? ((sorted[medianIndex - 1] ?? 0) + (sorted[medianIndex] ?? 0)) / 2
        : (sorted[medianIndex] ?? 0),
      standardDeviation,
      percentile95: sorted[p95Index] ?? 0,
    };
  }

  /**
   * Analyze GOP structure
   */
  private analyzeGOPs(frames: FrameInfo[]): GOPInfo[] {
    const gops: GOPInfo[] = [];
    let currentGOP: FrameInfo[] = [];
    let gopStartFrame = 0;

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i]!;

      // New GOP starts with I-frame
      if (frame.type === 'I' && currentGOP.length > 0) {
        gops.push(this.createGOPInfo(currentGOP, gopStartFrame));
        currentGOP = [];
        gopStartFrame = i;
      }

      currentGOP.push(frame);
    }

    // Last GOP
    if (currentGOP.length > 0) {
      gops.push(this.createGOPInfo(currentGOP, gopStartFrame));
    }

    return gops;
  }

  /**
   * Create GOP info from frames
   */
  private createGOPInfo(frames: FrameInfo[], startFrame: number): GOPInfo {
    const iFrames = frames.filter(f => f.type === 'I').length;
    const pFrames = frames.filter(f => f.type === 'P').length;
    const bFrames = frames.filter(f => f.type === 'B').length;
    const totalSize = frames.reduce((sum, f) => sum + f.size, 0);
    const duration = frames.reduce((sum, f) => sum + f.duration, 0);

    return {
      startFrame,
      endFrame: startFrame + frames.length - 1,
      frameCount: frames.length,
      iFrameCount: iFrames,
      pFrameCount: pFrames,
      bFrameCount: bFrames,
      totalSize,
      duration,
      averageBitrate: duration > 0 ? (totalSize * 8) / duration : 0,
    };
  }

  /**
   * Calculate per-second bitrate
   */
  private calculatePerSecondBitrate(
    frames: FrameInfo[], 
    duration: number
  ): { timestamp: number; bitrate: number }[] {
    const result: { timestamp: number; bitrate: number }[] = [];
    const bucketDuration = 1.0; // 1 second buckets

    for (let t = 0; t < duration; t += bucketDuration) {
      const bucketFrames = frames.filter(
        f => f.timestamp >= t && f.timestamp < t + bucketDuration
      );
      
      const bucketSize = bucketFrames.reduce((sum, f) => sum + f.size, 0);
      const bucketBitrate = (bucketSize * 8) / bucketDuration;

      result.push({
        timestamp: t,
        bitrate: bucketBitrate,
      });
    }

    return result;
  }

  /**
   * Quick bitrate estimation (faster than full analysis)
   */
  async quickEstimate(
    filePath: string,
    sampleDuration: number = 30
  ): Promise<{ bitrate: number; isEstimate: boolean }> {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-read_intervals', `%+${sampleDuration}`,
      '-show_entries', 'frame=pkt_size',
      '-of', 'csv=p=0',
      filePath,
    ];

    const result = await executeCommand(this.ffprobePath, args, {
      timeout: 60000,
    });

    if (result.exitCode !== 0) {
      throw new Error(`FFprobe failed: ${result.stderr}`);
    }

    const lines = result.stdout.trim().split('\n');
    const totalBytes = lines.reduce((sum, line) => {
      return sum + (parseInt(line, 10) || 0);
    }, 0);

    // Get actual duration of sampled frames
    const durationArgs = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-read_intervals', `%+${sampleDuration}`,
      '-show_entries', 'frame=pkt_duration_time',
      '-of', 'csv=p=0',
      filePath,
    ];

    const durationResult = await executeCommand(this.ffprobePath, durationArgs, {
      timeout: 60000,
    });

    const actualDuration = durationResult.stdout.trim().split('\n')
      .reduce((sum, line) => sum + (parseFloat(line) || 0), 0);

    return {
      bitrate: actualDuration > 0 ? (totalBytes * 8) / actualDuration : 0,
      isEstimate: actualDuration < sampleDuration * 0.9,
    };
  }

  /**
   * Check if FFprobe is available
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

// Singleton instance
export const bitrateAnalyzer = new BitrateAnalyzer();