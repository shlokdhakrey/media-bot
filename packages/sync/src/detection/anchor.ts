/**
 * Anchor Detection
 * 
 * Finds anchor points (audio peaks, transitions, silence boundaries)
 * that can be matched between video and audio for sync verification.
 * 
 * Uses multiple detection methods:
 * - Peak/transient detection for sudden amplitude changes
 * - Silence boundary detection for content boundaries
 * - Cross-correlation for precise alignment
 * - Audio fingerprinting for source verification
 */

import { createLogger } from '@media-bot/utils';
import { PeakDetector, type AudioPeak, type PeakDetectionResult, type PeakMatchResult } from './peakDetector.js';
import { CrossCorrelationEngine, type CrossCorrelationResult } from './crossCorrelation.js';
import { SilenceDetector, type SilenceResult } from './silence.js';
import { AudioSyncAnalyzer, type SyncAnalysisResult } from './syncAnalyzer.js';

const logger = createLogger({ module: 'anchor-detector' });

export interface AnchorPoint {
  /** Timestamp in milliseconds */
  timestampMs: number;
  /** Type of anchor point */
  type: 'peak' | 'silence' | 'transition' | 'transient';
  /** Amplitude (0-1) for peaks */
  amplitude: number;
  /** Confidence in this anchor point */
  confidence: number;
  /** Additional metadata */
  metadata?: {
    durationMs?: number;
    description?: string;
  };
}

export interface AnchorResult {
  /** Detected anchor points */
  anchors: AnchorPoint[];
  /** Total duration analyzed (ms) */
  analyzedDurationMs: number;
  /** Peak amplitude in file */
  peakAmplitude: number;
  /** Average amplitude */
  averageAmplitude: number;
  /** Silence regions detected */
  silenceRegions: Array<{ startMs: number; endMs: number }>;
}

export interface AnchorMatchResult {
  /** Matched anchor pairs */
  matches: Array<{
    source: AnchorPoint;
    target: AnchorPoint;
    offsetMs: number;
    confidence: number;
  }>;
  /** Global offset detected (ms) */
  globalOffsetMs: number;
  /** Confidence in the global offset */
  confidence: number;
  /** Are there structural differences? */
  hasStructuralDifferences: boolean;
  /** Segments with different offsets */
  segments: Array<{
    startMs: number;
    endMs: number;
    offsetMs: number;
    confidence: number;
  }>;
  /** Full sync analysis result */
  fullAnalysis?: SyncAnalysisResult;
}

export interface AnchorDetectorOptions {
  /** FFmpeg path */
  ffmpegPath?: string;
  /** fpcalc path for fingerprinting */
  fpcalcPath?: string;
  /** Minimum peak amplitude to consider (0-1) */
  minPeakAmplitude?: number;
  /** Transient detection sensitivity (0-1) */
  sensitivity?: number;
  /** Maximum offset to search (seconds) */
  maxOffsetSec?: number;
  /** Enable deep analysis mode */
  deepAnalysis?: boolean;
}

export class AnchorDetector {
  private peakDetector: PeakDetector;
  private silenceDetector: SilenceDetector;
  private crossCorrelation: CrossCorrelationEngine;
  private syncAnalyzer: AudioSyncAnalyzer;
  private options: Required<AnchorDetectorOptions>;

  constructor(options: AnchorDetectorOptions = {}) {
    const ffmpegPath = options.ffmpegPath ?? 'ffmpeg';

    this.options = {
      ffmpegPath,
      fpcalcPath: options.fpcalcPath ?? 'fpcalc',
      minPeakAmplitude: options.minPeakAmplitude ?? 0.1,
      sensitivity: options.sensitivity ?? 0.5,
      maxOffsetSec: options.maxOffsetSec ?? 30,
      deepAnalysis: options.deepAnalysis ?? false,
    };

    this.peakDetector = new PeakDetector({ ffmpegPath });
    this.silenceDetector = new SilenceDetector(ffmpegPath);
    this.crossCorrelation = new CrossCorrelationEngine({ ffmpegPath });
    this.syncAnalyzer = new AudioSyncAnalyzer({
      ffmpegPath,
      fpcalcPath: this.options.fpcalcPath,
      maxOffsetSec: this.options.maxOffsetSec,
      deepAnalysis: this.options.deepAnalysis,
    });
  }

