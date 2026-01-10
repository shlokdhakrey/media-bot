/**
 * Audio Sync Analyzer
 * 
 * The main orchestrator for professional audio sync detection.
 * Combines multiple detection methods for robust results:
 * 
 * 1. Cross-correlation - Precise offset detection
 * 2. Peak matching - Anchor point alignment
 * 3. Fingerprinting - Source verification and segment matching
 * 4. Spectral analysis - Frequency-based comparison
 * 
 * This produces analysis similar to what you see in professional
 * audio tools like Audacity, iZotope RX, or Nuendo.
 */

import { createLogger } from '@media-bot/utils';
import { executeCommand } from '@media-bot/utils';
import { CrossCorrelationEngine, type CrossCorrelationResult } from './crossCorrelation.js';
import { PeakDetector, type PeakDetectionResult, type PeakMatchResult } from './peakDetector.js';
import { AudioFingerprintAnalyzer, type FingerprintCompareResult } from './fingerprint.js';
import { SilenceDetector, type SilenceResult } from './silence.js';
import * as path from 'path';
import * as os from 'os';

const logger = createLogger({ module: 'sync-analyzer' });

export interface SyncSegment {
  /** Segment start time in reference audio (ms) */
  startMs: number;
  /** Segment end time in reference audio (ms) */
  endMs: number;
  /** Detected delay for this segment (ms) */
  delayMs: number;
  /** Confidence in this segment's analysis */
  confidence: number;
  /** How this segment was detected */
  detectionMethod: 'cross_correlation' | 'peak_match' | 'fingerprint' | 'silence';
}

export interface SyncEvent {
  /** Timestamp in reference audio */
  timestampMs: number;
  /** Type of event */
  type: 'anchor_match' | 'cut' | 'insertion' | 'drift_change' | 'silence_boundary';
  /** Additional info about the event */
  description: string;
  /** Confidence */
  confidence: number;
}

export interface StructuralDifference {
  /** Where the difference starts in reference */
  referenceStartMs: number;
  /** Where it ends in reference */
  referenceEndMs: number;
  /** Where it starts in target */
  targetStartMs: number;
  /** Where it ends in target */
  targetEndMs: number;
  /** Type of difference */
  type: 'cut' | 'insertion' | 'replacement';
  /** Approximate duration of difference */
  durationMs: number;
}

export interface SyncAnalysisResult {
  /** Overall sync status */
  status: 'in_sync' | 'offset' | 'drift' | 'cuts' | 'unsyncable';
  
  /** Global delay to apply (ms) - positive means target is behind */
  globalDelayMs: number;
  
  /** Confidence in the global delay */
  confidence: number;
  
  /** Are the audios from the same source? */
  isSameSource: boolean;
  
  /** Similarity between the two audios (0-1) */
  similarity: number;
  
  /** Is there drift (progressive offset change)? */
  hasDrift: boolean;
  
  /** Drift rate (ms per second) */
  driftRate: number;
  
  /** Are there structural differences (cuts/insertions)? */
  hasStructuralDifferences: boolean;
  
  /** Detailed structural differences */
  structuralDifferences: StructuralDifference[];
  
  /** Per-segment analysis */
  segments: SyncSegment[];
  
  /** Detected events (anchor points, cuts, etc.) */
  events: SyncEvent[];
  
  /** Correction recommendation */
  correction: {
    type: 'delay' | 'stretch' | 'segment_repair' | 'none' | 'manual';
    parameters: {
      delayMs?: number;
      tempoFactor?: number;
      segmentCorrections?: Array<{
        startMs: number;
        endMs: number;
        delayMs: number;
      }>;
    };
    isSafe: boolean;
    warnings: string[];
  };
  
  /** Raw analysis data for visualization */
  rawData: {
    correlationGraph?: Array<{ offsetMs: number; correlation: number }>;
    referencePeaks?: PeakDetectionResult;
    targetPeaks?: PeakDetectionResult;
  };
  
  /** Analysis metadata */
  metadata: {
    referenceFile: string;
    targetFile: string;
    referenceDurationMs: number;
    targetDurationMs: number;
    analysisTimeMs: number;
    methodsUsed: string[];
  };
}

