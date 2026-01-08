/**
 * Database Cleanup Script
 * 
 * Cleans up old data based on retention policies.
 * Run with: npx tsx scripts/cleanup.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CleanupConfig {
  auditLogRetentionDays: number;
  completedJobRetentionDays: number;
  failedJobRetentionDays: number;
  dryRun: boolean;
}

const defaultConfig: CleanupConfig = {
  auditLogRetentionDays: 90,
  completedJobRetentionDays: 30,
  failedJobRetentionDays: 90,
  dryRun: process.argv.includes('--dry-run'),
};

async function cleanup(config: CleanupConfig = defaultConfig) {
  console.log('🧹 Starting cleanup...');
  console.log(`   Mode: ${config.dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  const now = new Date();

  // Cleanup old audit logs (except errors)
  const auditCutoff = new Date(now);
  auditCutoff.setDate(auditCutoff.getDate() - config.auditLogRetentionDays);

  const oldAuditLogs = await prisma.auditLog.count({
    where: {
      createdAt: { lt: auditCutoff },
      level: { not: 'ERROR' },
    },
  });
  console.log(`📋 Audit logs older than ${config.auditLogRetentionDays} days: ${oldAuditLogs}`);

  if (!config.dryRun && oldAuditLogs > 0) {
    const deleted = await prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: auditCutoff },
        level: { not: 'ERROR' },
      },
    });
    console.log(`   ✓ Deleted ${deleted.count} audit logs`);
  }

  // Cleanup old completed jobs
  const completedCutoff = new Date(now);
  completedCutoff.setDate(completedCutoff.getDate() - config.completedJobRetentionDays);

  const oldCompletedJobs = await prisma.job.count({
    where: {
      state: 'DONE',
      completedAt: { lt: completedCutoff },
    },
  });
  console.log(`\n✅ Completed jobs older than ${config.completedJobRetentionDays} days: ${oldCompletedJobs}`);

  // Note: We don't automatically delete jobs, just report
  // Deleting jobs would cascade to media assets, processing steps, etc.

  // Cleanup old failed jobs
  const failedCutoff = new Date(now);
  failedCutoff.setDate(failedCutoff.getDate() - config.failedJobRetentionDays);

  const oldFailedJobs = await prisma.job.count({
    where: {
      state: 'FAILED',
      completedAt: { lt: failedCutoff },
    },
  });
  console.log(`❌ Failed jobs older than ${config.failedJobRetentionDays} days: ${oldFailedJobs}`);

  // Summary
  console.log('\n--- Summary ---');
  if (config.dryRun) {
    console.log('This was a dry run. No data was deleted.');
    console.log('Run without --dry-run to actually delete data.');
  } else {
    console.log('Cleanup completed.');
  }
}

cleanup()
  .catch((e) => {
    console.error('❌ Cleanup failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