  /**
   * Find anchor points in an audio file
   * These can be matched against video audio for sync verification
   */
  async findAnchors(filePath: string): Promise<AnchorResult> {
    logger.info({ filePath }, 'Finding anchor points');

    // Run peak and silence detection in parallel
    const [peakResult, silenceResult] = await Promise.all([
      this.peakDetector.detect(filePath, {
        minAmplitude: this.options.minPeakAmplitude,
        sensitivity: this.options.sensitivity,
      }),
      this.silenceDetector.detect(filePath),
    ]);

    // Convert peaks to anchor points
    const anchors: AnchorPoint[] = [];

    // Add peak anchors
    for (const peak of peakResult.peaks) {
      anchors.push({
        timestampMs: peak.timestampMs,
        type: peak.type === 'transient' ? 'transient' : 'peak',
        amplitude: peak.amplitude,
        confidence: peak.confidence,
        metadata: {
          durationMs: peak.durationMs,
        },
      });
    }

    // Add silence boundary anchors
    const silenceRegions: Array<{ startMs: number; endMs: number }> = [];
    for (const region of silenceResult.regions) {
      silenceRegions.push({
        startMs: region.startMs,
        endMs: region.endMs,
      });

      // Silence start is an anchor
      if (region.startMs > 0) {
        anchors.push({
          timestampMs: region.startMs,
          type: 'silence',
          amplitude: 0,
          confidence: 0.9,
          metadata: {
            durationMs: region.durationMs,
            description: 'silence_start',
          },
        });
      }

      // Silence end is an anchor
      anchors.push({
        timestampMs: region.endMs,
        type: 'transition',
        amplitude: 0.5,
        confidence: 0.9,
        metadata: {
          description: 'silence_end',
        },
      });
    }

    // Sort by timestamp
    anchors.sort((a, b) => a.timestampMs - b.timestampMs);

    logger.debug({
      anchorCount: anchors.length,
      peakCount: peakResult.peaks.length,
      silenceRegionCount: silenceRegions.length,
    }, 'Anchor detection complete');

    return {
      anchors,
      analyzedDurationMs: peakResult.durationMs,
      peakAmplitude: peakResult.peakAmplitude,
      averageAmplitude: peakResult.averageAmplitude,
      silenceRegions,
    };
  }

