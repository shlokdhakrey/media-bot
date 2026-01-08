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
 */

import type { SyncAnalysis, SyncIssue, CorrectionType } from './types.js';
import type { MediaMetadata } from '@media-bot/media';

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
  };
  
  // Confidence in this decision
  confidence: number;
  
  // Why this decision was made
  reasoning: string[];
  
  // Warnings
  warnings: string[];
  
  // Full analysis data
  analysis: SyncAnalysis;
}

export class SyncDecisionEngine {
  // Thresholds (in milliseconds)
  private readonly SYNC_TOLERANCE_MS = 20;         // Acceptable sync variance
  private readonly MINOR_OFFSET_MS = 50;           // Minor issue threshold
  private readonly MODERATE_OFFSET_MS = 200;       // Moderate issue threshold
  private readonly SEVERE_OFFSET_MS = 500;         // Severe issue threshold
  private readonly DRIFT_THRESHOLD_MS_PER_SEC = 0.5; // Drift detection threshold

  /**
   * Analyze sync between video and audio files
   * Returns a decision on whether and how to correct
   */
  async analyze(
    _videoMeta: MediaMetadata,
    _audioMeta: MediaMetadata,
    _videoFile: string,
    _audioFile: string
  ): Promise<SyncDecision> {
    // TODO: Implement full analysis in Phase 8
    // This involves:
    // 1. Extract audio from video
    // 2. Run silence detection on both
    // 3. Find anchor points in both
    // 4. Match anchors to calculate offsets
    // 5. Verify at multiple points
    // 6. Detect drift vs constant offset
    // 7. Make correction decision
    
    throw new Error('Not implemented - Phase 8');
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