export interface SyncAnalyzerOptions {
  /** FFmpeg path */
  ffmpegPath?: string;
  /** fpcalc path (for fingerprinting) */
  fpcalcPath?: string;
  /** Temp directory for intermediate files */
  tempDir?: string;
  /** Maximum offset to search (seconds) */
  maxOffsetSec?: number;
  /** Minimum confidence threshold */
  minConfidence?: number;
  /** Enable fingerprint analysis (slower but more robust) */
  useFingerprinting?: boolean;
  /** Deep analysis mode (slower, more accurate) */
  deepAnalysis?: boolean;
  /** Limit analysis to first N seconds (quick mode: 300 = 5 min) */
  analyzeDurationSec?: number;
}

// Internal options type where analyzeDurationSec can be undefined (for full analysis)
type InternalSyncOptions = Omit<Required<SyncAnalyzerOptions>, 'analyzeDurationSec'> & {
  analyzeDurationSec: number | undefined;
};

export class AudioSyncAnalyzer {
  private crossCorrelation: CrossCorrelationEngine;
  private peakDetector: PeakDetector;
  private fingerprinter: AudioFingerprintAnalyzer;
  private silenceDetector: SilenceDetector;
  private options: InternalSyncOptions;

  constructor(options: SyncAnalyzerOptions = {}) {
    const ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    const tempDir = options.tempDir ?? os.tmpdir();

    this.options = {
      ffmpegPath,
      fpcalcPath: options.fpcalcPath ?? 'fpcalc',
      tempDir,
      maxOffsetSec: options.maxOffsetSec ?? 30,
      minConfidence: options.minConfidence ?? 0.5,
      useFingerprinting: options.useFingerprinting ?? true,
      deepAnalysis: options.deepAnalysis ?? false,
      // Quick mode: 5 minutes (300s). Set to undefined for full analysis.
      analyzeDurationSec: options.analyzeDurationSec ?? (options.deepAnalysis ? undefined : 300),
    };

    this.crossCorrelation = new CrossCorrelationEngine({ ffmpegPath, tempDir });
    this.peakDetector = new PeakDetector({ ffmpegPath, tempDir });
    this.fingerprinter = new AudioFingerprintAnalyzer({ 
      ffmpegPath, 
      fpcalcPath: this.options.fpcalcPath 
    });
    this.silenceDetector = new SilenceDetector(ffmpegPath);
  }

