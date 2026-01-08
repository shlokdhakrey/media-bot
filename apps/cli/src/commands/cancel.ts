/**
 * Cancel Command
 * 
 * Cancel a pending or running job.
 */

import ora from 'ora';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { apiClient } from '../lib/apiClient.js';
import { printSuccess, printError, printWarning } from '../lib/output.js';

interface CancelOptions {
  force?: boolean;
}

interface JobResponse {
  job: {
    id: string;
    status: string;
  };
}

export async function cancelCommand(
  jobId: string,
  options: CancelOptions
): Promise<void> {
  // Confirm unless --force
  if (!options.force) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const confirm = await new Promise<string>((resolve) => {
      rl.question(
        chalk.yellow(`Cancel job ${jobId}? [y/N] `),
        (answer) => {
          rl.close();
          resolve(answer);
        }
      );
    });

    if (confirm.toLowerCase() !== 'y') {
      printWarning('Cancelled');
      return;
    }
  }

  const spinner = ora('Cancelling job...').start();

  try {
    const response = await apiClient.post<JobResponse>(`/api/v1/jobs/${jobId}/cancel`);
    spinner.succeed('Job cancelled');
    printSuccess(`Job ${response.job.id} is now ${response.job.status}`);
  } catch (error) {
    spinner.fail('Failed to cancel job');
    printError(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}
