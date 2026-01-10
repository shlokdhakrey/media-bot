/**
 * Audio Fingerprint Analyzer
 * 
 * Uses chromaprint/fpcalc for robust audio fingerprinting.
 * Fingerprints are acoustic signatures that can match audio
 * even with different encodings, bitrates, or slight variations.
 * 
 * This is the same technology used by Shazam, AcoustID, etc.
 */

import { executeCommand } from '@media-bot/utils';
import { createLogger } from '@media-bot/utils';

const logger = createLogger({ module: 'fingerprint' });

export interface AudioFingerprint {
  /** Raw fingerprint data */
  fingerprint: number[];
  /** Duration of analyzed audio in seconds */
  duration: number;
  /** Sample rate used for analysis */
  sampleRate: number;
  /** Number of fingerprint chunks */
  chunkCount: number;
}

export interface FingerprintMatch {
  /** Offset in reference audio (ms) */
  referenceOffsetMs: number;
  /** Offset in target audio (ms) */
  targetOffsetMs: number;
  /** Calculated delay (target - reference) */
  delayMs: number;
  /** Match confidence 0-1 */
  confidence: number;
  /** Number of matching chunks */
  matchingChunks: number;
}

export interface FingerprintCompareResult {
  /** Are the audios from the same source? */
  isSameSource: boolean;
  /** Overall similarity score 0-1 */
  similarity: number;
  /** Best matching offset/delay */
  bestMatch: FingerprintMatch | null;
  /** All significant matches found */
  matches: FingerprintMatch[];
  /** Are there structural differences (cuts/insertions)? */
  hasStructuralDifferences: boolean;
  /** Detected segments with different offsets */
  segments: Array<{
    startMs: number;
    endMs: number;
    delayMs: number;
    confidence: number;
  }>;
}

export class AudioFingerprintAnalyzer {
  private fpcalcPath: string;
  private ffmpegPath: string;

  constructor(options: { fpcalcPath?: string; ffmpegPath?: string } = {}) {
    this.fpcalcPath = options.fpcalcPath ?? 'fpcalc';
    this.ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
  }

  /**
   * Generate fingerprint for an audio file
   */
  async generateFingerprint(
    filePath: string,
    options: {
      /** Start time in seconds */
      startSec?: number;
      /** Duration to analyze in seconds (0 = full file) */
      durationSec?: number;
      /** Chunk size for fingerprinting (default: 3 seconds) */
      chunkSizeSec?: number;
    } = {}
  ): Promise<AudioFingerprint> {
    const startSec = options.startSec ?? 0;
    const durationSec = options.durationSec ?? 0;
    const chunkSizeSec = options.chunkSizeSec ?? 3;

    // Build fpcalc arguments
    const args: string[] = ['-raw', '-json'];
    
    if (durationSec > 0) {
      args.push('-length', durationSec.toString());
    }
    
    if (startSec > 0) {
      // Need to use ffmpeg to extract segment first
      const tempPath = await this.extractSegment(filePath, startSec, durationSec || 120);
      args.push(tempPath);
    } else {
      args.push(filePath);
    }

    try {
      const result = await executeCommand(this.fpcalcPath, args, {
        timeout: 120000,
      });

      const data = JSON.parse(result.stdout);
      
      return {
        fingerprint: this.decodeFingerprint(data.fingerprint),
        duration: data.duration,
        sampleRate: 11025, // Chromaprint default
        chunkCount: Math.ceil(data.duration / chunkSizeSec),
      };
    } catch (error) {
      logger.error({ error, filePath }, 'Failed to generate fingerprint');
      throw new Error(`Fingerprint generation failed: ${error}`);
    }
  }

