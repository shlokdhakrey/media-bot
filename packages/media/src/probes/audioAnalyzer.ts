/**
 * Audio Analyzer
 * 
 * Analyzes audio loudness, dynamics, and quality using FFmpeg filters.
 * Implements EBU R128 loudness measurement.
 * 
 * Useful for:
 * - Loudness normalization decisions
 * - Quality assessment
 * - Dynamic range analysis
 * - Audio sync verification
 */

import { executeCommand, logger } from '@media-bot/utils';

export interface LoudnessInfo {
  // Integrated loudness (overall, LUFS)
  integratedLoudness: number;
  // True peak (dBTP)
  truePeak: number;
  // Loudness range (LU)
  loudnessRange: number;
  // Short-term loudness stats
  shortTermMax: number;
  shortTermMin: number;
  // Momentary loudness stats  
  momentaryMax: number;
  momentaryMin: number;
}

export interface DynamicsInfo {
  // Peak level (dBFS)
  peakLevel: number;
  // RMS level (dBFS)
  rmsLevel: number;
  // Dynamic range (dB)
  dynamicRange: number;
  // Crest factor (peak/RMS ratio in dB)
  crestFactor: number;
  // DC offset
  dcOffset: number;
}

export interface SilenceInfo {
  silenceStart: number;
  silenceEnd: number;
  silenceDuration: number;
}

export interface AudioQualityInfo {
  // Clipping detection
  clippedSamples: number;
  clippingRatio: number;
  hasClipping: boolean;
  // Silence detection
  silencePeriods: SilenceInfo[];
  totalSilenceDuration: number;
  silenceRatio: number;
  // Noise floor estimate (dB)
  noiseFloor: number;
}

export interface AudioAnalysisResult {
  // Stream info
  streamIndex: number;
  codec: string;
  sampleRate: number;
  channels: number;
  channelLayout: string;
  duration: number;
  
  // Loudness (EBU R128)
  loudness: LoudnessInfo;
  
  // Dynamics
  dynamics: DynamicsInfo;
  
  // Quality metrics
  quality: AudioQualityInfo;
  
  // Recommendations
  recommendations: string[];
}

export interface AudioAnalyzerOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  timeout?: number;
}

export class AudioAnalyzer {
  private ffmpegPath: string;
  private ffprobePath: string;
  private timeout: number;

  constructor(options: AudioAnalyzerOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    this.ffprobePath = options.ffprobePath ?? 'ffprobe';
    this.timeout = options.timeout ?? 600000; // 10 minutes
  }

  /**
   * Perform complete audio analysis
   */
  async analyze(
    filePath: string,
    streamIndex: number = 0
  ): Promise<AudioAnalysisResult> {
    logger.info({ filePath, streamIndex }, 'Starting audio analysis');

    // Get basic stream info
    const streamInfo = await this.getStreamInfo(filePath, streamIndex);

    // Run analyses in parallel where possible
    const [loudness, dynamics, quality] = await Promise.all([
      this.measureLoudness(filePath, streamIndex),
      this.measureDynamics(filePath, streamIndex),
      this.measureQuality(filePath, streamIndex, streamInfo.duration),
    ]);

    // Generate recommendations
    const recommendations = this.generateRecommendations(loudness, dynamics, quality);

    const result: AudioAnalysisResult = {
      ...streamInfo,
      loudness,
      dynamics,
      quality,
      recommendations,
    };

    logger.info({
      filePath,
      streamIndex,
      integratedLoudness: loudness.integratedLoudness.toFixed(1) + ' LUFS',
      truePeak: loudness.truePeak.toFixed(1) + ' dBTP',
    }, 'Audio analysis complete');

    return result;
  }

