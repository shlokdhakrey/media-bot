/**
 * Job Types
 * 
 * Re-exports Prisma types for consistency.
 */

import { Job as PrismaJob, JobType, JobState, Priority } from '@prisma/client';

export { JobType, JobState, Priority };

export type Job = PrismaJob;

export interface JobCreateInput {
  type: JobType;
  source: string;
  userId: string;
  priority?: Priority;
  options?: Record<string, unknown>;
}

export interface JobUpdateInput {
  state?: JobState;
  progress?: number;
  error?: string;
  mediaAssetId?: string;
}
