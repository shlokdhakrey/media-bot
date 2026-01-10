/**
 * Sync Decision Engine
 * 
 * Analyzes media files and determines if/how sync correction is needed.
 * 
 * CRITICAL RULES:
 * 1. Duration difference alone does NOT indicate sync issues
 * 2. Same FPS does NOT guarantee sync
 * 3. Must verify sync at multiple points (start, middle, end)
 * 4. Must detect DRIFT (progressive offset) vs OFFSET (constant delay)
 * 5. Never assume - always verify
 * 
 * Now uses the new professional audio sync analysis:
 * - Cross-correlation for precise offset detection
 * - Peak matching for anchor point alignment
 * - Fingerprinting for source verification
 * - Multi-segment analysis for cut/drift detection
 */

import type { SyncAnalysis, SyncIssue, CorrectionType } from './types.js';
import type { MediaMetadata } from '@media-bot/media';
import { executeCommand } from '@media-bot/utils';
import { createLogger } from '@media-bot/utils';
import { AudioSyncAnalyzer, type SyncAnalysisResult } from './detection/syncAnalyzer.js';
import { AnchorDetector } from './detection/anchor.js';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

const logger = createLogger({ module: 'sync-decision-engine' });

export interface SyncDecision {
  // Should we proceed with correction?
  shouldCorrect: boolean;
  
  // What type of correction?
  correctionType: CorrectionType;
  
  // Correction parameters
  parameters: {
    delayMs?: number;       // For adelay
    tempoFactor?: number;   // For atempo (e.g., 1.001 = 0.1% faster)
    trimStartMs?: number;   // For trim
    trimEndMs?: number;     // For trim
    padStartMs?: number;    // For pad
    padEndMs?: number;      // For pad
    segmentCorrections?: Array<{
      startMs: number;
      endMs: number;
      delayMs: number;
    }>;
  };
  
  // Confidence in this decision
  confidence: number;
  
  // Why this decision was made
  reasoning: string[];
  
  // Warnings
  warnings: string[];
  
  // Full analysis data
  analysis: SyncAnalysis;
  
  // Raw sync analyzer result (if available)
  rawAnalysis?: SyncAnalysisResult;
}

export interface SyncDecisionEngineOptions {
  ffmpegPath?: string;
  fpcalcPath?: string;
  tempDir?: string;
  maxOffsetSec?: number;
  deepAnalysis?: boolean;
}

export class SyncDecisionEngine {
  // Thresholds (in milliseconds)
  private readonly SYNC_TOLERANCE_MS = 30;         // Acceptable sync variance
  private readonly MINOR_OFFSET_MS = 50;           // Minor issue threshold
  private readonly MODERATE_OFFSET_MS = 200;       // Moderate issue threshold
  private readonly SEVERE_OFFSET_MS = 500;         // Severe issue threshold
  private readonly DRIFT_THRESHOLD_MS_PER_SEC = 0.5; // Drift detection threshold

  private syncAnalyzer: AudioSyncAnalyzer;
  private anchorDetector: AnchorDetector;
  private ffmpegPath: string;
  private tempDir: string;

  constructor(options: SyncDecisionEngineOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    this.tempDir = options.tempDir ?? os.tmpdir();

    this.syncAnalyzer = new AudioSyncAnalyzer({
      ffmpegPath: this.ffmpegPath,
      fpcalcPath: options.fpcalcPath,
      tempDir: this.tempDir,
      maxOffsetSec: options.maxOffsetSec ?? 30,
      deepAnalysis: options.deepAnalysis ?? false,
    });

    this.anchorDetector = new AnchorDetector({
      ffmpegPath: this.ffmpegPath,
      fpcalcPath: options.fpcalcPath,
      maxOffsetSec: options.maxOffsetSec ?? 30,
      deepAnalysis: options.deepAnalysis ?? false,
    });
  }