  /**
   * Compare two audio files using fingerprints
   * Returns detailed sync analysis
   */
  async compare(
    referenceFile: string,
    targetFile: string,
    options: {
      /** Window size for sliding comparison (seconds) */
      windowSizeSec?: number;
      /** Step size for sliding window (seconds) */
      stepSizeSec?: number;
      /** Maximum offset to search (seconds) */
      maxOffsetSec?: number;
      /** Minimum confidence to consider a match */
      minConfidence?: number;
    } = {}
  ): Promise<FingerprintCompareResult> {
    const windowSizeSec = options.windowSizeSec ?? 30;
    const stepSizeSec = options.stepSizeSec ?? 10;
    const maxOffsetSec = options.maxOffsetSec ?? 60;
    const minConfidence = options.minConfidence ?? 0.3;

    logger.info({ referenceFile, targetFile, windowSizeSec }, 'Comparing audio fingerprints');

    // Generate full fingerprints for both files
    const [refFp, targetFp] = await Promise.all([
      this.generateFingerprint(referenceFile),
      this.generateFingerprint(targetFile),
    ]);

    // Calculate similarity using cross-correlation of fingerprints
    const matches = this.crossCorrelateFingerprints(
      refFp.fingerprint,
      targetFp.fingerprint,
      maxOffsetSec * (11025 / 4096), // Convert to fingerprint frame offset
      minConfidence
    );

    // Analyze for structural differences by comparing segments
    const segments = await this.analyzeSegments(
      referenceFile,
      targetFile,
      windowSizeSec,
      stepSizeSec
    );

    // Determine if same source based on overall similarity
    const overallSimilarity = this.calculateOverallSimilarity(refFp.fingerprint, targetFp.fingerprint);
    const hasStructuralDifferences = this.detectStructuralDifferences(segments);

    const bestMatch = matches.length > 0 
      ? matches.reduce((best, m) => m.confidence > best.confidence ? m : best)
      : null;

    return {
      isSameSource: overallSimilarity > 0.6,
      similarity: overallSimilarity,
      bestMatch,
      matches,
      hasStructuralDifferences,
      segments,
    };
  }