  /**
   * Get basic audio stream info
   */
  private async getStreamInfo(filePath: string, streamIndex: number): Promise<{
    streamIndex: number;
    codec: string;
    sampleRate: number;
    channels: number;
    channelLayout: string;
    duration: number;
  }> {
    const args = [
      '-v', 'error',
      '-select_streams', `a:${streamIndex}`,
      '-show_entries', 'stream=codec_name,sample_rate,channels,channel_layout,duration',
      '-of', 'json',
      filePath,
    ];

    const result = await executeCommand(this.ffprobePath, args, {
      timeout: 30000,
    });

    if (result.exitCode !== 0) {
      throw new Error(`FFprobe failed: ${result.stderr}`);
    }

    const data = JSON.parse(result.stdout);
    const stream = data.streams?.[0];

    if (!stream) {
      throw new Error(`Audio stream ${streamIndex} not found`);
    }

    return {
      streamIndex,
      codec: stream.codec_name ?? 'unknown',
      sampleRate: parseInt(stream.sample_rate ?? '0', 10),
      channels: stream.channels ?? 0,
      channelLayout: stream.channel_layout ?? 'unknown',
      duration: parseFloat(stream.duration ?? '0'),
    };
  }

  /**
   * Measure loudness using EBU R128 (loudnorm filter)
   */
  private async measureLoudness(filePath: string, streamIndex: number): Promise<LoudnessInfo> {
    // Use ebur128 filter for detailed loudness analysis
    const args = [
      '-i', filePath,
      '-map', `0:a:${streamIndex}`,
      '-af', 'ebur128=peak=true',
      '-f', 'null',
      '-',
    ];

    const result = await executeCommand(this.ffmpegPath, args, {
      timeout: this.timeout,
    });

    // Parse the output (in stderr)
    return this.parseLoudnessOutput(result.stderr);
  }

  /**
   * Parse loudness measurement output
   */
  private parseLoudnessOutput(stderr: string): LoudnessInfo {
    // Default values if parsing fails
    const info: LoudnessInfo = {
      integratedLoudness: -23,
      truePeak: -1,
      loudnessRange: 0,
      shortTermMax: -23,
      shortTermMin: -70,
      momentaryMax: -23,
      momentaryMin: -70,
    };

    // Find summary section
    const summaryMatch = stderr.match(/Summary:([\s\S]*?)$/);
    if (!summaryMatch) {
      // Try alternative format
      const ilMatch = stderr.match(/I:\s*(-?\d+\.?\d*)\s*LUFS/);
      const tpMatch = stderr.match(/True peak:\s*(-?\d+\.?\d*)\s*dBFS/);
      const lraMatch = stderr.match(/LRA:\s*(\d+\.?\d*)\s*LU/);

      if (ilMatch?.[1]) info.integratedLoudness = parseFloat(ilMatch[1]);
      if (tpMatch?.[1]) info.truePeak = parseFloat(tpMatch[1]);
      if (lraMatch?.[1]) info.loudnessRange = parseFloat(lraMatch[1]);

      return info;
    }

    const summary = summaryMatch[1] ?? '';

    // Integrated loudness
    const intMatch = summary.match(/I:\s*(-?\d+\.?\d*)\s*LUFS/);
    if (intMatch?.[1]) info.integratedLoudness = parseFloat(intMatch[1]);

    // True peak
    const tpMatch = summary.match(/True peak:\s*(-?\d+\.?\d*)\s*dBFS/);
    if (tpMatch?.[1]) info.truePeak = parseFloat(tpMatch[1]);

    // Loudness range
    const lraMatch = summary.match(/LRA:\s*(\d+\.?\d*)\s*LU/);
    if (lraMatch?.[1]) info.loudnessRange = parseFloat(lraMatch[1]);

    // Short-term
    const stMaxMatch = summary.match(/S peak:\s*(-?\d+\.?\d*)\s*LUFS/);
    const stMinMatch = summary.match(/S min:\s*(-?\d+\.?\d*)\s*LUFS/);
    if (stMaxMatch?.[1]) info.shortTermMax = parseFloat(stMaxMatch[1]);
    if (stMinMatch?.[1]) info.shortTermMin = parseFloat(stMinMatch[1]);

    // Momentary
    const mMaxMatch = summary.match(/M peak:\s*(-?\d+\.?\d*)\s*LUFS/);
    const mMinMatch = summary.match(/M min:\s*(-?\d+\.?\d*)\s*LUFS/);
    if (mMaxMatch?.[1]) info.momentaryMax = parseFloat(mMaxMatch[1]);
    if (mMinMatch?.[1]) info.momentaryMin = parseFloat(mMinMatch[1]);

    return info;
  }

