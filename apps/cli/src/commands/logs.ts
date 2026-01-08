/**
 * Logs Command
 * 
 * Retrieves and displays logs for a specific job.
 */

import ora from 'ora';
import chalk from 'chalk';
import { apiClient } from '../lib/apiClient.js';
import { printError, printHeader, printInfo } from '../lib/output.js';

interface LogsOptions {
  lines: string;
  follow?: boolean;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: Record<string, unknown>;
}

interface LogsResponse {
  jobId: string;
  logs: LogEntry[];
}

const levelColors: Record<string, (text: string) => string> = {
  error: chalk.red,
  warn: chalk.yellow,
  info: chalk.blue,
  debug: chalk.gray,
};

export async function logsCommand(
  jobId: string,
  options: LogsOptions
): Promise<void> {
  if (options.follow) {
    await followLogs(jobId);
    return;
  }

  const spinner = ora('Fetching job logs...').start();

  try {
    const response = await apiClient.get<LogsResponse>(
      `/api/v1/jobs/${jobId}/logs?limit=${options.lines}`
    );

    spinner.stop();
    
    printHeader(`Logs for Job: ${jobId.slice(0, 8)}...`);

    if (response.logs.length === 0) {
      printInfo('No logs found for this job');
      return;
    }

    for (const entry of response.logs) {
      displayLogEntry(entry);
    }
  } catch (error) {
    spinner.fail('Failed to fetch job logs');
    printError(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

function displayLogEntry(entry: LogEntry): void {
  const colorFn = levelColors[entry.level] ?? chalk.white;
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const level = entry.level.toUpperCase().padEnd(5);
  
  console.log(
    `${chalk.gray(time)} ${colorFn(level)} ${entry.message}`
  );
  
  if (entry.data && Object.keys(entry.data).length > 0) {
    console.log(chalk.gray(`       ${JSON.stringify(entry.data)}`));
  }
}

async function followLogs(jobId: string): Promise<void> {
  console.log(chalk.gray('Following logs... (Ctrl+C to stop)'));
  console.log();

  let lastTimestamp = new Date(0).toISOString();

  const poll = async (): Promise<void> => {
    try {
      const response = await apiClient.get<LogsResponse>(
        `/api/v1/jobs/${jobId}/logs?after=${encodeURIComponent(lastTimestamp)}&limit=100`
      );

      for (const entry of response.logs) {
        displayLogEntry(entry);
        lastTimestamp = entry.timestamp;
      }
    } catch {
      // Ignore errors during follow
    }
  };

  // Set up interrupt handler
  process.on('SIGINT', () => {
    console.log();
    console.log(chalk.gray('Stopped following logs'));
    process.exit(0);
  });

  while (true) {
    await poll();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