  /**
   * Cross-correlate two fingerprint arrays to find best alignment
   */
  private crossCorrelateFingerprints(
    ref: number[],
    target: number[],
    maxOffsetFrames: number,
    minConfidence: number
  ): FingerprintMatch[] {
    const matches: FingerprintMatch[] = [];
    const frameToMs = 4096 / 11025 * 1000; // ~371.5ms per frame

    // Slide target over reference
    for (let offset = -maxOffsetFrames; offset <= maxOffsetFrames; offset++) {
      let matchCount = 0;
      let compareCount = 0;

      for (let i = 0; i < ref.length; i++) {
        const targetIdx = i + offset;
        if (targetIdx >= 0 && targetIdx < target.length) {
          compareCount++;
          // Fingerprint matching using XOR and popcount
          const xor = (ref[i] ?? 0) ^ (target[targetIdx] ?? 0);
          const hammingDistance = this.popcount(xor);
          // Chromaprint fingerprints are 32-bit, so max distance is 32
          if (hammingDistance < 10) {
            matchCount++;
          }
        }
      }

      if (compareCount > 0) {
        const confidence = matchCount / compareCount;
        if (confidence >= minConfidence) {
          matches.push({
            referenceOffsetMs: offset > 0 ? offset * frameToMs : 0,
            targetOffsetMs: offset < 0 ? Math.abs(offset) * frameToMs : 0,
            delayMs: offset * frameToMs,
            confidence,
            matchingChunks: matchCount,
          });
        }
      }
    }

    // Sort by confidence
    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Analyze segments of the audio files to detect cuts/drift
   */
  private async analyzeSegments(
    referenceFile: string,
    targetFile: string,
    windowSizeSec: number,
    stepSizeSec: number
  ): Promise<Array<{ startMs: number; endMs: number; delayMs: number; confidence: number }>> {
    const segments: Array<{ startMs: number; endMs: number; delayMs: number; confidence: number }> = [];
    
    // Get file durations
    const refDuration = await this.getAudioDuration(referenceFile);
    const numSegments = Math.floor((refDuration - windowSizeSec) / stepSizeSec) + 1;

    for (let i = 0; i < numSegments; i++) {
      const startSec = i * stepSizeSec;
      const endSec = startSec + windowSizeSec;

      try {
        // Generate fingerprints for this segment
        const [refSegFp, targetSegFp] = await Promise.all([
          this.generateFingerprint(referenceFile, { startSec, durationSec: windowSizeSec }),
          this.generateFingerprint(targetFile, { startSec, durationSec: windowSizeSec }),
        ]);

        // Find best match for this segment
        const segmentMatches = this.crossCorrelateFingerprints(
          refSegFp.fingerprint,
          targetSegFp.fingerprint,
          30, // Search ±30 frames (~11 seconds)
          0.2
        );

        if (segmentMatches.length > 0) {
          const bestMatch = segmentMatches[0]!;
          segments.push({
            startMs: startSec * 1000,
            endMs: endSec * 1000,
            delayMs: bestMatch.delayMs,
            confidence: bestMatch.confidence,
          });
        }
      } catch (error) {
        logger.warn({ error, startSec }, 'Failed to analyze segment');
      }
    }

    return segments;
  }

  /**
   * Detect if there are structural differences (cuts, insertions)
   */
  private detectStructuralDifferences(
    segments: Array<{ startMs: number; endMs: number; delayMs: number; confidence: number }>
  ): boolean {
    if (segments.length < 2) return false;

    // Calculate delay variance
    const delays = segments.map(s => s.delayMs);
    const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
    const variance = delays.reduce((sum, d) => sum + Math.pow(d - avgDelay, 2), 0) / delays.length;
    const stdDev = Math.sqrt(variance);

    // If standard deviation is > 100ms, there are likely structural differences
    return stdDev > 100;
  }

  /**
   * Calculate overall similarity between two fingerprint arrays
   */
  private calculateOverallSimilarity(fp1: number[], fp2: number[]): number {
    const minLen = Math.min(fp1.length, fp2.length);
    if (minLen === 0) return 0;

    let matchBits = 0;
    let totalBits = 0;

    for (let i = 0; i < minLen; i++) {
      const xor = (fp1[i] ?? 0) ^ (fp2[i] ?? 0);
      const diffBits = this.popcount(xor);
      matchBits += 32 - diffBits;
      totalBits += 32;
    }

    return matchBits / totalBits;
  }

  /**
   * Count number of set bits (population count)
   */
  private popcount(n: number): number {
    n = n - ((n >> 1) & 0x55555555);
    n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
    n = (n + (n >> 4)) & 0x0f0f0f0f;
    n = n + (n >> 8);
    n = n + (n >> 16);
    return n & 0x3f;
  }

  /**
   * Decode base64 fingerprint to number array
   */
  private decodeFingerprint(encoded: string): number[] {
    const buffer = Buffer.from(encoded, 'base64');
    const result: number[] = [];
    
    for (let i = 0; i < buffer.length; i += 4) {
      result.push(buffer.readUInt32LE(i));
    }
    
    return result;
  }

  /**
   * Extract a segment of audio to a temp file
   */
  private async extractSegment(
    filePath: string,
    startSec: number,
    durationSec: number
  ): Promise<string> {
    const tempPath = `/tmp/segment_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`;
    
    await executeCommand(this.ffmpegPath, [
      '-i', filePath,
      '-ss', startSec.toString(),
      '-t', durationSec.toString(),
      '-ar', '11025',
      '-ac', '1',
      '-y',
      tempPath,
    ], { timeout: 60000 });

    return tempPath;
  }

  /**
   * Get audio duration in seconds
   */
  private async getAudioDuration(filePath: string): Promise<number> {
    const result = await executeCommand(this.ffmpegPath, [
      '-i', filePath,
      '-f', 'null',
      '-',
    ], { timeout: 60000 });

    const match = result.stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (match) {
      const hours = parseInt(match[1] ?? '0', 10);
      const minutes = parseInt(match[2] ?? '0', 10);
      const seconds = parseFloat(match[3] ?? '0');
      return hours * 3600 + minutes * 60 + seconds;
    }

    throw new Error('Could not determine audio duration');
  }
}
