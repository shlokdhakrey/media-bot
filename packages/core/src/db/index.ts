/**
 * Database Layer Index
 * 
 * Export all database-related functionality.
 */

// Prisma Client
export {
  prisma,
  connectDatabase,
  disconnectDatabase,
  checkDatabaseHealth,
  withTransaction,
  type PrismaClient,
} from './client.js';

// Base Repository
export {
  BaseRepository,
  type PaginationOptions,
  type PaginatedResult,
} from './baseRepository.js';

// Repositories
export {
  userRepository,
  UserRepository,
  jobRepository,
  JobRepository,
  type CreateJobInput,
  type StateTransitionRecord,
  mediaAssetRepository,
  MediaAssetRepository,
  type CreateMediaAssetInput,
  downloadRepository,
  DownloadRepository,
  type CreateDownloadInput,
  syncDecisionRepository,
  SyncDecisionRepository,
  type CreateSyncDecisionInput,
  processingStepRepository,
  ProcessingStepRepository,
  type CreateProcessingStepInput,
  auditLogRepository,
  AuditLogRepository,
  type CreateAuditLogInput,
  type AuditLogFilter,
} from './repositories/index.js';

// Utilities
export {
  executeRawQuery,
  getDatabaseSize,
  getTableSizes,
  getRowCounts,
  vacuumAnalyze,
  getLongRunningQueries,
  killQuery,
  getActiveConnections,
  createPerformanceIndexes,
  cleanupOrphanedRecords,
  seedDefaultAdmin,
} from './utils.js';
