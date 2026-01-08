/**
 * Stats Command
 * 
 * Display system and job statistics.
 */

import ora from 'ora';
import chalk from 'chalk';
import { apiClient } from '../lib/apiClient.js';
import { printError, printHeader, printKeyValue } from '../lib/output.js';

interface StatsResponse {
  stats: {
    jobs: {
      total: number;
      pending: number;
      processing: number;
      completed: number;
      failed: number;
      cancelled: number;
    };
    releases: {
      total: number;
      movies: number;
      episodes: number;
      music: number;
    };
    storage: {
      totalBytes: number;
      usedBytes: number;
      availableBytes: number;
    };
    processing: {
      averageTime: number;
      totalProcessed: number;
      last24Hours: number;
    };
  };
}

export async function statsCommand(): Promise<void> {
  const spinner = ora('Fetching statistics...').start();

  try {
    const response = await apiClient.get<StatsResponse>('/api/v1/system/stats');
    spinner.stop();

    const { stats } = response;

    printHeader('System Statistics');

    // Jobs section
    console.log(chalk.bold('\n📋 Jobs'));
    printKeyValue('Total', stats.jobs.total.toString());
    console.log(
      `  ${chalk.gray('⏳')} Pending: ${chalk.yellow(stats.jobs.pending)} | ` +
      `${chalk.blue('🔄')} Processing: ${chalk.blue(stats.jobs.processing)} | ` +
      `${chalk.green('✅')} Completed: ${chalk.green(stats.jobs.completed)}`
    );
    console.log(
      `  ${chalk.red('❌')} Failed: ${chalk.red(stats.jobs.failed)} | ` +
      `${chalk.gray('🚫')} Cancelled: ${chalk.gray(stats.jobs.cancelled)}`
    );

    // Releases section  
    console.log(chalk.bold('\n📁 Releases'));
    printKeyValue('Total', stats.releases.total.toString());
    console.log(
      `  🎬 Movies: ${stats.releases.movies} | ` +
      `📺 Episodes: ${stats.releases.episodes} | ` +
      `🎵 Music: ${stats.releases.music}`
    );

    // Storage section
    console.log(chalk.bold('\n💾 Storage'));
    const usedPercent = ((stats.storage.usedBytes / stats.storage.totalBytes) * 100).toFixed(1);
    const usedBar = createProgressBar(parseFloat(usedPercent), 30);
    printKeyValue('Total', formatBytes(stats.storage.totalBytes));
    printKeyValue('Used', `${formatBytes(stats.storage.usedBytes)} (${usedPercent}%)`);
    printKeyValue('Available', formatBytes(stats.storage.availableBytes));
    console.log(`  ${usedBar}`);

    // Processing section
    console.log(chalk.bold('\n⚡ Processing'));
    printKeyValue('Average Time', formatDuration(stats.processing.averageTime));
    printKeyValue('Total Processed', stats.processing.totalProcessed.toString());
    printKeyValue('Last 24 Hours', stats.processing.last24Hours.toString());

  } catch (error) {
    spinner.fail('Failed to fetch statistics');
    printError(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

function createProgressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  
  let color = chalk.green;
  if (percent > 80) color = chalk.red;
  else if (percent > 60) color = chalk.yellow;
  
  return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}