  /**
   * Analyze sync between reference (synced) and target (unsynced) audio
   * 
   * @param referenceFile Path to the reference audio (the one that's already synced)
   * @param targetFile Path to the target audio (the one we want to sync)
   * @returns Detailed sync analysis result
   */
  async analyze(
    referenceFile: string,
    targetFile: string
  ): Promise<SyncAnalysisResult> {
    const startTime = Date.now();
    const methodsUsed: string[] = [];

    logger.info({ referenceFile, targetFile }, 'Starting audio sync analysis');

    // Step 1: Get basic info and silence detection
    const [refSilence, targetSilence] = await Promise.all([
      this.silenceDetector.detect(referenceFile),
      this.silenceDetector.detect(targetFile),
    ]);
    methodsUsed.push('silence_detection');

    // Step 2: Cross-correlation analysis (primary method)
    // Use more segments for better multi-point consensus
    let correlationResult: CrossCorrelationResult | null = null;
    try {
      correlationResult = await this.crossCorrelation.analyze(
        referenceFile,
        targetFile,
        {
          maxOffsetSec: this.options.maxOffsetSec,
          // Smaller windows = more segments = better consensus
          windowSizeSec: this.options.deepAnalysis ? 3 : 5,
          stepSizeSec: this.options.deepAnalysis ? 1 : 2,
          analyzeDurationSec: this.options.analyzeDurationSec,
        }
      );
      methodsUsed.push('cross_correlation');
    } catch (error) {
      logger.warn({ error }, 'Cross-correlation failed, falling back to other methods');
    }

    // Step 3: Peak detection and matching
    let peakMatchResult: PeakMatchResult | null = null;
    let refPeaks: PeakDetectionResult | null = null;
    let targetPeaks: PeakDetectionResult | null = null;
    
    try {
      [refPeaks, targetPeaks] = await Promise.all([
        this.peakDetector.detect(referenceFile, { sensitivity: 0.6 }),
        this.peakDetector.detect(targetFile, { sensitivity: 0.6 }),
      ]);

      peakMatchResult = await this.peakDetector.matchPeaks(
        refPeaks.peaks,
        targetPeaks.peaks,
        { maxOffsetMs: this.options.maxOffsetSec * 1000 }
      );
      methodsUsed.push('peak_matching');
    } catch (error) {
      logger.warn({ error }, 'Peak matching failed');
    }

    // Step 4: Fingerprint analysis (optional, for source verification)
    let fingerprintResult: FingerprintCompareResult | null = null;
    if (this.options.useFingerprinting) {
      try {
        fingerprintResult = await this.fingerprinter.compare(referenceFile, targetFile);
        methodsUsed.push('fingerprinting');
      } catch (error) {
        logger.warn({ error }, 'Fingerprinting failed (fpcalc may not be installed)');
      }
    }

    // Step 5: Combine results
    const combinedResult = this.combineResults(
      correlationResult,
      peakMatchResult,
      fingerprintResult,
      refSilence,
      targetSilence
    );

    // Step 6: Determine correction
    const correction = this.determineCorrection(combinedResult);

    // Build final result
    const analysisTimeMs = Date.now() - startTime;

    logger.info({
      status: combinedResult.status,
      globalDelayMs: combinedResult.globalDelayMs,
      confidence: combinedResult.confidence,
      hasDrift: combinedResult.hasDrift,
      hasStructuralDifferences: combinedResult.hasStructuralDifferences,
      analysisTimeMs,
    }, 'Sync analysis complete');

    return {
      ...combinedResult,
      correction,
      rawData: {
        correlationGraph: correlationResult?.correlationGraph,
        referencePeaks: refPeaks ?? undefined,
        targetPeaks: targetPeaks ?? undefined,
      },
      metadata: {
        referenceFile,
        targetFile,
        referenceDurationMs: refSilence.totalDurationMs,
        targetDurationMs: targetSilence.totalDurationMs,
        analysisTimeMs,
        methodsUsed,
      },
    };
  }