  /**
   * Measure dynamics (peak, RMS, dynamic range)
   */
  private async measureDynamics(filePath: string, streamIndex: number): Promise<DynamicsInfo> {
    // Use astats filter
    const args = [
      '-i', filePath,
      '-map', `0:a:${streamIndex}`,
      '-af', 'astats=metadata=1:reset=1',
      '-f', 'null',
      '-',
    ];

    const result = await executeCommand(this.ffmpegPath, args, {
      timeout: this.timeout,
    });

    return this.parseDynamicsOutput(result.stderr);
  }

  /**
   * Parse dynamics output
   */
  private parseDynamicsOutput(stderr: string): DynamicsInfo {
    const info: DynamicsInfo = {
      peakLevel: -100,
      rmsLevel: -100,
      dynamicRange: 0,
      crestFactor: 0,
      dcOffset: 0,
    };

    // Peak level
    const peakMatch = stderr.match(/Peak level dB:\s*(-?\d+\.?\d*)/);
    if (peakMatch?.[1]) info.peakLevel = parseFloat(peakMatch[1]);

    // RMS level
    const rmsMatch = stderr.match(/RMS level dB:\s*(-?\d+\.?\d*)/);
    if (rmsMatch?.[1]) info.rmsLevel = parseFloat(rmsMatch[1]);

    // Calculate dynamic range and crest factor
    if (info.peakLevel > -100 && info.rmsLevel > -100) {
      info.crestFactor = info.peakLevel - info.rmsLevel;
      // Dynamic range approximation
      info.dynamicRange = info.crestFactor * 1.5; // rough estimate
    }

    // DC offset
    const dcMatch = stderr.match(/DC offset:\s*(-?\d+\.?\d*)/);
    if (dcMatch?.[1]) info.dcOffset = parseFloat(dcMatch[1]);

    return info;
  }

  /**
   * Measure quality metrics (clipping, silence, noise)
   */
  private async measureQuality(
    filePath: string, 
    streamIndex: number,
    duration: number
  ): Promise<AudioQualityInfo> {
    // Detect clipping
    const clipping = await this.detectClipping(filePath, streamIndex);
    
    // Detect silence
    const silence = await this.detectSilence(filePath, streamIndex);
    
    // Calculate ratios
    const totalSilenceDuration = silence.reduce((sum, s) => sum + s.silenceDuration, 0);

    return {
      clippedSamples: clipping.count,
      clippingRatio: clipping.ratio,
      hasClipping: clipping.count > 0,
      silencePeriods: silence,
      totalSilenceDuration,
      silenceRatio: duration > 0 ? totalSilenceDuration / duration : 0,
      noiseFloor: -60, // Would need more sophisticated analysis
    };
  }

  /**
   * Detect clipping
   */
  private async detectClipping(
    filePath: string, 
    streamIndex: number
  ): Promise<{ count: number; ratio: number }> {
    const args = [
      '-i', filePath,
      '-map', `0:a:${streamIndex}`,
      '-af', 'astat',
      '-f', 'null',
      '-',
    ];

    const result = await executeCommand(this.ffmpegPath, args, {
      timeout: this.timeout,
    });

    // Look for clipping info in output
    const clipMatch = result.stderr.match(/Number of clips:\s*(\d+)/);
    const samplesMatch = result.stderr.match(/Number of samples:\s*(\d+)/);

    const count = clipMatch?.[1] ? parseInt(clipMatch[1], 10) : 0;
    const samples = samplesMatch?.[1] ? parseInt(samplesMatch[1], 10) : 1;

    return {
      count,
      ratio: count / samples,
    };
  }

