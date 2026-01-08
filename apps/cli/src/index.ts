#!/usr/bin/env node
/**
 * CLI Entry Point
 * 
 * Command-line interface for media-bot.
 * All commands communicate with the API server via HTTP.
 * NO business logic in CLI - it's purely a thin client.
 */

import { Command } from 'commander';
import chalk from 'chalk';

// Commands
import { startCommand } from './commands/start.js';
import { helpCommand } from './commands/help.js';
import { downloadCommand } from './commands/download.js';
import { statusCommand } from './commands/status.js';
import { logsCommand } from './commands/logs.js';
import { jobsCommand } from './commands/jobs.js';
import { cancelCommand } from './commands/cancel.js';
import { retryCommand } from './commands/retry.js';
import { loginCommand, logoutCommand, whoamiCommand } from './commands/auth.js';
import { configCommand } from './commands/config.js';
import { releasesCommand, releaseCommand } from './commands/releases.js';
import { analyzeCommand } from './commands/analyze.js';
import { statsCommand } from './commands/stats.js';
import { healthCommand } from './commands/health.js';

const program = new Command();

program
  .name('media-bot')
  .description('Private media automation CLI')
  .version('1.0.0')
  .option('--json', 'Output in JSON format')
  .option('--debug', 'Enable debug output');

// ============================================
// AUTHENTICATION COMMANDS
// ============================================

program
  .command('login')
  .description('Authenticate with the API server')
  .option('-u, --username <username>', 'Username')
  .option('-p, --password <password>', 'Password')
  .action(loginCommand);

program
  .command('logout')
  .description('Clear saved authentication')
  .action(logoutCommand);

program
  .command('whoami')
  .description('Show current authenticated user')
  .action(whoamiCommand);

// ============================================
// SYSTEM COMMANDS
// ============================================

program
  .command('start')
  .description('Initialize connection and show system status')
  .action(startCommand);

program
  .command('health')
  .description('Check system health status')
  .option('-v, --verbose', 'Show detailed health info')
  .action(healthCommand);

program
  .command('stats')
  .description('Show system statistics')
  .option('--jobs', 'Show job statistics')
  .option('--media', 'Show media statistics')
  .action(statsCommand);

program
  .command('config')
  .description('View or modify CLI configuration')
  .option('--set <key=value>', 'Set a config value')
  .option('--get <key>', 'Get a config value')
  .option('--list', 'List all config values')
  .option('--reset', 'Reset to defaults')
  .action(configCommand);

program
  .command('help [command]')
  .description('Show detailed help for all commands')
  .action(helpCommand);

// ============================================
// JOB COMMANDS
// ============================================

program
  .command('download <link>')
  .description('Download media from URL (magnet, http, nzb)')
  .option('-o, --output <name>', 'Custom output name')
  .option('-p, --priority <level>', 'Job priority (1-10)', '5')
  .option('-c, --client <client>', 'Download client (qbittorrent, aria2, nzbget)')
  .action(downloadCommand);

program
  .command('jobs')
  .description('List all jobs')
  .option('-s, --status <status>', 'Filter by status (pending, running, completed, failed)')
  .option('-t, --type <type>', 'Filter by type (download, analyze, process, etc.)')
  .option('-n, --limit <count>', 'Number of jobs to show', '20')
  .option('--all', 'Show all jobs (no limit)')
  .action(jobsCommand);

program
  .command('status <jobId>')
  .description('Check the status of a job')
  .option('-v, --verbose', 'Show detailed status')
  .option('-w, --watch', 'Watch for updates')
  .action(statusCommand);

program
  .command('logs <jobId>')
  .description('View logs for a job')
  .option('-n, --lines <count>', 'Number of log lines', '50')
  .option('-f, --follow', 'Follow log output')
  .action(logsCommand);

program
  .command('cancel <jobId>')
  .description('Cancel a pending or running job')
  .option('-f, --force', 'Force cancel without confirmation')
  .action(cancelCommand);

program
  .command('retry <jobId>')
  .description('Retry a failed job')
  .action(retryCommand);

// ============================================
// MEDIA COMMANDS
// ============================================

program
  .command('analyze <path>')
  .description('Analyze a media file')
  .option('-s, --save', 'Save results to database')
  .action(analyzeCommand);

program
  .command('releases')
  .description('List all releases')
  .option('-t, --type <type>', 'Filter by type (movie, episode)')
  .option('-s, --status <status>', 'Filter by status')
  .option('-q, --query <query>', 'Search by name')
  .option('-n, --limit <count>', 'Number of releases to show', '20')
  .action(releasesCommand);

program
  .command('release <id>')
  .description('Show release details')
  .option('-v, --verbose', 'Show full details')
  .action(releaseCommand);

// ============================================
// ERROR HANDLING
// ============================================

program.exitOverride((err) => {
  if (err.code === 'commander.unknownCommand') {
    console.error(chalk.red('Unknown command:'), err.message);
    console.log('Run', chalk.cyan('media-bot help'), 'for available commands');
  }
  process.exit(1);
});

// Parse and execute
program.parse();
