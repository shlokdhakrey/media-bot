/**
 * Cross-Correlation Audio Sync Engine
 * 
 * Uses time-domain cross-correlation to find precise audio alignment.
 * This is similar to how professional audio tools (Audacity, Pro Tools)
 * detect sync between audio tracks.
 * 
 * The algorithm:
 * 1. Extract raw audio waveforms from both files
 * 2. Compute cross-correlation at different time offsets
 * 3. Find the offset with maximum correlation
 * 4. Verify with multiple segments to detect drift/cuts
 */

import { executeCommand } from '@media-bot/utils';
import { createLogger } from '@media-bot/utils';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const logger = createLogger({ module: 'cross-correlation' });

export interface WaveformData {
  /** Sample rate */
  sampleRate: number;
  /** Audio samples (normalized -1 to 1) */
  samples: Float32Array;
  /** Duration in seconds */
  duration: number;
  /** Peak amplitude */
  peak: number;
  /** RMS level */
  rms: number;
}

export interface CorrelationResult {
  /** Delay in milliseconds (positive = target is behind reference) */
  delayMs: number;
  /** Correlation coefficient (-1 to 1) */
  correlation: number;
  /** Confidence in the result (0 to 1) */
  confidence: number;
}

export interface CrossCorrelationResult {
  /** Global delay (most common offset) */
  globalDelayMs: number;
  /** Global correlation confidence */
  globalConfidence: number;
  /** Per-segment analysis */
  segments: Array<{
    startMs: number;
    endMs: number;
    delayMs: number;
    correlation: number;
    confidence: number;
    reason: 'cross_correlation' | 'anchor_match' | 'peak_match';
  }>;
  /** Is drift detected (progressive offset change)? */
  hasDrift: boolean;
  /** Drift rate in ms per second (0 if no drift) */
  driftRate: number;
  /** Are there cuts/insertions detected? */
  hasCuts: boolean;
  /** Cut points detected */
  cutPoints: Array<{
    timestampMs: number;
    type: 'cut' | 'insertion';
    durationMs: number;
  }>;
  /** Raw correlation data for visualization */
  correlationGraph: Array<{
    offsetMs: number;
    correlation: number;
  }>;
}

export class CrossCorrelationEngine {
  private ffmpegPath: string;
  private tempDir: string;

  constructor(options: { ffmpegPath?: string; tempDir?: string } = {}) {
    this.ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    this.tempDir = options.tempDir ?? os.tmpdir();
  }

  /**
   * Analyze sync between reference (synced) and target (unsynced) audio
   */
  async analyze(
    referenceFile: string,
    targetFile: string,
    options: {
      /** Maximum offset to search in seconds */
      maxOffsetSec?: number;
      /** Analysis window size in seconds */
      windowSizeSec?: number;
      /** Step size between windows in seconds */
      stepSizeSec?: number;
      /** Sample rate for analysis (lower = faster but less accurate) */
      analysisSampleRate?: number;
      /** Extract audio from video file? */
      extractFromVideo?: boolean;
    } = {}
  ): Promise<CrossCorrelationResult> {
    const maxOffsetSec = options.maxOffsetSec ?? 30;
    const windowSizeSec = options.windowSizeSec ?? 10;
    const stepSizeSec = options.stepSizeSec ?? 5;
    const analysisSampleRate = options.analysisSampleRate ?? 8000;

    logger.info({
      referenceFile,
      targetFile,
      maxOffsetSec,
      windowSizeSec,
    }, 'Starting cross-correlation analysis');

    // Extract waveforms
    const [refWaveform, targetWaveform] = await Promise.all([
      this.extractWaveform(referenceFile, analysisSampleRate, options.extractFromVideo),
      this.extractWaveform(targetFile, analysisSampleRate, options.extractFromVideo),
    ]);

    logger.debug({
      refDuration: refWaveform.duration,
      targetDuration: targetWaveform.duration,
      refPeak: refWaveform.peak,
      targetPeak: targetWaveform.peak,
    }, 'Waveforms extracted');

    // Global cross-correlation to find overall offset
    const globalResult = this.crossCorrelate(
      refWaveform.samples,
      targetWaveform.samples,
      analysisSampleRate,
      maxOffsetSec
    );

    // Segment-by-segment analysis
    const segments = await this.analyzeSegments(
      refWaveform,
      targetWaveform,
      windowSizeSec,
      stepSizeSec,
      maxOffsetSec
    );

    // Detect drift
    const { hasDrift, driftRate } = this.detectDrift(segments);

    // Detect cuts/insertions
    const { hasCuts, cutPoints } = this.detectCuts(segments, globalResult.delayMs);

    return {
      globalDelayMs: globalResult.delayMs,
      globalConfidence: globalResult.confidence,
      segments,
      hasDrift,
      driftRate,
      hasCuts,
      cutPoints,
      correlationGraph: globalResult.graph,
    };
  }