  /**
   * Combine results from multiple detection methods
   */
  private combineResults(
    correlation: CrossCorrelationResult | null,
    peaks: PeakMatchResult | null,
    fingerprint: FingerprintCompareResult | null,
    refSilence: SilenceResult,
    targetSilence: SilenceResult
  ): Omit<SyncAnalysisResult, 'correction' | 'rawData' | 'metadata'> {
    const segments: SyncSegment[] = [];
    const events: SyncEvent[] = [];
    const structuralDifferences: StructuralDifference[] = [];

    // Collect segments from different sources
    if (correlation) {
      for (const seg of correlation.segments) {
        segments.push({
          startMs: seg.startMs,
          endMs: seg.endMs,
          delayMs: seg.delayMs,
          confidence: seg.confidence,
          detectionMethod: 'cross_correlation',
        });
      }

      // Add cut events
      for (const cut of correlation.cutPoints) {
        events.push({
          timestampMs: cut.timestampMs,
          type: cut.type === 'cut' ? 'cut' : 'insertion',
          description: `${cut.type} detected: ${cut.durationMs}ms`,
          confidence: 0.8,
        });
      }
    }

    if (peaks) {
      for (const seg of peaks.segments) {
        segments.push({
          startMs: seg.startMs,
          endMs: seg.endMs,
          delayMs: seg.offsetMs,
          confidence: seg.matchCount / 10, // Normalize
          detectionMethod: 'peak_match',
        });

        events.push({
          timestampMs: seg.startMs,
          type: 'anchor_match',
          description: `${seg.matchCount} peaks matched with ${seg.offsetMs}ms offset`,
          confidence: Math.min(1, seg.matchCount / 10),
        });
      }
    }

    if (fingerprint) {
      for (const seg of fingerprint.segments) {
        segments.push({
          startMs: seg.startMs,
          endMs: seg.endMs,
          delayMs: seg.delayMs,
          confidence: seg.confidence,
          detectionMethod: 'fingerprint',
        });
      }
    }

    // ============================================
    // DELAY DETECTION STRATEGY
    // ============================================
    // 1. If global correlation has high confidence (>0.6), use it directly
    //    The global correlation uses the ENTIRE waveform which is most reliable
    // 2. If global is low confidence, use segment consensus
    // 3. Segment analysis is used to detect DRIFT and CUTS, not primary delay
    
    let globalDelayMs = 0;
    let totalWeight = 0;
    let usedMethod = 'none';
    
    // Strategy 1: Trust global correlation if it's strong
    if (correlation && correlation.globalConfidence > 0.6) {
      globalDelayMs = correlation.globalDelayMs;
      totalWeight = 1;
      usedMethod = 'global_correlation';
      logger.info({
        globalDelayMs: correlation.globalDelayMs,
        globalConfidence: correlation.globalConfidence,
      }, 'Using global correlation (high confidence)');
    } 
    // Strategy 2: Use segment consensus if we have enough agreeing segments
    else {
      const confidentSegments = segments.filter(s => s.confidence > 0.3);
      const consensusDelay = this.findConsensusDelay(confidentSegments);
      const minSegmentsForConsensus = Math.max(5, Math.floor(confidentSegments.length * 0.1));
      
      if (consensusDelay.segmentCount >= minSegmentsForConsensus) {
        globalDelayMs = consensusDelay.delayMs;
        totalWeight = 1;
        usedMethod = 'segment_consensus';
        logger.info({
          consensusDelayMs: consensusDelay.delayMs,
          segmentCount: consensusDelay.segmentCount,
          totalSegments: confidentSegments.length,
          minRequired: minSegmentsForConsensus,
        }, 'Using segment consensus delay');
      }
      // Strategy 3: Weighted average fallback
      else {
        usedMethod = 'weighted_average';
        logger.info({
          segmentCount: consensusDelay.segmentCount,
          minRequired: minSegmentsForConsensus,
          globalConfidence: correlation?.globalConfidence,
        }, 'Using weighted average (low confidence)');
        
        if (correlation && correlation.globalConfidence > 0.2) {
          globalDelayMs += correlation.globalDelayMs * correlation.globalConfidence * 2;
          totalWeight += correlation.globalConfidence * 2;
        }

        if (peaks && peaks.confidence > 0.3) {
          globalDelayMs += peaks.averageOffsetMs * peaks.confidence;
          totalWeight += peaks.confidence;
        }

        if (fingerprint?.bestMatch && fingerprint.bestMatch.confidence > 0.3) {
          globalDelayMs += fingerprint.bestMatch.delayMs * fingerprint.bestMatch.confidence;
          totalWeight += fingerprint.bestMatch.confidence;
        }
        
        globalDelayMs = totalWeight > 0 ? globalDelayMs / totalWeight : 0;
      }
    }

    // Determine overall confidence
    const confidences = [
      correlation?.globalConfidence ?? 0,
      peaks?.confidence ?? 0,
      fingerprint?.bestMatch?.confidence ?? 0,
    ].filter(c => c > 0);
    
    const confidence = confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0;

    // Detect structural differences
    const hasStructuralDifferences = 
      (correlation?.hasCuts ?? false) ||
      (fingerprint?.hasStructuralDifferences ?? false) ||
      this.detectStructuralFromSegments(segments);

    // Determine status
    let status: SyncAnalysisResult['status'];
    const hasDrift = correlation?.hasDrift ?? false;
    
    if (confidence < 0.3) {
      status = 'unsyncable';
    } else if (hasStructuralDifferences) {
      status = 'cuts';
    } else if (hasDrift) {
      status = 'drift';
    } else if (Math.abs(globalDelayMs) < 30) {
      status = 'in_sync';
    } else {
      status = 'offset';
    }

    // Build structural differences from cut points
    if (correlation?.cutPoints) {
      for (let i = 0; i < correlation.cutPoints.length; i++) {
        const cut = correlation.cutPoints[i]!;
        structuralDifferences.push({
          referenceStartMs: cut.timestampMs,
          referenceEndMs: cut.timestampMs + (cut.type === 'cut' ? 0 : cut.durationMs),
          targetStartMs: cut.timestampMs + (cut.type === 'cut' ? cut.durationMs : 0),
          targetEndMs: cut.timestampMs + cut.durationMs,
          type: cut.type === 'cut' ? 'cut' : 'insertion',
          durationMs: cut.durationMs,
        });
      }
    }

    return {
      status,
      globalDelayMs: Math.round(globalDelayMs),
      confidence,
      isSameSource: fingerprint?.isSameSource ?? (confidence > 0.5),
      similarity: fingerprint?.similarity ?? confidence,
      hasDrift,
      driftRate: correlation?.driftRate ?? 0,
      hasStructuralDifferences,
      structuralDifferences,
      segments,
      events,
    };
  }

