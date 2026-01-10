/**
 * Peak/Transient Detector
 * 
 * Detects audio peaks and transients (sudden changes in amplitude).
 * These serve as anchor points for sync alignment, similar to
 * how you'd visually align waveforms in Audacity.
 * 
 * Transients are typically:
 * - Drum hits
 * - Dialogue onset
 * - Sound effects
 * - Any sudden amplitude change
 */

import { executeCommand } from '@media-bot/utils';
import { createLogger } from '@media-bot/utils';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const logger = createLogger({ module: 'peak-detector' });

export interface AudioPeak {
  /** Timestamp in milliseconds */
  timestampMs: number;
  /** Amplitude (0-1) */
  amplitude: number;
  /** Duration of the peak in milliseconds */
  durationMs: number;
  /** Type of peak */
  type: 'transient' | 'sustained' | 'silence_break';
  /** Confidence in this detection */
  confidence: number;
}

export interface PeakDetectionResult {
  /** All detected peaks */
  peaks: AudioPeak[];
  /** Duration of analyzed audio in ms */
  durationMs: number;
  /** Average amplitude */
  averageAmplitude: number;
  /** Peak amplitude */
  peakAmplitude: number;
  /** Number of transients per minute */
  transientsPerMinute: number;
}

export interface PeakMatchResult {
  /** Matched peaks between reference and target */
  matches: Array<{
    referencePeak: AudioPeak;
    targetPeak: AudioPeak;
    offsetMs: number;
    confidence: number;
  }>;
  /** Average offset across all matches */
  averageOffsetMs: number;
  /** Standard deviation of offsets */
  offsetStdDev: number;
  /** Overall match confidence */
  confidence: number;
  /** Segments with consistent offsets */
  segments: Array<{
    startMs: number;
    endMs: number;
    offsetMs: number;
    matchCount: number;
  }>;
}

export class PeakDetector {
  private ffmpegPath: string;
  private tempDir: string;

  constructor(options: { ffmpegPath?: string; tempDir?: string } = {}) {
    this.ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    this.tempDir = options.tempDir ?? os.tmpdir();
  }

  /**
   * Detect peaks and transients in an audio file
   */
  async detect(
    filePath: string,
    options: {
      /** Minimum peak amplitude (0-1) */
      minAmplitude?: number;
      /** Minimum time between peaks (ms) */
      minPeakDistanceMs?: number;
      /** Transient detection sensitivity (0-1) */
      sensitivity?: number;
      /** Analyze only a segment */
      startMs?: number;
      endMs?: number;
    } = {}
  ): Promise<PeakDetectionResult> {
    const minAmplitude = options.minAmplitude ?? 0.1;
    const minPeakDistanceMs = options.minPeakDistanceMs ?? 50;
    const sensitivity = options.sensitivity ?? 0.5;

    logger.info({ filePath, minAmplitude, sensitivity }, 'Detecting peaks');

    // Extract audio envelope using FFmpeg
    const envelope = await this.extractEnvelope(filePath, options.startMs, options.endMs);
    
    // Detect peaks in the envelope
    const peaks = this.findPeaks(envelope, minAmplitude, minPeakDistanceMs, sensitivity);
    
    // Calculate statistics
    const averageAmplitude = envelope.samples.reduce((a, b) => a + b, 0) / envelope.samples.length;
    const peakAmplitude = Math.max(...envelope.samples);
    const durationSec = envelope.samples.length / envelope.sampleRate;
    const transientsPerMinute = (peaks.filter(p => p.type === 'transient').length / durationSec) * 60;

    logger.debug({
      peakCount: peaks.length,
      durationSec,
      transientsPerMinute,
    }, 'Peak detection complete');

    return {
      peaks,
      durationMs: durationSec * 1000,
      averageAmplitude,
      peakAmplitude,
      transientsPerMinute,
    };
  }