  /**
   * Extract audio waveform from file
   */
  private async extractWaveform(
    filePath: string,
    sampleRate: number,
    extractFromVideo: boolean = false
  ): Promise<WaveformData> {
    const tempFile = path.join(this.tempDir, `waveform_${Date.now()}_${Math.random().toString(36).slice(2)}.raw`);

    try {
      // Extract audio as raw PCM
      const args = [
        '-i', filePath,
        '-vn', // No video
        '-ac', '1', // Mono
        '-ar', sampleRate.toString(),
        '-f', 's16le', // Raw 16-bit signed little-endian
        '-acodec', 'pcm_s16le',
        '-y',
        tempFile,
      ];

      await executeCommand(this.ffmpegPath, args, {
        timeout: 300000,
      });

      // Read raw PCM data
      const buffer = await fs.readFile(tempFile);
      const samples = new Float32Array(buffer.length / 2);
      
      let peak = 0;
      let sumSquares = 0;

      for (let i = 0; i < samples.length; i++) {
        const sample = buffer.readInt16LE(i * 2) / 32768;
        samples[i] = sample;
        peak = Math.max(peak, Math.abs(sample));
        sumSquares += sample * sample;
      }

      const rms = Math.sqrt(sumSquares / samples.length);

      return {
        sampleRate,
        samples,
        duration: samples.length / sampleRate,
        peak,
        rms,
      };
    } finally {
      // Cleanup temp file
      try {
        await fs.unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Compute cross-correlation between two waveforms
   */
  private crossCorrelate(
    reference: Float32Array,
    target: Float32Array,
    sampleRate: number,
    maxOffsetSec: number
  ): { delayMs: number; confidence: number; graph: Array<{ offsetMs: number; correlation: number }> } {
    const maxOffsetSamples = Math.floor(maxOffsetSec * sampleRate);
    const graph: Array<{ offsetMs: number; correlation: number }> = [];
    
    let bestOffset = 0;
    let bestCorrelation = -Infinity;

    // Normalize waveforms
    const refNorm = this.normalizeWaveform(reference);
    const targetNorm = this.normalizeWaveform(target);

    // Compute cross-correlation at different offsets
    // Negative offset = reference is ahead, positive = reference is behind
    for (let offset = -maxOffsetSamples; offset <= maxOffsetSamples; offset += Math.max(1, Math.floor(sampleRate / 100))) {
      const correlation = this.computeCorrelation(refNorm, targetNorm, offset);
      const offsetMs = (offset / sampleRate) * 1000;
      
      graph.push({ offsetMs, correlation });

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    }

    // Refine search around best offset
    const refinedResult = this.refineOffset(refNorm, targetNorm, bestOffset, sampleRate, 50);
    
    const delayMs = (refinedResult.offset / sampleRate) * 1000;
    
    // Confidence based on correlation strength and uniqueness
    const confidence = this.calculateConfidence(graph, refinedResult.correlation);

    logger.debug({
      delayMs,
      correlation: refinedResult.correlation,
      confidence,
    }, 'Cross-correlation result');

    return {
      delayMs,
      confidence,
      graph,
    };
  }

  /**
   * Refine offset search with sample-level precision
   */
  private refineOffset(
    reference: Float32Array,
    target: Float32Array,
    roughOffset: number,
    sampleRate: number,
    searchRange: number
  ): { offset: number; correlation: number } {
    let bestOffset = roughOffset;
    let bestCorrelation = -Infinity;

    for (let offset = roughOffset - searchRange; offset <= roughOffset + searchRange; offset++) {
      const correlation = this.computeCorrelation(reference, target, offset);
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    }

    return { offset: bestOffset, correlation: bestCorrelation };
  }

  /**
   * Compute normalized cross-correlation at a specific offset
   */
  private computeCorrelation(
    reference: Float32Array,
    target: Float32Array,
    offset: number
  ): number {
    let sum = 0;
    let count = 0;

    const refStart = Math.max(0, -offset);
    const refEnd = Math.min(reference.length, target.length - offset);

    for (let i = refStart; i < refEnd; i++) {
      const targetIdx = i + offset;
      if (targetIdx >= 0 && targetIdx < target.length) {
        sum += (reference[i] ?? 0) * (target[targetIdx] ?? 0);
        count++;
      }
    }

    return count > 0 ? sum / count : 0;
  }

  /**
   * Normalize waveform to zero mean and unit variance
   */
  private normalizeWaveform(samples: Float32Array): Float32Array {
    // Calculate mean
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] ?? 0;
    }
    const mean = sum / samples.length;

    // Calculate standard deviation
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      const diff = (samples[i] ?? 0) - mean;
      sumSquares += diff * diff;
    }
    const std = Math.sqrt(sumSquares / samples.length);

    // Normalize
    const normalized = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      normalized[i] = std > 0 ? ((samples[i] ?? 0) - mean) / std : 0;
    }

