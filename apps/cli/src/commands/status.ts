/**
 * Status Command
 * 
 * Retrieves and displays the current status of a job.
 */

import ora from 'ora';
import chalk from 'chalk';
import { apiClient } from '../lib/apiClient.js';
import { printError, printKeyValue, printHeader } from '../lib/output.js';

interface StatusOptions {
  verbose?: boolean;
  watch?: boolean;
}

interface JobStatusResponse {
  job: {
    id: string;
    status: string;
    type: string;
    source?: string;
    progress?: number;
    createdAt: string;
    updatedAt?: string;
    error?: string;
    steps?: Array<{
      name: string;
      status: string;
      duration?: number;
    }>;
  };
}

const statusColors: Record<string, (text: string) => string> = {
  PENDING: chalk.gray,
  RUNNING: chalk.blue,
  DOWNLOADING: chalk.blue,
  ANALYZING: chalk.blue,
  SYNCING: chalk.yellow,
  PROCESSING: chalk.yellow,
  VALIDATING: chalk.cyan,
  PACKAGED: chalk.cyan,
  UPLOADED: chalk.green,
  COMPLETED: chalk.green,
  DONE: chalk.green,
  FAILED: chalk.red,
  CANCELLED: chalk.gray,
};

export async function statusCommand(
  jobId: string,
  options: StatusOptions
): Promise<void> {
  if (options.watch) {
    await watchStatus(jobId, options.verbose);
    return;
  }

  const spinner = ora('Fetching job status...').start();

  try {
    const response = await apiClient.get<JobStatusResponse>(`/api/v1/jobs/${jobId}`);
    spinner.stop();
    
    displayJobStatus(response.job, options.verbose);
  } catch (error) {
    spinner.fail('Failed to fetch job status');
    printError(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

function displayJobStatus(
  job: JobStatusResponse['job'],
  verbose?: boolean
): void {
  const colorFn = statusColors[job.status] ?? chalk.white;

  printHeader(`Job Status: ${job.id.slice(0, 8)}...`);
  
  printKeyValue('ID', job.id);
  printKeyValue('Status', colorFn(job.status));
  printKeyValue('Type', job.type);
  if (job.source) {
    printKeyValue('Source', job.source.slice(0, 50) + (job.source.length > 50 ? '...' : ''));
  }
  if (job.progress !== undefined && job.progress > 0) {
    const bar = createProgressBar(job.progress, 30);
    printKeyValue('Progress', `${job.progress}%`);
    console.log(`  ${bar}`);
  }
  printKeyValue('Created', new Date(job.createdAt).toLocaleString());
  if (job.updatedAt) {
    printKeyValue('Updated', new Date(job.updatedAt).toLocaleString());
  }

  if (job.error) {
    console.log();
    printError(job.error);
  }

  if (verbose && job.steps && job.steps.length > 0) {
    console.log();
    console.log(chalk.bold('Processing Steps:'));
    for (const step of job.steps) {
      const stepColor = statusColors[step.status] ?? chalk.white;
      const durationStr = step.duration ? ` (${step.duration}ms)` : '';
      console.log(`  ${stepColor('●')} ${step.name}: ${step.status}${durationStr}`);
    }
  }
}

async function watchStatus(jobId: string, verbose?: boolean): Promise<void> {
  const terminalStates = ['COMPLETED', 'DONE', 'FAILED', 'CANCELLED'];
  let lastStatus = '';

  process.stdout.write('\x1Bc'); // Clear screen
  console.log(chalk.gray('Watching job status... (Ctrl+C to stop)'));
  console.log();

  const poll = async (): Promise<boolean> => {
    try {
      const response = await apiClient.get<JobStatusResponse>(`/api/v1/jobs/${jobId}`);
      const { job } = response;

      if (job.status !== lastStatus) {
        process.stdout.write('\x1B[2J\x1B[0;0H'); // Clear and reset cursor
        console.log(chalk.gray('Watching job status... (Ctrl+C to stop)'));
        displayJobStatus(job, verbose);
        lastStatus = job.status;
      }

      return terminalStates.includes(job.status);
    } catch {
      return true; // Stop on error
    }
  };

  while (!(await poll())) {
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

function createProgressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}
