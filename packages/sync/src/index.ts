/**
 * @media-bot/sync
 * 
 * Audio-video sync engine.
 * 
 * THE MOST CRITICAL COMPONENT OF THE SYSTEM.
 * 
 * Key principles:
 * - Duration difference is NOT the primary sync metric
 * - Same FPS does NOT guarantee sync
 * - Multi-point verification is REQUIRED
 * - Never apply multiple corrections blindly
 * 
 * Detection methods:
 * - Cross-correlation (precise waveform alignment)
 * - Peak/transient matching (anchor point alignment)
 * - Audio fingerprinting (source verification)
 * - Silence detection (boundary detection)
 * - Multi-segment analysis (drift/cut detection)
 * 
 * Correction types:
 * - Delay (adelay) - shift audio in time
 * - Stretch (atempo) - change audio speed
 * - Trim - remove audio from start/end
 * - Pad - add silence to start/end
 * - Segment repair - fix cuts/insertions
 * - Reject - no safe correction possible
 */

// Core detection modules
export { SilenceDetector, type SilenceResult, type SilenceRegion } from './detection/silence.js';
export { 
  AnchorDetector, 
  type AnchorResult, 
  type AnchorPoint, 
  type AnchorMatchResult,
  type AnchorDetectorOptions,
} from './detection/anchor.js';

// Advanced detection (new professional analysis)
export { 
  CrossCorrelationEngine, 
  type CrossCorrelationResult,
  type WaveformData,
  type CorrelationResult,
} from './detection/crossCorrelation.js';

export {
  PeakDetector,
  type AudioPeak,
  type PeakDetectionResult,
  type PeakMatchResult,
} from './detection/peakDetector.js';

export {
  AudioFingerprintAnalyzer,
  type AudioFingerprint,
  type FingerprintMatch,
  type FingerprintCompareResult,
} from './detection/fingerprint.js';

export {
  AudioSyncAnalyzer,
  type SyncAnalysisResult,
  type SyncSegment,
  type SyncEvent,
  type StructuralDifference,
  type SyncAnalyzerOptions,
} from './detection/syncAnalyzer.js';

// Decision engine
export { 
  SyncDecisionEngine, 
  type SyncDecision,
  type SyncDecisionEngineOptions,
} from './decisionEngine.js';

// Correction planner
export { CorrectionPlanner, type CorrectionPlan } from './correctionPlanner.js';

// Types
export type { SyncAnalysis, SyncIssue, CorrectionType } from './types.js';

// File System Watcher and Sync
export {
  // Folder Watcher
  FolderWatcher,
  createMediaWatcher,
  createDownloadWatcher,
  type WatcherConfig,
  type WatchEvent,
  type WatchEventType,
  
  // Path Mapper
  PathMapper,
  createDockerPathMapper,
  createDownloadPathMapper,
  type PathMapperConfig,
  type PathMapping,
  
  // File Sync
  FileSyncService,
  type SyncFile,
  type SyncManifest,
  type SyncOptions,
  type SyncProgress,
  type SyncOperation,
  type SyncStatus,
  
  // Conflict Resolution
  ConflictResolver,
  createMediaConflictResolver,
  createSafeConflictResolver,
  type ConflictStrategy,
  type ConflictAction,
  type FileConflict,
  type ConflictResolution,
  type ConflictRule,
  type ConflictCondition,
  type ConflictResolverConfig,
} from './watcher/index.js';
