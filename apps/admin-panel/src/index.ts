/**
 * Admin Panel Entry Point
 * 
 * Basic admin interface scaffold.
 * Focus on data correctness, not styling.
 * 
 * This provides:
 * - Simple table views for jobs, logs, users
 * - Direct database access (internal use only)
 * - Basic CRUD operations
 * 
 * NOT for public exposure - internal tooling only.
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
dotenvConfig({ path: resolve(process.cwd(), '../../.env') });

import express from 'express';
import { pino } from 'pino';
import { PrismaClient } from '@prisma/client';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: {
    target: 'pino-pretty',
  },
});

const prisma = new PrismaClient();
let dbConnected = false;

// Test database connection
prisma.$connect()
  .then(() => {
    dbConnected = true;
    logger.info('Database connected');
  })
  .catch((err) => {
    logger.error({ err }, 'Database connection failed');
  });

const app = express();
const PORT = process.env['ADMIN_PORT'] ?? 3001;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Basic HTML template
const htmlTemplate = (content: string, title: string = 'Admin Panel') => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Media-Bot Admin</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #1a1a1a; color: #e0e0e0; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #333; padding: 8px; text-align: left; }
    th { background: #333; }
    a { color: #4fc3f7; }
    .nav { margin-bottom: 20px; }
    .nav a { margin-right: 15px; }
    h1 { color: #4fc3f7; }
    pre { background: #2a2a2a; padding: 10px; overflow-x: auto; }
  </style>
</head>
<body>
  <div class="nav">
    <a href="/">Dashboard</a>
    <a href="/jobs">Jobs</a>
    <a href="/logs">Logs</a>
    <a href="/users">Users</a>
    <a href="/media">Media</a>
  </div>
  ${content}
</body>
</html>
`;

// Dashboard
app.get('/', async (_req, res) => {
  let stats = { totalJobs: '--', activeJobs: '--', failedJobs24h: '--', storageUsed: '--' };
  let dbStatus = 'Not connected';
  
  if (dbConnected) {
    try {
      const [totalJobs, activeJobs, failedJobs] = await Promise.all([
        prisma.job.count(),
        prisma.job.count({ where: { state: { in: ['PENDING', 'DOWNLOADING', 'ANALYZING', 'PROCESSING'] } } }),
        prisma.job.count({ 
          where: { 
            state: 'FAILED',
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          } 
        }),
      ]);
      stats = { 
        totalJobs: String(totalJobs), 
        activeJobs: String(activeJobs), 
        failedJobs24h: String(failedJobs),
        storageUsed: '--'
      };
      dbStatus = 'Connected';
    } catch (err) {
      logger.error({ err }, 'Failed to fetch stats');
      dbStatus = 'Error fetching stats';
    }
  }

  const content = `
    <h1>Media-Bot Admin Panel</h1>
    <p>Internal administration interface</p>
    <p><strong>Database:</strong> ${dbStatus}</p>
    <h2>Quick Stats</h2>
    <table>
      <tr><td>Total Jobs</td><td>${stats.totalJobs}</td></tr>
      <tr><td>Active Jobs</td><td>${stats.activeJobs}</td></tr>
      <tr><td>Failed Jobs (24h)</td><td>${stats.failedJobs24h}</td></tr>
      <tr><td>Storage Used</td><td>${stats.storageUsed}</td></tr>
    </table>
  `;
  res.send(htmlTemplate(content, 'Dashboard'));
});

// Jobs list
app.get('/jobs', async (_req, res) => {
  let jobsHtml = '<tr><td colspan="5">Database not connected</td></tr>';
  
  if (dbConnected) {
    try {
      const jobs = await prisma.job.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' },
      });
      
      if (jobs.length === 0) {
        jobsHtml = '<tr><td colspan="5">No jobs found</td></tr>';
      } else {
        jobsHtml = jobs.map(job => `
          <tr>
            <td>${job.id.slice(0, 8)}...</td>
            <td>${job.type}</td>
            <td>${job.state}</td>
            <td>${job.createdAt.toISOString()}</td>
            <td><a href="/jobs/${job.id}">View</a></td>
          </tr>
        `).join('');
      }
    } catch (err) {
      logger.error({ err }, 'Failed to fetch jobs');
      jobsHtml = '<tr><td colspan="5">Error fetching jobs</td></tr>';
    }
  }

  const content = `
    <h1>Jobs</h1>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Type</th>
          <th>Status</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${jobsHtml}
      </tbody>
    </table>
  `;
  res.send(htmlTemplate(content, 'Jobs'));
});

// Logs list
app.get('/logs', async (_req, res) => {
  let logsHtml = '<pre>Database not connected</pre>';
  
  if (dbConnected) {
    try {
      const logs = await prisma.auditLog.findMany({
        take: 100,
        orderBy: { createdAt: 'desc' },
      });
      
      if (logs.length === 0) {
        logsHtml = '<pre>No audit logs found</pre>';
      } else {
        logsHtml = '<pre>' + logs.map(log => 
          `[${log.createdAt.toISOString()}] ${log.action} - ${log.message} by ${log.userId ?? 'system'}`
        ).join('\n') + '</pre>';
      }
    } catch (err) {
      logger.error({ err }, 'Failed to fetch logs');
      logsHtml = '<pre>Error fetching logs</pre>';
    }
  }

  const content = `
    <h1>Audit Logs</h1>
    ${logsHtml}
  `;
  res.send(htmlTemplate(content, 'Logs'));
});

// Users list
app.get('/users', async (_req, res) => {
  let usersHtml = '<tr><td colspan="4">Database not connected</td></tr>';
  
  if (dbConnected) {
    try {
      const users = await prisma.user.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' },
      });
      
      if (users.length === 0) {
        usersHtml = '<tr><td colspan="4">No users found</td></tr>';
      } else {
        usersHtml = users.map(user => `
          <tr>
            <td>${user.id.slice(0, 8)}...</td>
            <td>${user.username}</td>
            <td>${user.role}</td>
            <td>${user.createdAt.toISOString()}</td>
          </tr>
        `).join('');
      }
    } catch (err) {
      logger.error({ err }, 'Failed to fetch users');
      usersHtml = '<tr><td colspan="4">Error fetching users</td></tr>';
    }
  }

  const content = `
    <h1>Users</h1>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Username</th>
          <th>Role</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        ${usersHtml}
      </tbody>
    </table>
  `;
  res.send(htmlTemplate(content, 'Users'));
});

// Media assets
app.get('/media', async (_req, res) => {
  let mediaHtml = '<tr><td colspan="5">Database not connected</td></tr>';
  
  if (dbConnected) {
    try {
      const assets = await prisma.mediaAsset.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' },
      });
      
      if (assets.length === 0) {
        mediaHtml = '<tr><td colspan="5">No media found</td></tr>';
      } else {
        mediaHtml = assets.map(asset => `
          <tr>
            <td>${asset.id.slice(0, 8)}...</td>
            <td>${asset.fileName}</td>
            <td>${asset.type}</td>
            <td>${asset.fileSize ? (Number(asset.fileSize) / 1024 / 1024).toFixed(2) + ' MB' : '--'}</td>
            <td>${asset.status}</td>
          </tr>
        `).join('');
      }
    } catch (err) {
      logger.error({ err }, 'Failed to fetch media');
      mediaHtml = '<tr><td colspan="5">Error fetching media</td></tr>';
    }
  }

  const content = `
    <h1>Media Assets</h1>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Type</th>
          <th>Size</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${mediaHtml}
      </tbody>
    </table>
  `;
  res.send(htmlTemplate(content, 'Media'));
});

// API endpoints for AJAX (future use)
app.get('/api/stats', (_req, res) => {
  res.json({
    success: true,
    data: {
      totalJobs: 0,
      activeJobs: 0,
      failedJobs24h: 0,
      storageUsed: 0,
    },
  });
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Admin panel started');
});
