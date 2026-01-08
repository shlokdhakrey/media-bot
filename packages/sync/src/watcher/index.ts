/**
 * Watcher Module
 * 
 * File system watching and synchronization components.
 */

export { 
  FolderWatcher, 
  createMediaWatcher, 
  createDownloadWatcher,
  type WatcherConfig,
  type WatchEvent,
  type WatchEventType,
} from './folderWatcher.js';

export { 
  PathMapper, 
  createDockerPathMapper, 
  createDownloadPathMapper,
  type PathMapperConfig,
  type PathMapping,
} from './pathMapper.js';

export { 
  FileSyncService,
  type SyncFile,
  type SyncManifest,
  type SyncOptions,
  type SyncProgress,
  type SyncOperation,
  type SyncStatus,
} from './fileSyncService.js';

export {
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
} from './conflictResolver.js';
