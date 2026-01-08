/**
 * Database Health Check Script
 * 
 * Checks database connectivity and performance.
 * Run with: npx tsx scripts/db-health.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkHealth() {
  console.log('🏥 Database Health Check\n');

  try {
    // Basic connectivity
    console.log('1. Checking connectivity...');
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;
    console.log(`   ✓ Connected (latency: ${latency}ms)`);

    // Database size
    console.log('\n2. Database size...');
    const sizeResult = await prisma.$queryRaw<[{ size: string }]>`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `;
    console.log(`   ✓ Size: ${sizeResult[0].size}`);

    // Row counts
    console.log('\n3. Table row counts...');
    const [users, jobs, assets, downloads, syncs, steps, logs] = await Promise.all([
      prisma.user.count(),
      prisma.job.count(),
      prisma.mediaAsset.count(),
      prisma.download.count(),
      prisma.syncDecision.count(),
      prisma.processingStep.count(),
      prisma.auditLog.count(),
    ]);
    console.log(`   Users:           ${users.toLocaleString()}`);
    console.log(`   Jobs:            ${jobs.toLocaleString()}`);
    console.log(`   Media Assets:    ${assets.toLocaleString()}`);
    console.log(`   Downloads:       ${downloads.toLocaleString()}`);
    console.log(`   Sync Decisions:  ${syncs.toLocaleString()}`);
    console.log(`   Processing Steps: ${steps.toLocaleString()}`);
    console.log(`   Audit Logs:      ${logs.toLocaleString()}`);

    // Job statistics
    console.log('\n4. Job statistics...');
    const jobStats = await prisma.job.groupBy({
      by: ['state'],
      _count: true,
    });
    for (const stat of jobStats) {
      console.log(`   ${stat.state}: ${stat._count}`);
    }

    // Active connections
    console.log('\n5. Connection pool...');
    const connections = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
    `;
    console.log(`   ✓ Active connections: ${connections[0].count}`);

    // Recent errors
    console.log('\n6. Recent errors (last 24h)...');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const recentErrors = await prisma.auditLog.count({
      where: {
        level: 'ERROR',
        createdAt: { gte: yesterday },
      },
    });
    console.log(`   ${recentErrors === 0 ? '✓' : '⚠️'} Error count: ${recentErrors}`);

    console.log('\n✅ Health check completed successfully!');

  } catch (error) {
    console.error('\n❌ Health check failed:', error);
    process.exit(1);
  }
}

checkHealth()
  .finally(async () => {
    await prisma.$disconnect();
  });
