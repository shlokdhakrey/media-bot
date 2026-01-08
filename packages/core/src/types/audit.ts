/**
 * Audit Log Types
 * 
 * Re-exports Prisma types for consistency.
 */

import { AuditLog as PrismaAuditLog, AuditAction, LogLevel } from '@prisma/client';

export { AuditAction, LogLevel };

export type AuditLog = PrismaAuditLog;
