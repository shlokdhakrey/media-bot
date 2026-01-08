/**
 * @media-bot/core
 * 
 * Core business logic package containing:
 * - Job state machine
 * - Database access layer
 * - Audit logging
 * - Error handling
 * - Shared types
 */

// State machine
export { 
  JobState, 
  JobStateMachine,
  isValidTransition,
  getNextStates,
} from './stateMachine.js';

export type { 
  JobStateTransition, 
} from './stateMachine.js';

// Types
export type {
  Job,
  JobCreateInput,
  JobUpdateInput,
} from './types/job.js';

export type {
  User,
  UserRole,
} from './types/user.js';

export type {
  AuditLog,
  AuditAction,
} from './types/audit.js';

// Database
export {
  prisma,
  connectDatabase,
  disconnectDatabase,
  checkDatabaseHealth,
  withTransaction,
  type PrismaClient,
  BaseRepository,
  type PaginationOptions,
  type PaginatedResult,
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
  executeRawQuery,
  getDatabaseSize,
  getTableSizes,
  getRowCounts,
  createPerformanceIndexes,
  seedDefaultAdmin,
} from './db/index.js';

// Services
export { JobService } from './services/jobService.js';
export { AuditService } from './services/auditService.js';

// Errors
export { 
  MediaBotError,
  ValidationError,
  StateTransitionError,
  NotFoundError,
} from './errors/index.js';

// Binary Configuration
export {
  getBinariesConfig,
  binaries,
  getBinaryPath,
  isBinaryAvailable,
  getBinaryFolders,
  logBinaryConfig,
  type BinaryConfig,
  type BinariesConfig,
} from './config/binaries.js';