  /**
   * Detect structural differences from segment analysis
   */
  private detectStructuralFromSegments(segments: SyncSegment[]): boolean {
    if (segments.length < 3) return false;

    // Check for large jumps in delay between segments
    const delays = segments.map(s => s.delayMs);
    for (let i = 1; i < delays.length; i++) {
      const jump = Math.abs((delays[i] ?? 0) - (delays[i - 1] ?? 0));
      if (jump > 500) return true; // 500ms jump indicates a cut
    }

    return false;
  }

  /**
   * Determine the best correction approach
   */
  private determineCorrection(
    analysis: Omit<SyncAnalysisResult, 'correction' | 'rawData' | 'metadata'>
  ): SyncAnalysisResult['correction'] {
    const warnings: string[] = [];

    if (analysis.status === 'unsyncable') {
      return {
        type: 'manual',
        parameters: {},
        isSafe: false,
        warnings: ['Sync analysis confidence too low for automatic correction'],
      };
    }

    if (analysis.status === 'in_sync') {
      return {
        type: 'none',
        parameters: {},
        isSafe: true,
        warnings: [],
      };
    }

    if (analysis.hasStructuralDifferences) {
      // Need segment-by-segment correction
      const segmentCorrections = analysis.segments
        .filter(s => s.confidence > 0.5)
        .map(s => ({
          startMs: s.startMs,
          endMs: s.endMs,
          delayMs: s.delayMs,
        }));

      if (segmentCorrections.length === 0) {
        return {
          type: 'manual',
          parameters: {},
          isSafe: false,
          warnings: ['Structural differences detected but no reliable segment corrections found'],
        };
      }

      warnings.push('Structural differences (cuts/insertions) detected');
      warnings.push(`${analysis.structuralDifferences.length} cut points found`);

      return {
        type: 'segment_repair',
        parameters: { segmentCorrections },
        isSafe: false, // Always requires review when cuts are involved
        warnings,
      };
    }

    if (analysis.hasDrift) {
      // Need tempo adjustment
      const tempoFactor = 1 + (analysis.driftRate / 1000);
      
      if (Math.abs(tempoFactor - 1) > 0.05) {
        warnings.push('Large tempo adjustment required - may affect quality');
      }

      return {
        type: 'stretch',
        parameters: {
          tempoFactor,
          delayMs: analysis.globalDelayMs,
        },
        isSafe: Math.abs(tempoFactor - 1) < 0.02,
        warnings,
      };
    }

    // Simple offset correction
    if (analysis.confidence < 0.7) {
      warnings.push('Moderate confidence - verify result');
    }

    return {
      type: 'delay',
      parameters: {
        delayMs: analysis.globalDelayMs,
      },
      isSafe: analysis.confidence > 0.7 && Math.abs(analysis.globalDelayMs) < 5000,
      warnings,
    };
  }

