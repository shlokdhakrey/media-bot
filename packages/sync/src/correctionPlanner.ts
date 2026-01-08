/**
 * Correction Planner
 * 
 * Converts sync decisions into executable FFmpeg filter chains.
 * 
 * IMPORTANT: Never apply multiple audio corrections blindly.
 * Each correction is planned carefully with verification steps.
 */

import type { SyncDecision } from './decisionEngine.js';

export interface CorrectionStep {
  order: number;
  type: 'filter' | 'mux' | 'verify';
  description: string;
  ffmpegArgs: string[];
}

export interface CorrectionPlan {
  // Steps to execute
  steps: CorrectionStep[];
  
  // Expected output characteristics
  expectedOutput: {
    durationMs: number;
    audioDelayMs: number;
  };
  
  // Verification checkpoints
  verificationPoints: Array<{
    timestampMs: number;
    expectedOffsetMs: number;
    toleranceMs: number;
  }>;
  
  // Is this a safe correction?
  isSafe: boolean;
  safetyNotes: string[];
}

export class CorrectionPlanner {
  /**
   * Create an executable correction plan from a sync decision
   */
  plan(decision: SyncDecision): CorrectionPlan {
    const steps: CorrectionStep[] = [];
    const safetyNotes: string[] = [];
    
    switch (decision.correctionType) {
      case 'none':
        return this.createNoOpPlan(decision);
        
      case 'delay':
        return this.createDelayPlan(decision);
        
      case 'stretch':
        return this.createStretchPlan(decision);
        
      case 'trim':
        return this.createTrimPlan(decision);
        
      case 'pad':
        return this.createPadPlan(decision);
        
      case 'reject':
        return this.createRejectionPlan(decision);
        
      default:
        throw new Error(`Unknown correction type: ${decision.correctionType}`);
    }
  }

  private createNoOpPlan(decision: SyncDecision): CorrectionPlan {
    return {
      steps: [],
      expectedOutput: {
        durationMs: decision.analysis.verification.endOffset,
        audioDelayMs: 0,
      },
      verificationPoints: [],
      isSafe: true,
      safetyNotes: ['No correction needed'],
    };
  }

  private createDelayPlan(decision: SyncDecision): CorrectionPlan {
    const delayMs = decision.parameters.delayMs ?? 0;
    
    return {
      steps: [
        {
          order: 1,
          type: 'filter',
          description: `Apply ${delayMs}ms delay to audio`,
          ffmpegArgs: [
            '-af', `adelay=${delayMs}|${delayMs}`,
          ],
        },
      ],
      expectedOutput: {
        durationMs: decision.analysis.verification.endOffset + delayMs,
        audioDelayMs: delayMs,
      },
      verificationPoints: [
        { timestampMs: 0, expectedOffsetMs: 0, toleranceMs: 20 },
        { timestampMs: 60000, expectedOffsetMs: 0, toleranceMs: 20 },
      ],
      isSafe: Math.abs(delayMs) < 1000, // Consider >1s delay as potentially unsafe
      safetyNotes: delayMs > 1000 
        ? ['Large delay applied - verify result carefully'] 
        : [],
    };
  }

  private createStretchPlan(decision: SyncDecision): CorrectionPlan {
    const tempo = decision.parameters.tempoFactor ?? 1.0;
    
    // atempo filter has limits (0.5 to 2.0)
    // For values outside this range, we need to chain filters
    const safetyNotes: string[] = [];
    
    if (tempo < 0.5 || tempo > 2.0) {
      safetyNotes.push('Extreme tempo change required - may affect quality');
    }

    // Calculate filter chain for extreme tempo changes
    const tempoFilters = this.calculateTempoChain(tempo);

    return {
      steps: [
        {
          order: 1,
          type: 'filter',
          description: `Apply tempo factor ${tempo.toFixed(6)}`,
          ffmpegArgs: [
            '-af', tempoFilters,
          ],
        },
      ],
      expectedOutput: {
        durationMs: decision.analysis.verification.endOffset * tempo,
        audioDelayMs: 0,
      },
      verificationPoints: [
        { timestampMs: 0, expectedOffsetMs: 0, toleranceMs: 20 },
        { timestampMs: 60000, expectedOffsetMs: 0, toleranceMs: 50 },
        { timestampMs: decision.analysis.verification.endOffset / 2, expectedOffsetMs: 0, toleranceMs: 50 },
      ],
      isSafe: tempo > 0.95 && tempo < 1.05,
      safetyNotes,
    };
  }

  private createTrimPlan(decision: SyncDecision): CorrectionPlan {
    const trimStart = decision.parameters.trimStartMs ?? 0;
    const trimEnd = decision.parameters.trimEndMs ?? 0;

    return {
      steps: [
        {
          order: 1,
          type: 'filter',
          description: `Trim ${trimStart}ms from start, ${trimEnd}ms from end`,
          ffmpegArgs: [
            '-af', `atrim=start=${trimStart / 1000}:end=${trimEnd / 1000},asetpts=PTS-STARTPTS`,
          ],
        },
      ],
      expectedOutput: {
        durationMs: decision.analysis.verification.endOffset - trimStart - trimEnd,
        audioDelayMs: 0,
      },
      verificationPoints: [
        { timestampMs: 0, expectedOffsetMs: 0, toleranceMs: 20 },
      ],
      isSafe: trimStart < 5000 && trimEnd < 5000,
      safetyNotes: trimStart > 5000 || trimEnd > 5000
        ? ['Large trim applied - verify content not lost']
        : [],
    };
  }

  private createPadPlan(decision: SyncDecision): CorrectionPlan {
    const padStart = decision.parameters.padStartMs ?? 0;
    const padEnd = decision.parameters.padEndMs ?? 0;

    return {
      steps: [
        {
          order: 1,
          type: 'filter',
          description: `Pad ${padStart}ms silence at start, ${padEnd}ms at end`,
          ffmpegArgs: [
            '-af', `apad=pad_len=${Math.round(padStart * 48)}:pad_dur=${padEnd / 1000}`,
          ],
        },
      ],
      expectedOutput: {
        durationMs: decision.analysis.verification.endOffset + padStart + padEnd,
        audioDelayMs: padStart,
      },
      verificationPoints: [
        { timestampMs: 0, expectedOffsetMs: 0, toleranceMs: 20 },
      ],
      isSafe: true,
      safetyNotes: [],
    };
  }

  private createRejectionPlan(decision: SyncDecision): CorrectionPlan {
    return {
      steps: [],
      expectedOutput: {
        durationMs: 0,
        audioDelayMs: 0,
      },
      verificationPoints: [],
      isSafe: false,
      safetyNotes: [
        'Sync correction rejected - manual review required',
        ...decision.reasoning,
      ],
    };
  }

  /**
   * Calculate atempo filter chain for extreme tempo changes
   * atempo filter only supports 0.5-2.0 range, so we chain multiple
   */
  private calculateTempoChain(tempo: number): string {
    if (tempo >= 0.5 && tempo <= 2.0) {
      return `atempo=${tempo}`;
    }

    const filters: string[] = [];
    let remaining = tempo;

    while (remaining < 0.5) {
      filters.push('atempo=0.5');
      remaining /= 0.5;
    }

    while (remaining > 2.0) {
      filters.push('atempo=2.0');
      remaining /= 2.0;
    }

    filters.push(`atempo=${remaining}`);
    return filters.join(',');
  }
}
