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
 * - Silence detection (find actual audio start/end)
 * - Anchor alignment (match audio events to video)
 * - Multi-point verification (start, middle, end)
 * 
 * Correction types:
 * - Delay (adelay) - shift audio in time
 * - Stretch (atempo) - change audio speed
 * - Trim - remove audio from start/end
 * - Pad - add silence to start/end
 * - Reject - no safe correction possible
 */

// Detection
export { SilenceDetector, type SilenceResult } from './detection/silence.js';
export { AnchorDetector, type AnchorResult } from './detection/anchor.js';

// Decision engine
export { SyncDecisionEngine, type SyncDecision } from './decisionEngine.js';

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
