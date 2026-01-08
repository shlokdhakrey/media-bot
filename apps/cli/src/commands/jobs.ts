/**
 * Jobs Command
 * 
 * List and filter jobs.
 */

import ora from 'ora';
import chalk from 'chalk';
import { apiClient } from '../lib/apiClient.js';
import { printError, printHeader, printInfo } from '../lib/output.js';

interface JobsOptions {
  status?: string;
  type?: string;
  limit: string;
  all?: boolean;
}

interface Job {
  id: string;
  type: string;
  status: string;
  progress?: number;
  createdAt: string;
  updatedAt?: string;
  release?: {
    releaseName: string;
  };
}

interface JobsResponse {
  jobs: Job[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

const statusIcons: Record<string, string> = {
  PENDING: '⏳',
  RUNNING: '🔄',
  COMPLETED: '✅',
  FAILED: '❌',
  CANCELLED: '🚫',
};

const statusColors: Record<string, (text: string) => string> = {
  PENDING: chalk.gray,
  RUNNING: chalk.blue,
  COMPLETED: chalk.green,
  FAILED: chalk.red,
  CANCELLED: chalk.yellow,
};

export async function jobsCommand(options: JobsOptions): Promise<void> {
  const spinner = ora('Fetching jobs...').start();

  try {
    const params = new URLSearchParams();
    if (options.status) params.append('status', options.status);
    if (options.type) params.append('type', options.type);
    if (!options.all) params.append('limit', options.limit);

    const response = await apiClient.get<JobsResponse>(`/api/v1/jobs?${params}`);
    spinner.stop();

    const { jobs, pagination } = response;

    if (jobs.length === 0) {
      printInfo('No jobs found');
      return;
    }

    printHeader(`Jobs (${pagination.total} total)`);

    // Display jobs as a formatted list
    for (const job of jobs) {
      const icon = statusIcons[job.status] || '❓';
      const colorFn = statusColors[job.status] || chalk.white;
      const progress = job.progress !== undefined ? ` ${job.progress}%` : '';
      const name = job.release?.releaseName || job.id.slice(0, 8);
      const timeAgo = getTimeAgo(new Date(job.createdAt));

      console.log(
        `${icon} ${chalk.cyan(job.id.slice(0, 8))} ` +
        `${colorFn(job.status.padEnd(10))}${progress.padEnd(5)} ` +
        `${chalk.gray(job.type.padEnd(10))} ` +
        `${name.slice(0, 40).padEnd(40)} ` +
        `${chalk.gray(timeAgo)}`
      );
    }

    if (pagination.hasMore) {
      console.log();
      printInfo(`Showing ${jobs.length} of ${pagination.total} jobs. Use --all to see all.`);
    }
  } catch (error) {
    spinner.fail('Failed to fetch jobs');
    printError(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