  /**
   * Match peaks between reference and target audio
   */
  async matchPeaks(
    referencePeaks: AudioPeak[],
    targetPeaks: AudioPeak[],
    options: {
      /** Maximum offset to search (ms) */
      maxOffsetMs?: number;
      /** Window for considering peaks as potential matches (ms) */
      matchWindowMs?: number;
      /** Minimum matches required for confidence */
      minMatches?: number;
    } = {}
  ): Promise<PeakMatchResult> {
    const maxOffsetMs = options.maxOffsetMs ?? 30000;
    const matchWindowMs = options.matchWindowMs ?? 100;
    const minMatches = options.minMatches ?? 5;

    logger.info({
      refPeakCount: referencePeaks.length,
      targetPeakCount: targetPeaks.length,
      maxOffsetMs,
    }, 'Matching peaks');

    // Try different offsets and count matches
    const offsetScores: Map<number, Array<{ ref: AudioPeak; target: AudioPeak }>> = new Map();

    // Use histogram approach for efficiency
    for (const refPeak of referencePeaks) {
      for (const targetPeak of targetPeaks) {
        const offset = targetPeak.timestampMs - refPeak.timestampMs;
        
        if (Math.abs(offset) <= maxOffsetMs) {
          // Quantize offset to nearest 10ms for histogram
          const quantizedOffset = Math.round(offset / 10) * 10;
          
          if (!offsetScores.has(quantizedOffset)) {
            offsetScores.set(quantizedOffset, []);
          }
          offsetScores.get(quantizedOffset)!.push({ ref: refPeak, target: targetPeak });
        }
      }
    }

    // Find best offset cluster
    let bestOffset = 0;
    let bestMatches: Array<{ ref: AudioPeak; target: AudioPeak }> = [];

    for (const [offset, matches] of offsetScores) {
      // Count matches within window of this offset
      let clusterMatches = matches;
      
      // Add matches from nearby offsets
      for (const [otherOffset, otherMatches] of offsetScores) {
        if (otherOffset !== offset && Math.abs(otherOffset - offset) <= matchWindowMs) {
          clusterMatches = [...clusterMatches, ...otherMatches];
        }
      }

      if (clusterMatches.length > bestMatches.length) {
        bestMatches = clusterMatches;
        bestOffset = offset;
      }
    }

    // Refine matches - remove duplicates and low-confidence pairs
    const refinedMatches = this.refineMatches(bestMatches, matchWindowMs);

    // Calculate statistics
    const offsets = refinedMatches.map(m => m.targetPeak.timestampMs - m.referencePeak.timestampMs);
    const averageOffsetMs = offsets.length > 0 
      ? offsets.reduce((a, b) => a + b, 0) / offsets.length 
      : 0;
    
    const variance = offsets.length > 0
      ? offsets.reduce((sum, o) => sum + (o - averageOffsetMs) ** 2, 0) / offsets.length
      : 0;
    const offsetStdDev = Math.sqrt(variance);

    // Group matches into segments
    const segments = this.groupMatchesIntoSegments(refinedMatches);

    // Calculate overall confidence
    const confidence = this.calculateMatchConfidence(
      refinedMatches,
      referencePeaks,
      targetPeaks,
      offsetStdDev,
      minMatches
    );

    return {
      matches: refinedMatches,
      averageOffsetMs,
      offsetStdDev,
      confidence,
      segments,
    };
  }

