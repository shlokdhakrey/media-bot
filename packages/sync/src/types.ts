/**
 * Sync Types
 */

export type CorrectionType = 
  | 'delay'      // adelay - shift audio timing
  | 'stretch'    // atempo - change audio speed
  | 'trim'       // Remove audio from start/end
  | 'pad'        // Add silence to start/end
  | 'none'       // Already in sync
  | 'reject';    // Cannot safely correct

export interface SyncIssue {
  type: 'offset' | 'drift' | 'tempo' | 'unknown';
  severity: 'minor' | 'moderate' | 'severe';
  description: string;
  detectedAt: 'start' | 'middle' | 'end' | 'multiple';
  offsetMs: number;
  confidence: number; // 0-1
}

export interface SyncAnalysis {
  videoFile: string;
  audioFile: string;
  
  // Is correction needed?
  needsCorrection: boolean;
  
  // Detected issues
  issues: SyncIssue[];
  
  // Overall confidence in analysis
  confidence: number;
  
  // Raw detection results
  silenceDetection: {
    audioStartMs: number;
    audioEndMs: number;
    silenceRegions: Array<{ startMs: number; endMs: number }>;
  };
  
  anchorPoints: Array<{
    videoTimestampMs: number;
    audioTimestampMs: number;
    offsetMs: number;
    type: 'silence' | 'peak' | 'transition';
  }>;
  
  // Verification results at multiple points
  verification: {
    startOffset: number;
    middleOffset: number;
    endOffset: number;
    isDriftDetected: boolean;
    driftPerSecond: number;
  };
  
  // Timestamp
  analyzedAt: Date;
}