    return normalized;
  }

  /**
   * Analyze sync at multiple segments
   */
  private async analyzeSegments(
    refWaveform: WaveformData,
    targetWaveform: WaveformData,
    windowSizeSec: number,
    stepSizeSec: number,
    maxOffsetSec: number
  ): Promise<CrossCorrelationResult['segments']> {
    const segments: CrossCorrelationResult['segments'] = [];
    const windowSamples = Math.floor(windowSizeSec * refWaveform.sampleRate);
    const stepSamples = Math.floor(stepSizeSec * refWaveform.sampleRate);

    const numSegments = Math.floor((refWaveform.samples.length - windowSamples) / stepSamples) + 1;

    for (let i = 0; i < numSegments; i++) {
      const startSample = i * stepSamples;
      const endSample = startSample + windowSamples;

      const refSegment = refWaveform.samples.slice(startSample, endSample);
      const targetSegment = targetWaveform.samples.slice(startSample, endSample);

      const result = this.crossCorrelate(
        refSegment,
        targetSegment,
        refWaveform.sampleRate,
        maxOffsetSec
      );

      segments.push({
        startMs: (startSample / refWaveform.sampleRate) * 1000,
        endMs: (endSample / refWaveform.sampleRate) * 1000,
        delayMs: result.delayMs,
        correlation: result.confidence,
        confidence: result.confidence,
        reason: 'cross_correlation',
      });
    }

    return segments;
  }

  /**
   * Detect drift (progressive offset change over time)
   */
  private detectDrift(
    segments: CrossCorrelationResult['segments']
  ): { hasDrift: boolean; driftRate: number } {
    if (segments.length < 3) {
      return { hasDrift: false, driftRate: 0 };
    }

    // Linear regression on delay vs time
    const n = segments.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (const seg of segments) {
      const x = seg.startMs / 1000; // Time in seconds
      const y = seg.delayMs;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R² to determine if drift is significant
    const yMean = sumY / n;
    let ssTot = 0, ssRes = 0;
    for (const seg of segments) {
      const x = seg.startMs / 1000;
      const y = seg.delayMs;
      const yPred = slope * x + intercept;
      ssTot += (y - yMean) ** 2;
      ssRes += (y - yPred) ** 2;
    }
    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    // Consider drift significant if R² > 0.7 and slope > 0.1 ms/s
    const hasDrift = rSquared > 0.7 && Math.abs(slope) > 0.1;

    return {
      hasDrift,
      driftRate: hasDrift ? slope : 0,
    };
  }

  /**
   * Detect cuts or insertions in the audio
   */
  private detectCuts(
    segments: CrossCorrelationResult['segments'],
    globalDelayMs: number
  ): { hasCuts: boolean; cutPoints: CrossCorrelationResult['cutPoints'] } {
    const cutPoints: CrossCorrelationResult['cutPoints'] = [];
    const threshold = 500; // 500ms difference indicates a cut

    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1]!;
      const curr = segments[i]!;
      const diff = curr.delayMs - prev.delayMs;

      if (Math.abs(diff) > threshold) {
        cutPoints.push({
          timestampMs: curr.startMs,
          type: diff > 0 ? 'cut' : 'insertion',
          durationMs: Math.abs(diff),
        });
      }
    }

    return {
      hasCuts: cutPoints.length > 0,
      cutPoints,
    };
  }

  /**
   * Calculate confidence based on correlation peak distinctiveness
   */
  private calculateConfidence(
    graph: Array<{ offsetMs: number; correlation: number }>,
    peakCorrelation: number
  ): number {
    if (graph.length === 0 || peakCorrelation <= 0) return 0;

    // Sort correlations to find second highest
    const sorted = [...graph].sort((a, b) => b.correlation - a.correlation);
    const secondBest = sorted[1]?.correlation ?? 0;

    // Confidence based on how distinct the peak is
    const distinctiveness = peakCorrelation > 0 
      ? (peakCorrelation - secondBest) / peakCorrelation 
      : 0;

    // Combine with absolute correlation value
    return Math.min(1, (peakCorrelation + distinctiveness) / 2);
  }
}