  /**
   * Extract amplitude envelope using FFmpeg
   */
  private async extractEnvelope(
    filePath: string,
    startMs?: number,
    endMs?: number
  ): Promise<{ samples: number[]; sampleRate: number }> {
    const tempFile = path.join(this.tempDir, `envelope_${Date.now()}_${Math.random().toString(36).slice(2)}.raw`);
    const sampleRate = 100; // 100 samples per second for envelope

    try {
      // Build FFmpeg command for envelope extraction
      const args = [
        '-i', filePath,
        '-vn',
      ];

      // Add time range if specified
      if (startMs !== undefined) {
        args.push('-ss', (startMs / 1000).toString());
      }
      if (endMs !== undefined) {
        args.push('-t', ((endMs - (startMs ?? 0)) / 1000).toString());
      }

      // Audio processing: mono, get envelope, resample
      args.push(
        '-af', `aformat=sample_fmts=flt:channel_layouts=mono,asetnsamples=${Math.floor(48000 / sampleRate)}:p=0`,
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        '-ar', (sampleRate * 10).toString(), // Oversample then we'll compute RMS
        '-y',
        tempFile
      );

      await executeCommand(this.ffmpegPath, args, {
        timeout: 300000,
      });

      // Read and process the raw audio
      const buffer = await fs.readFile(tempFile);
      const samples: number[] = [];
      const windowSize = 10; // 10 samples per envelope point

      for (let i = 0; i < buffer.length / 2; i += windowSize) {
        let sumSquares = 0;
        let count = 0;

        for (let j = 0; j < windowSize && (i + j) * 2 + 1 < buffer.length; j++) {
          const sample = buffer.readInt16LE((i + j) * 2) / 32768;
          sumSquares += sample * sample;
          count++;
        }

        if (count > 0) {
          samples.push(Math.sqrt(sumSquares / count));
        }
      }

      return { samples, sampleRate };
    } finally {
      try {
        await fs.unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Find peaks in the amplitude envelope
   */
  private findPeaks(
    envelope: { samples: number[]; sampleRate: number },
    minAmplitude: number,
    minDistanceMs: number,
    sensitivity: number
  ): AudioPeak[] {
    const peaks: AudioPeak[] = [];
    const { samples, sampleRate } = envelope;
    const minDistanceSamples = Math.floor((minDistanceMs / 1000) * sampleRate);

    // Adaptive threshold based on local statistics
    const windowSize = Math.floor(sampleRate * 2); // 2 second window

    for (let i = 1; i < samples.length - 1; i++) {
      const current = samples[i] ?? 0;
      const prev = samples[i - 1] ?? 0;
      const next = samples[i + 1] ?? 0;

      // Basic peak condition
      if (current <= prev || current <= next) continue;
      if (current < minAmplitude) continue;

      // Calculate local statistics
      const windowStart = Math.max(0, i - windowSize);
      const windowEnd = Math.min(samples.length, i + windowSize);
      const localSamples = samples.slice(windowStart, windowEnd);
      const localMean = localSamples.reduce((a, b) => a + b, 0) / localSamples.length;
      const localStd = Math.sqrt(
        localSamples.reduce((sum, s) => sum + (s - localMean) ** 2, 0) / localSamples.length
      );

      // Adaptive threshold
      const threshold = localMean + (localStd * (2 - sensitivity));
      if (current < threshold) continue;

      // Check minimum distance from last peak
      const lastPeak = peaks[peaks.length - 1];
      const timestampMs = (i / sampleRate) * 1000;
      
      if (lastPeak && timestampMs - lastPeak.timestampMs < minDistanceMs) {
        // Keep the higher peak
        if (current > lastPeak.amplitude) {
          peaks.pop();
        } else {
          continue;
        }
      }

      // Determine peak type
      const rise = current - prev;
      const fall = current - next;
      const type = rise > current * 0.3 ? 'transient' 
        : prev < minAmplitude ? 'silence_break'
        : 'sustained';

      // Calculate duration (time above threshold)
      let duration = 0;
      for (let j = i; j < samples.length && (samples[j] ?? 0) > threshold * 0.5; j++) {
        duration++;
      }
      const durationMs = (duration / sampleRate) * 1000;

      // Confidence based on how prominent the peak is
      const prominence = (current - localMean) / (localStd + 0.001);
      const confidence = Math.min(1, prominence / 3);

      peaks.push({
        timestampMs,
        amplitude: current,
        durationMs,
        type,
        confidence,
      });
    }

    return peaks;
  }

  /**
   * Refine matches by removing duplicates and conflicts
   */
  private refineMatches(
    matches: Array<{ ref: AudioPeak; target: AudioPeak }>,
    windowMs: number
  ): PeakMatchResult['matches'] {
    // Remove duplicates (same ref or target peak)
    const usedRefs = new Set<number>();
    const usedTargets = new Set<number>();
    const refined: PeakMatchResult['matches'] = [];

    // Sort by combined confidence
    const sorted = [...matches].sort((a, b) => {
      const confA = (a.ref.confidence + a.target.confidence) / 2;
      const confB = (b.ref.confidence + b.target.confidence) / 2;
      return confB - confA;
    });

    for (const match of sorted) {
      const refKey = Math.round(match.ref.timestampMs);
      const targetKey = Math.round(match.target.timestampMs);

      // Check if already used (with some tolerance)
      let refUsed = false;
      let targetUsed = false;
      
      for (const used of usedRefs) {
        if (Math.abs(used - refKey) < windowMs) {
          refUsed = true;
          break;
        }
      }
      
      for (const used of usedTargets) {
        if (Math.abs(used - targetKey) < windowMs) {
          targetUsed = true;
          break;
        }
      }

      if (!refUsed && !targetUsed) {
        usedRefs.add(refKey);
        usedTargets.add(targetKey);
        
        const offsetMs = match.target.timestampMs - match.ref.timestampMs;
        const confidence = (match.ref.confidence + match.target.confidence) / 2;
        
        refined.push({
          referencePeak: match.ref,
          targetPeak: match.target,
          offsetMs,
          confidence,
        });
      }
    }

    return refined;
  }

  /**
   * Group matches into time segments with consistent offsets
   */
  private groupMatchesIntoSegments(
    matches: PeakMatchResult['matches']
  ): PeakMatchResult['segments'] {
    if (matches.length === 0) return [];

    // Sort by reference timestamp
    const sorted = [...matches].sort((a, b) => 
      a.referencePeak.timestampMs - b.referencePeak.timestampMs
    );

    const segments: PeakMatchResult['segments'] = [];
    let segmentStart = sorted[0]!.referencePeak.timestampMs;
    let segmentMatches: typeof matches = [sorted[0]!];
    const maxOffsetDiff = 200; // 200ms tolerance for same segment

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i]!;
      const prev = sorted[i - 1]!;
      const offsetDiff = Math.abs(current.offsetMs - prev.offsetMs);

      if (offsetDiff > maxOffsetDiff) {
        // New segment
        const avgOffset = segmentMatches.reduce((sum, m) => sum + m.offsetMs, 0) / segmentMatches.length;
        segments.push({
          startMs: segmentStart,
          endMs: prev.referencePeak.timestampMs,
          offsetMs: avgOffset,
          matchCount: segmentMatches.length,
        });

        segmentStart = current.referencePeak.timestampMs;
        segmentMatches = [current];
      } else {
        segmentMatches.push(current);
      }
    }

    // Final segment
    if (segmentMatches.length > 0) {
      const avgOffset = segmentMatches.reduce((sum, m) => sum + m.offsetMs, 0) / segmentMatches.length;
      const last = sorted[sorted.length - 1]!;
      segments.push({
        startMs: segmentStart,
        endMs: last.referencePeak.timestampMs,
        offsetMs: avgOffset,
        matchCount: segmentMatches.length,
      });
    }

    return segments;
  }

  /**
   * Calculate overall match confidence
   */
  private calculateMatchConfidence(
    matches: PeakMatchResult['matches'],
    referencePeaks: AudioPeak[],
    targetPeaks: AudioPeak[],
    offsetStdDev: number,
    minMatches: number
  ): number {
    if (matches.length < minMatches) {
      return matches.length / minMatches * 0.5;
    }

    // Factor 1: Match ratio
    const matchRatio = matches.length / Math.min(referencePeaks.length, targetPeaks.length);
    
    // Factor 2: Offset consistency (lower std dev = higher confidence)
    const offsetConsistency = Math.max(0, 1 - offsetStdDev / 500);
    
    // Factor 3: Average match confidence
    const avgMatchConfidence = matches.reduce((sum, m) => sum + m.confidence, 0) / matches.length;

    return (matchRatio * 0.3 + offsetConsistency * 0.4 + avgMatchConfidence * 0.3);
  }
}