  /**
   * Match anchor points between two audio tracks
   * This is the main entry point for sync analysis
   */
  async matchAnchors(
    sourceFile: string,
    targetFile: string,
    options: {
      /** Use anchors from pre-computed results */
      sourceAnchors?: AnchorPoint[];
      targetAnchors?: AnchorPoint[];
      /** Run full sync analysis */
      fullAnalysis?: boolean;
    } = {}
  ): Promise<AnchorMatchResult> {
    logger.info({ sourceFile, targetFile }, 'Matching anchors between audio files');

    // Get anchors if not provided
    const sourceAnchors = options.sourceAnchors ?? (await this.findAnchors(sourceFile)).anchors;
    const targetAnchors = options.targetAnchors ?? (await this.findAnchors(targetFile)).anchors;

    // Convert to peak format for peak detector
    const sourcePeaks: AudioPeak[] = sourceAnchors.map(a => ({
      timestampMs: a.timestampMs,
      amplitude: a.amplitude,
      durationMs: a.metadata?.durationMs ?? 0,
      type: a.type === 'peak' ? 'transient' : a.type as 'transient' | 'sustained' | 'silence_break',
      confidence: a.confidence,
    }));

    const targetPeaks: AudioPeak[] = targetAnchors.map(a => ({
      timestampMs: a.timestampMs,
      amplitude: a.amplitude,
      durationMs: a.metadata?.durationMs ?? 0,
      type: a.type === 'peak' ? 'transient' : a.type as 'transient' | 'sustained' | 'silence_break',
      confidence: a.confidence,
    }));

    // Match peaks
    const peakMatchResult = await this.peakDetector.matchPeaks(sourcePeaks, targetPeaks, {
      maxOffsetMs: this.options.maxOffsetSec * 1000,
    });

    // Run full sync analysis if requested
    let fullAnalysis: SyncAnalysisResult | undefined;
    if (options.fullAnalysis !== false) {
      try {
        fullAnalysis = await this.syncAnalyzer.analyze(sourceFile, targetFile);
      } catch (error) {
        logger.warn({ error }, 'Full sync analysis failed');
      }
    }

    // Combine results
    const matches = peakMatchResult.matches.map(m => ({
      source: {
        timestampMs: m.referencePeak.timestampMs,
        type: 'peak' as const,
        amplitude: m.referencePeak.amplitude,
        confidence: m.referencePeak.confidence,
      },
      target: {
        timestampMs: m.targetPeak.timestampMs,
        type: 'peak' as const,
        amplitude: m.targetPeak.amplitude,
        confidence: m.targetPeak.confidence,
      },
      offsetMs: m.offsetMs,
      confidence: m.confidence,
    }));

    // Use full analysis result if available, otherwise use peak matching
    const globalOffsetMs = fullAnalysis?.globalDelayMs ?? peakMatchResult.averageOffsetMs;
    const confidence = fullAnalysis?.confidence ?? peakMatchResult.confidence;
    const hasStructuralDifferences = fullAnalysis?.hasStructuralDifferences ?? false;

    const segments = (fullAnalysis?.segments ?? peakMatchResult.segments).map(s => ({
      startMs: s.startMs,
      endMs: s.endMs,
      offsetMs: 'delayMs' in s ? s.delayMs : s.offsetMs,
      confidence: 'confidence' in s ? s.confidence : (s as { matchCount?: number }).matchCount ? 0.8 : 0.5,
    }));

    logger.info({
      matchCount: matches.length,
      globalOffsetMs,
      confidence,
      hasStructuralDifferences,
    }, 'Anchor matching complete');

    return {
      matches,
      globalOffsetMs,
      confidence,
      hasStructuralDifferences,
      segments,
      fullAnalysis,
    };
  }

  /**
   * Quick sync check - faster than full analysis
   * Suitable for preliminary checks
   */
  async quickSyncCheck(
    sourceFile: string,
    targetFile: string
  ): Promise<{
    isInSync: boolean;
    offsetMs: number;
    confidence: number;
    needsDetailedAnalysis: boolean;
  }> {
    try {
      const result = await this.crossCorrelation.analyze(sourceFile, targetFile, {
        maxOffsetSec: this.options.maxOffsetSec,
        windowSizeSec: 15,
        stepSizeSec: 10,
      });

      const isInSync = Math.abs(result.globalDelayMs) < 50 && result.globalConfidence > 0.7;
      const needsDetailedAnalysis = result.hasCuts || result.hasDrift || result.globalConfidence < 0.6;

      return {
        isInSync,
        offsetMs: result.globalDelayMs,
        confidence: result.globalConfidence,
        needsDetailedAnalysis,
      };
    } catch (error) {
      logger.error({ error }, 'Quick sync check failed');
      return {
        isInSync: false,
        offsetMs: 0,
        confidence: 0,
        needsDetailedAnalysis: true,
      };
    }
  }
}

// Re-export types
export type { 
  PeakDetectionResult, 
  PeakMatchResult, 
  AudioPeak 
} from './peakDetector.js';

export type { 
  CrossCorrelationResult 
} from './crossCorrelation.js';

export type { 
  SyncAnalysisResult 
} from './syncAnalyzer.js';

