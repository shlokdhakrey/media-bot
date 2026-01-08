/**
 * Releases Command
 * 
 * List and view media releases.
 */

import ora from 'ora';
import chalk from 'chalk';
import { apiClient } from '../lib/apiClient.js';
import { printError, printHeader, printInfo, printKeyValue } from '../lib/output.js';

interface ReleasesOptions {
  type?: string;
  status?: string;
  query?: string;
  limit: string;
}

interface ReleaseOptions {
  verbose?: boolean;
}

interface Release {
  id: string;
  releaseName: string;
  title?: string;
  type: string;
  status: string;
  createdAt: string;
  mediaInfo?: {
    format: string;
    duration: number;
    videoCodec?: string;
    videoWidth?: number;
    videoHeight?: number;
  };
}

interface ReleasesResponse {
  releases: Release[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

interface ReleaseResponse {
  release: Release & {
    sourceFile?: {
      path: string;
      size: number;
    };
    outputFile?: {
      path: string;
      size: number;
    };
    jobs?: Array<{
      id: string;
      type: string;
      status: string;
      createdAt: string;
    }>;
  };
}

const typeIcons: Record<string, string> = {
  MOVIE: '🎬',
  EPISODE: '📺',
  MUSIC: '🎵',
  UNKNOWN: '📁',
};

const statusColors: Record<string, (text: string) => string> = {
  PENDING: chalk.gray,
  PROCESSING: chalk.blue,
  COMPLETED: chalk.green,
  FAILED: chalk.red,
};

export async function releasesCommand(options: ReleasesOptions): Promise<void> {
  const spinner = ora('Fetching releases...').start();

  try {
    const params = new URLSearchParams();
    if (options.type) params.append('type', options.type);
    if (options.status) params.append('status', options.status);
    if (options.query) params.append('query', options.query);
    params.append('limit', options.limit);

    const response = await apiClient.get<ReleasesResponse>(`/api/v1/media/releases?${params}`);
    spinner.stop();

    const { releases, pagination } = response;

    if (releases.length === 0) {
      printInfo('No releases found');
      return;
    }

    printHeader(`Releases (${pagination.total} total)`);

    for (const release of releases) {
      const icon = typeIcons[release.type] || '📁';
      const colorFn = statusColors[release.status] || chalk.white;
      const resolution = release.mediaInfo 
        ? `${release.mediaInfo.videoWidth}x${release.mediaInfo.videoHeight}`
        : '';
      const codec = release.mediaInfo?.videoCodec || '';

      console.log(
        `${icon} ${chalk.cyan(release.id.slice(0, 8))} ` +
        `${colorFn(release.status.padEnd(12))} ` +
        `${release.releaseName.slice(0, 50).padEnd(50)} ` +
        `${chalk.gray(resolution.padEnd(12))} ` +
        `${chalk.gray(codec)}`
      );
    }

    if (pagination.hasMore) {
      console.log();
      printInfo(`Showing ${releases.length} of ${pagination.total}. Use -n to see more.`);
    }
  } catch (error) {
    spinner.fail('Failed to fetch releases');
    printError(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

export async function releaseCommand(
  id: string,
  options: ReleaseOptions
): Promise<void> {
  const spinner = ora('Fetching release...').start();

  try {
    const response = await apiClient.get<ReleaseResponse>(`/api/v1/media/releases/${id}`);
    spinner.stop();

    const { release } = response;

    printHeader(`Release: ${release.releaseName}`);

    printKeyValue('ID', release.id);
    printKeyValue('Title', release.title || 'N/A');
    printKeyValue('Type', release.type);
    printKeyValue('Status', release.status);
    printKeyValue('Created', new Date(release.createdAt).toLocaleString());

    if (release.mediaInfo) {
      console.log();
      console.log(chalk.bold('Media Info:'));
      printKeyValue('Format', release.mediaInfo.format);
      printKeyValue('Duration', formatDuration(release.mediaInfo.duration));
      if (release.mediaInfo.videoCodec) {
        printKeyValue('Video', `${release.mediaInfo.videoCodec} ${release.mediaInfo.videoWidth}x${release.mediaInfo.videoHeight}`);
      }
    }

    if (options.verbose && release.sourceFile) {
      console.log();
      console.log(chalk.bold('Source File:'));
      printKeyValue('Path', release.sourceFile.path);
      printKeyValue('Size', formatBytes(release.sourceFile.size));
    }

    if (options.verbose && release.outputFile) {
      console.log();
      console.log(chalk.bold('Output File:'));
      printKeyValue('Path', release.outputFile.path);
      printKeyValue('Size', formatBytes(release.outputFile.size));
    }

    if (release.jobs && release.jobs.length > 0) {
      console.log();
      console.log(chalk.bold('Recent Jobs:'));
      for (const job of release.jobs.slice(0, 5)) {
        const colorFn = statusColors[job.status] || chalk.white;
        console.log(
          `  ${chalk.gray(job.id.slice(0, 8))} ` +
          `${job.type.padEnd(10)} ` +
          `${colorFn(job.status)}`
        );
      }
    }
  } catch (error) {
    spinner.fail('Failed to fetch release');
    printError(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
