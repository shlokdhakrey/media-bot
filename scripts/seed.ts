/**
 * Database Seed Script
 * 
 * Seeds the database with initial data.
 * Run with: npm run db:seed
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // Create default admin user
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@mediabot.local',
      role: 'ADMIN',
      isActive: true,
      preferences: {
        theme: 'dark',
        notifications: true,
      },
    },
  });
  console.log(`✓ Admin user created: ${admin.username} (${admin.id})`);

  // Create a system user for automated jobs
  const systemUser = await prisma.user.upsert({
    where: { username: 'system' },
    update: {},
    create: {
      username: 'system',
      role: 'ADMIN',
      isActive: true,
      preferences: {},
    },
  });
  console.log(`✓ System user created: ${systemUser.username} (${systemUser.id})`);

  // Log the seeding action
  await prisma.auditLog.create({
    data: {
      action: 'CONFIG_CHANGED',
      message: 'Database seeded with initial data',
      level: 'INFO',
      userId: admin.id,
      metadata: {
        seededAt: new Date().toISOString(),
        users: [admin.username, systemUser.username],
      },
    },
  });
  console.log('✓ Initial audit log created');

  console.log('\n✅ Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