  /**
   * Analyze sync between video and audio files
   * Returns a decision on whether and how to correct
   */
  async analyze(
    videoMeta: MediaMetadata,
    audioMeta: MediaMetadata,
    videoFile: string,
    audioFile: string
  ): Promise<SyncDecision> {
    logger.info({ videoFile, audioFile }, 'Starting sync analysis');

    const reasoning: string[] = [];
    const warnings: string[] = [];

    // Step 1: Extract audio from video for comparison
    const extractedAudioPath = await this.extractAudioFromVideo(videoFile);
    
    try {
      // Step 2: Run professional sync analysis
      const syncResult = await this.syncAnalyzer.analyze(extractedAudioPath, audioFile);

      logger.info({
        status: syncResult.status,
        globalDelayMs: syncResult.globalDelayMs,
        confidence: syncResult.confidence,
        hasDrift: syncResult.hasDrift,
        hasStructuralDifferences: syncResult.hasStructuralDifferences,
      }, 'Sync analysis complete');

      // Step 3: Convert to SyncAnalysis format
      const analysis = this.convertToSyncAnalysis(syncResult, videoFile, audioFile);

      // Step 4: Determine correction based on analysis
      const correctionDecision = this.determineCorrectionFromAnalysis(syncResult);

      // Build reasoning
      reasoning.push(`Analysis status: ${syncResult.status}`);
      reasoning.push(`Global delay: ${syncResult.globalDelayMs}ms`);
      reasoning.push(`Confidence: ${(syncResult.confidence * 100).toFixed(1)}%`);
      
      if (syncResult.hasDrift) {
        reasoning.push(`Drift detected: ${syncResult.driftRate.toFixed(3)}ms per second`);
      }
      
      if (syncResult.hasStructuralDifferences) {
        reasoning.push(`Structural differences: ${syncResult.structuralDifferences.length} cuts/insertions detected`);
      }

      // Add warnings from correction
      warnings.push(...syncResult.correction.warnings);

      // Determine if we should correct
      const shouldCorrect = 
        syncResult.status !== 'in_sync' && 
        syncResult.status !== 'unsyncable' &&
        syncResult.confidence > 0.5;

      return {
        shouldCorrect,
        correctionType: correctionDecision.type,
        parameters: correctionDecision.parameters,
        confidence: syncResult.confidence,
        reasoning,
        warnings,
        analysis,
        rawAnalysis: syncResult,
      };
    } finally {
      // Cleanup extracted audio
      try {
        await fs.unlink(extractedAudioPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Quick sync check without full analysis
   */
  async quickCheck(
    videoFile: string,
    audioFile: string
  ): Promise<{
    isInSync: boolean;
    offsetMs: number;
    confidence: number;
    needsDetailedAnalysis: boolean;
  }> {
    const extractedAudioPath = await this.extractAudioFromVideo(videoFile);
    
    try {
      return await this.anchorDetector.quickSyncCheck(extractedAudioPath, audioFile);
    } finally {
      try {
        await fs.unlink(extractedAudioPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Extract audio track from video file
   */
  private async extractAudioFromVideo(videoFile: string): Promise<string> {
    const tempPath = path.join(
      this.tempDir, 
      `extracted_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`
    );

    await executeCommand(this.ffmpegPath, [
      '-i', videoFile,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-ar', '48000',
      '-ac', '2',
      '-y',
      tempPath,
    ], { timeout: 300000 });

    return tempPath;
  }

  /**
   * Convert SyncAnalysisResult to legacy SyncAnalysis format
   */
  private convertToSyncAnalysis(
    result: SyncAnalysisResult,
    videoFile: string,
    audioFile: string
  ): SyncAnalysis {
    const issues: SyncIssue[] = [];

    // Add issues based on analysis
    if (result.status === 'offset') {
      issues.push({
        type: 'offset',
        severity: this.classifyOffset(result.globalDelayMs),
        description: `Audio offset of ${result.globalDelayMs}ms detected`,
        detectedAt: 'multiple',
        offsetMs: result.globalDelayMs,
        confidence: result.confidence,
      });
    }

    if (result.hasDrift) {
      issues.push({
        type: 'drift',
        severity: Math.abs(result.driftRate) > 1 ? 'severe' : 'moderate',
        description: `Audio drift of ${result.driftRate.toFixed(3)}ms/s detected`,
        detectedAt: 'multiple',
        offsetMs: result.driftRate * 1000, // Drift per minute
        confidence: result.confidence,
      });
    }

    if (result.hasStructuralDifferences) {
      for (const diff of result.structuralDifferences) {
        issues.push({
          type: 'unknown',
          severity: 'severe',
          description: `${diff.type} at ${diff.referenceStartMs}ms (${diff.durationMs}ms)`,
          detectedAt: 'middle',
          offsetMs: diff.durationMs,
          confidence: result.confidence,
        });
      }
    }

    // Calculate verification points from segments
    const startSegment = result.segments.find(s => s.startMs < 60000);
    const endSegment = result.segments.find(s => s.endMs > result.metadata.referenceDurationMs - 60000);
    const middleTime = result.metadata.referenceDurationMs / 2;
    const middleSegment = result.segments.find(
      s => s.startMs <= middleTime && s.endMs >= middleTime
    );

    return {
      videoFile,
      audioFile,
      needsCorrection: result.status !== 'in_sync',
      issues,
      confidence: result.confidence,
      silenceDetection: {
        audioStartMs: 0,
        audioEndMs: result.metadata.targetDurationMs,
        silenceRegions: [],
      },
      anchorPoints: result.events
        .filter(e => e.type === 'anchor_match')
        .map(e => ({
          videoTimestampMs: e.timestampMs,
          audioTimestampMs: e.timestampMs + result.globalDelayMs,
          offsetMs: result.globalDelayMs,
          type: 'peak' as const,
        })),
      verification: {
        startOffset: startSegment?.delayMs ?? result.globalDelayMs,
        middleOffset: middleSegment?.delayMs ?? result.globalDelayMs,
        endOffset: endSegment?.delayMs ?? result.globalDelayMs,
        isDriftDetected: result.hasDrift,
        driftPerSecond: result.driftRate,
      },
      analyzedAt: new Date(),
    };
  }

  /**
   * Determine correction from sync analysis result
   */
  private determineCorrectionFromAnalysis(
    result: SyncAnalysisResult
  ): {
    type: CorrectionType;
    parameters: SyncDecision['parameters'];
  } {
    const correction = result.correction;

    switch (correction.type) {
      case 'none':
        return { type: 'none', parameters: {} };

      case 'delay':
        return {
          type: 'delay',
          parameters: { delayMs: correction.parameters.delayMs },
        };

      case 'stretch':
        return {
          type: 'stretch',
          parameters: {
            tempoFactor: correction.parameters.tempoFactor,
            delayMs: correction.parameters.delayMs,
          },
        };

      case 'segment_repair':
        // Segment repair is complex - use the first segment's correction
        // or recommend manual review
        if (correction.parameters.segmentCorrections?.length === 1) {
          return {
            type: 'delay',
            parameters: { delayMs: correction.parameters.segmentCorrections[0]!.delayMs },
          };
        }
        return {
          type: 'reject',
          parameters: { segmentCorrections: correction.parameters.segmentCorrections },
        };

      case 'manual':
      default:
        return { type: 'reject', parameters: {} };
    }
  }

  /**
   * Determine correction type based on detected issues
   */
  determineCorrection(issues: SyncIssue[]): {
    type: CorrectionType;
    reasoning: string[];
  } {
    if (issues.length === 0) {
      return {
        type: 'none',
        reasoning: ['No sync issues detected'],
      };
    }

    const reasoning: string[] = [];
    
    // Check for drift (tempo issue)
    const driftIssues = issues.filter(i => i.type === 'drift');
    if (driftIssues.length > 0) {
      // Drift requires tempo adjustment
      reasoning.push('Drift detected - requires tempo adjustment');
      
      // If drift is too severe, reject
      if (driftIssues.some(i => i.severity === 'severe')) {
        reasoning.push('Drift too severe for safe correction');
        return { type: 'reject', reasoning };
      }
      
      return { type: 'stretch', reasoning };
    }

    // Check for constant offset
    const offsetIssues = issues.filter(i => i.type === 'offset');
    if (offsetIssues.length > 0) {
      const avgOffset = offsetIssues.reduce((sum, i) => sum + i.offsetMs, 0) / offsetIssues.length;
      
      if (Math.abs(avgOffset) <= this.SYNC_TOLERANCE_MS) {
        reasoning.push(`Offset ${avgOffset.toFixed(1)}ms within tolerance`);
        return { type: 'none', reasoning };
      }
      
      if (avgOffset > 0) {
        reasoning.push(`Audio starts ${avgOffset.toFixed(1)}ms late - needs delay`);
        return { type: 'delay', reasoning };
      } else {
        reasoning.push(`Audio starts ${Math.abs(avgOffset).toFixed(1)}ms early - needs trim/pad`);
        // Negative offset means audio is early - trim audio or pad video start
        return { type: 'trim', reasoning };
      }
    }

    // Unknown issues - reject for safety
    reasoning.push('Unknown sync issues detected - rejecting for manual review');
    return { type: 'reject', reasoning };
  }

  /**
   * Classify an offset into severity levels
   */
  classifyOffset(offsetMs: number): SyncIssue['severity'] {
    const absOffset = Math.abs(offsetMs);
    
    if (absOffset < this.MINOR_OFFSET_MS) return 'minor';
    if (absOffset < this.MODERATE_OFFSET_MS) return 'moderate';
    return 'severe';
  }
}
