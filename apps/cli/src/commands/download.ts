/**
 * Download Command
 * 
 * Initiates a download job for the given URL.
 */

import ora from 'ora';
import { z } from 'zod';
import { apiClient } from '../lib/apiClient.js';
import { printSuccess, printError, printKeyValue, printHeader } from '../lib/output.js';

interface DownloadOptions {
  output?: string;
  priority: string;
  client?: string;
}

interface JobResponse {
  job: {
    id: string;
    status: string;
    type: string;
    source: string;
    createdAt: string;
  };
}

// URL validation schema
const linkSchema = z.string().min(1, 'Link is required');

export async function downloadCommand(
  link: string,
  options: DownloadOptions
): Promise<void> {
  // Validate input
  const parseResult = linkSchema.safeParse(link);
  if (!parseResult.success) {
    printError('Invalid link provided');
    process.exit(1);
  }

  printHeader('Creating Download Job');
  printKeyValue('Source', link.slice(0, 60) + (link.length > 60 ? '...' : ''));
  if (options.output) {
    printKeyValue('Output', options.output);
  }
  printKeyValue('Priority', options.priority);
  if (options.client) {
    printKeyValue('Client', options.client);
  }
  console.log();

  const spinner = ora('Submitting job to API...').start();

  try {
    const response = await apiClient.post<JobResponse>('/api/v1/jobs', {
      type: 'download',
      source: link,
      options: {
        outputName: options.output,
        priority: parseInt(options.priority, 10),
        client: options.client,
      },
    });

    const { job } = response;
    spinner.succeed('Job created successfully');
    console.log();
    printKeyValue('Job ID', job.id);
    printKeyValue('Status', job.status);
    printKeyValue('Created', new Date(job.createdAt).toLocaleString());
    console.log();
    printSuccess(`Track with: media-bot status ${job.id}`);
  } catch (error) {
    spinner.fail('Failed to create job');
    printError(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}
