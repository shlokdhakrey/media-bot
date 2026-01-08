/**
 * Help Command
 * 
 * Shows detailed help for all commands.
 */

import chalk from 'chalk';
import { printHeader } from '../lib/output.js';

export async function helpCommand(command?: string): Promise<void> {
  if (command) {
    showCommandHelp(command);
    return;
  }

  printHeader('Media-Bot CLI Help');

  console.log(chalk.bold('AUTHENTICATION:'));
  console.log();
  console.log(chalk.cyan('  login'));
  console.log('    Authenticate with the API server');
  console.log('    Options: -u, --username <user>  -p, --password <pass>');
  console.log();
  console.log(chalk.cyan('  logout'));
  console.log('    Clear saved authentication tokens');
  console.log();
  console.log(chalk.cyan('  whoami'));
  console.log('    Show current authenticated user');
  console.log();

  console.log(chalk.bold('SYSTEM COMMANDS:'));
  console.log();
  console.log(chalk.cyan('  start'));
  console.log('    Check system status and API connectivity');
  console.log();
  console.log(chalk.cyan('  health'));
  console.log('    Detailed health check of all components');
  console.log();
  console.log(chalk.cyan('  stats'));
  console.log('    Show system statistics (jobs, releases, storage)');
  console.log();
  console.log(chalk.cyan('  config [key] [value]'));
  console.log('    View or modify CLI configuration');
  console.log();

  console.log(chalk.bold('JOB COMMANDS:'));
  console.log();
  console.log(chalk.cyan('  download <link>'));
  console.log('    Download media from a URL');
  console.log('    Supported: magnet://, http(s)://, gdrive://, nzb://');
  console.log('    Options: -o, --output <name>  -p, --priority <1-10>  -c, --client <name>');
  console.log();
  console.log(chalk.cyan('  jobs'));
  console.log('    List all jobs with optional filters');
  console.log('    Options: -s, --status <status>  -t, --type <type>  -n, --limit <count>');
  console.log();
  console.log(chalk.cyan('  status <job_id>'));
  console.log('    Check the current status of a job');
  console.log('    Options: -v, --verbose  -w, --watch');
  console.log();
  console.log(chalk.cyan('  logs <job_id>'));
  console.log('    View execution logs for a job');
  console.log('    Options: -n, --lines <count>  -f, --follow');
  console.log();
  console.log(chalk.cyan('  cancel <job_id>'));
  console.log('    Cancel a pending or running job');
  console.log('    Options: -f, --force');
  console.log();
  console.log(chalk.cyan('  retry <job_id>'));
  console.log('    Retry a failed job');
  console.log();

  console.log(chalk.bold('MEDIA COMMANDS:'));
  console.log();
  console.log(chalk.cyan('  analyze <path>'));
  console.log('    Analyze a media file');
  console.log('    Options: -s, --save');
  console.log();
  console.log(chalk.cyan('  releases'));
  console.log('    List all releases');
  console.log('    Options: -t, --type <type>  -s, --status <status>  -q, --query <search>');
  console.log();
  console.log(chalk.cyan('  release <id>'));
  console.log('    Show detailed release information');
  console.log('    Options: -v, --verbose');
  console.log();

  console.log(chalk.bold('ENVIRONMENT VARIABLES:'));
  console.log();
  console.log('  MEDIA_BOT_API_URL   API server URL (default: http://localhost:3000)');
  console.log('  MEDIA_BOT_API_KEY   API authentication key');
  console.log();

  console.log(chalk.bold('EXAMPLES:'));
  console.log();
  console.log(chalk.gray('  # Authenticate'));
  console.log('  $ media-bot login -u admin');
  console.log();
  console.log(chalk.gray('  # Download from magnet link'));
  console.log('  $ media-bot download "magnet:?xt=urn:btih:..."');
  console.log();
  console.log(chalk.gray('  # Watch job progress'));
  console.log('  $ media-bot status abc123 --watch');
  console.log();
  console.log(chalk.gray('  # Filter jobs'));
  console.log('  $ media-bot jobs --status failed --type download');
  console.log();
}

function showCommandHelp(command: string): void {
  const helpTexts: Record<string, () => void> = {
    download: () => {
      printHeader('download - Download media from URL');
      console.log('Usage: media-bot download <link> [options]');
      console.log();
      console.log('Arguments:');
      console.log('  link    URL to download (magnet, http, gdrive, nzb)');
      console.log();
      console.log('Options:');
      console.log('  -o, --output <name>    Custom output filename');
      console.log('  -p, --priority <1-10>  Job priority (default: 5)');
      console.log('  -c, --client <name>    Force specific client');
      console.log();
      console.log('Supported protocols:');
      console.log('  magnet://  → qBittorrent');
      console.log('  http(s):// → aria2');
      console.log('  gdrive://  → rclone');
      console.log('  nzb://     → NZBget');
    },
    jobs: () => {
      printHeader('jobs - List jobs');
      console.log('Usage: media-bot jobs [options]');
      console.log();
      console.log('Options:');
      console.log('  -s, --status <status>  Filter: pending, running, completed, failed, cancelled');
      console.log('  -t, --type <type>      Filter: download, analyze, process, sync');
      console.log('  -n, --limit <count>    Number of results (default: 20)');
      console.log('  --all                  Show all jobs (ignore limit)');
    },
    status: () => {
      printHeader('status - Check job status');
      console.log('Usage: media-bot status <jobId> [options]');
      console.log();
      console.log('Options:');
      console.log('  -v, --verbose  Show processing steps');
      console.log('  -w, --watch    Auto-refresh until complete');
    },
  };

  const helpFn = helpTexts[command];
  if (helpFn) {
    helpFn();
  } else {
    console.log(chalk.yellow(`No detailed help for '${command}'`));
    console.log('Run "media-bot help" for general help');
  }
}
