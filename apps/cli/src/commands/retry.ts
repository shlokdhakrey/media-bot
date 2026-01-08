/**
 * Retry Command
 * 
 * Retry a failed job.
 */

import ora from 'ora';
import { apiClient } from '../lib/apiClient.js';
import { printSuccess, printError, printKeyValue } from '../lib/output.js';

interface JobResponse {
  job: {
    id: string;
    status: string;
    retryCount: number;
  };
}

export async function retryCommand(jobId: string): Promise<void> {
  const spinner = ora('Retrying job...').start();

  try {
    const response = await apiClient.post<JobResponse>(`/api/v1/jobs/${jobId}/retry`);
    spinner.succeed('Job queued for retry');
    
    printKeyValue('Job ID', response.job.id);
    printKeyValue('Status', response.job.status);
    printKeyValue('Retry Count', response.job.retryCount);
    
    printSuccess('Job will be processed shortly');
  } catch (error) {
    spinner.fail('Failed to retry job');
    printError(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}