  /**
   * Detect silence periods
   */
  private async detectSilence(
    filePath: string, 
    streamIndex: number
  ): Promise<SilenceInfo[]> {
    const args = [
      '-i', filePath,
      '-map', `0:a:${streamIndex}`,
      '-af', 'silencedetect=noise=-50dB:d=0.5',
      '-f', 'null',
      '-',
    ];

    const result = await executeCommand(this.ffmpegPath, args, {
      timeout: this.timeout,
    });

    return this.parseSilenceOutput(result.stderr);
  }

  /**
   * Parse silence detection output
   */
  private parseSilenceOutput(stderr: string): SilenceInfo[] {
    const silences: SilenceInfo[] = [];
    
    // Pattern: silence_start: 0 | silence_end: 1.5 | silence_duration: 1.5
    const startPattern = /silence_start:\s*(\d+\.?\d*)/g;
    const endPattern = /silence_end:\s*(\d+\.?\d*)\s*\|\s*silence_duration:\s*(\d+\.?\d*)/g;

    const starts: number[] = [];
    let match;

    while ((match = startPattern.exec(stderr)) !== null) {
      if (match[1]) starts.push(parseFloat(match[1]));
    }

    let i = 0;
    while ((match = endPattern.exec(stderr)) !== null) {
      if (i < starts.length && match[1] && match[2]) {
        silences.push({
          silenceStart: starts[i]!,
          silenceEnd: parseFloat(match[1]),
          silenceDuration: parseFloat(match[2]),
        });
        i++;
      }
    }

    return silences;
  }

  /**
   * Generate recommendations based on analysis
   */
  private generateRecommendations(
    loudness: LoudnessInfo,
    dynamics: DynamicsInfo,
    quality: AudioQualityInfo
  ): string[] {
    const recommendations: string[] = [];

    // Loudness recommendations
    if (loudness.integratedLoudness < -24) {
      recommendations.push('Audio is too quiet. Consider normalizing to -14 LUFS for streaming.');
    } else if (loudness.integratedLoudness > -10) {
      recommendations.push('Audio is very loud. May cause clipping or fatigue.');
    }

    // True peak
    if (loudness.truePeak > -1) {
      recommendations.push('True peak is above -1 dBTP. May cause inter-sample clipping.');
    }

    // Dynamic range
    if (loudness.loudnessRange < 3) {
      recommendations.push('Very low dynamic range. Audio may sound compressed/fatiguing.');
    } else if (loudness.loudnessRange > 20) {
      recommendations.push('High dynamic range. May need compression for some platforms.');
    }

    // Clipping
    if (quality.hasClipping) {
      recommendations.push(`Clipping detected (${quality.clippedSamples} samples). Consider re-encoding from source.`);
    }

    // Silence
    if (quality.silenceRatio > 0.1) {
      recommendations.push('Significant silence detected. Check for audio gaps.');
    }

    // DC offset
    if (Math.abs(dynamics.dcOffset) > 0.01) {
      recommendations.push('DC offset detected. Consider applying highpass filter.');
    }

    return recommendations;
  }

  /**
   * Quick loudness check (faster than full analysis)
   */
  async quickLoudness(filePath: string, streamIndex: number = 0): Promise<{
    integratedLoudness: number;
    truePeak: number;
  }> {
    const args = [
      '-i', filePath,
      '-map', `0:a:${streamIndex}`,
      '-af', 'ebur128=peak=true',
      '-t', '60', // Analyze first 60 seconds only
      '-f', 'null',
      '-',
    ];

    const result = await executeCommand(this.ffmpegPath, args, {
      timeout: 120000,
    });

    const loudness = this.parseLoudnessOutput(result.stderr);

    return {
      integratedLoudness: loudness.integratedLoudness,
      truePeak: loudness.truePeak,
    };
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
}

// Singleton instance
export const audioAnalyzer = new AudioAnalyzer();