  /**
   * Find consensus delay using histogram clustering
   * 
   * This is the key to accurate sync detection with cuts/insertions:
   * 1. Group segment delays into buckets (50ms resolution)
   * 2. Find the bucket with the most segments
   * 3. Calculate weighted average within that bucket
   * 
   * This way, if 10 segments agree on ~25ms delay and 3 segments
   * show ~400ms (due to cuts), we pick 25ms as the consensus.
   */
  private findConsensusDelay(
    segments: SyncSegment[]
  ): { delayMs: number; confidence: number; segmentCount: number } {
    if (segments.length === 0) {
      return { delayMs: 0, confidence: 0, segmentCount: 0 };
    }

    if (segments.length === 1) {
      return { 
        delayMs: segments[0]!.delayMs, 
        confidence: segments[0]!.confidence, 
        segmentCount: 1 
      };
    }

    // Bucket size in ms (50ms resolution)
    const bucketSize = 50;
    
    // Create histogram of delays
    const histogram = new Map<number, { delays: number[]; confidences: number[]; sign: number }>();
    
    for (const seg of segments) {
      const bucket = Math.round(seg.delayMs / bucketSize) * bucketSize;
      
      if (!histogram.has(bucket)) {
        histogram.set(bucket, { delays: [], confidences: [], sign: Math.sign(seg.delayMs) || 1 });
      }
      
      const entry = histogram.get(bucket)!;
      entry.delays.push(seg.delayMs);
      entry.confidences.push(seg.confidence);
    }

    // Find the bucket with the most segments (weighted by confidence)
    // Prefer smaller absolute delays when scores are close (within 20%)
    let bestBucket = 0;
    let bestScore = 0;
    let bestAbsDelay = Infinity;
    
    // Collect all bucket scores first
    const bucketScores: Array<{ bucket: number; score: number; absDelay: number }> = [];
    
    for (const [bucket, entry] of histogram) {
      const avgConfidence = entry.confidences.reduce((a, b) => a + b, 0) / entry.confidences.length;
      const score = entry.delays.length * avgConfidence;
      bucketScores.push({ bucket, score, absDelay: Math.abs(bucket) });
    }
    
    // Sort by score descending
    bucketScores.sort((a, b) => b.score - a.score);
    
    // Get best score
    if (bucketScores.length > 0) {
      const topScore = bucketScores[0]!.score;
      
      // Among buckets within 30% of top score, prefer the smallest absolute delay
      // This handles the case where +3000ms and -3000ms both have high scores
      // but the actual delay is likely much smaller
      const competingBuckets = bucketScores.filter(b => b.score >= topScore * 0.7);
      competingBuckets.sort((a, b) => a.absDelay - b.absDelay);
      
      const chosen = competingBuckets[0]!;
      bestBucket = chosen.bucket;
      bestScore = chosen.score;
      bestAbsDelay = chosen.absDelay;
      
      logger.debug({
        topBuckets: bucketScores.slice(0, 5).map(b => ({ bucket: b.bucket, score: b.score.toFixed(2) })),
        chosenBucket: bestBucket,
        reason: competingBuckets.length > 1 ? 'smallest_abs_delay' : 'highest_score',
      }, 'Bucket selection');
    }

    // Get the winning bucket
    const winner = histogram.get(bestBucket);
    if (!winner || winner.delays.length === 0) {
      return { delayMs: 0, confidence: 0, segmentCount: 0 };
    }

    // Calculate weighted average delay within the winning bucket
    let weightedSum = 0;
    let totalConfidence = 0;
    
    for (let i = 0; i < winner.delays.length; i++) {
      const delay = winner.delays[i]!;
      const conf = winner.confidences[i]!;
      weightedSum += delay * conf;
      totalConfidence += conf;
    }

    const consensusDelay = totalConfidence > 0 ? weightedSum / totalConfidence : bestBucket;
    
    // Confidence based on how many segments agree vs total
    const agreementRatio = winner.delays.length / segments.length;
    const avgConfidence = totalConfidence / winner.delays.length;
    const confidence = agreementRatio * avgConfidence;

    logger.debug({
      totalSegments: segments.length,
      bucketsFound: histogram.size,
      winningBucket: bestBucket,
      segmentsInBucket: winner.delays.length,
      consensusDelay: Math.round(consensusDelay),
      confidence,
    }, 'Consensus delay calculation');

    return {
      delayMs: Math.round(consensusDelay),
      confidence,
      segmentCount: winner.delays.length,
    };
  }
}

export default AudioSyncAnalyzer;
