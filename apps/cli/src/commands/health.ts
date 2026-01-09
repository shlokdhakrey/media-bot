/**
 * Health Command
 * 
 * Check system health status.
 */

import ora from 'ora';
import chalk from 'chalk';
import { apiClient } from '../lib/apiClient.js';
import { printError, printHeader, printKeyValue, printSuccess, printWarning } from '../lib/output.js';

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  components: {
    database: ComponentHealth;
    redis: ComponentHealth;
    worker: ComponentHealth;
    storage: ComponentHealth;
  };
}

interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency?: number;
  message?: string;
  details?: Record<string, unknown>;
}

const statusIcons: Record<string, string> = {
  healthy: '[OK]',
  degraded: '[WARN]',
  unhealthy: '[ERR]',
};

const statusColors: Record<string, (text: string) => string> = {
  healthy: chalk.green,
  degraded: chalk.yellow,
  unhealthy: chalk.red,
};

export async function healthCommand(): Promise<void> {
  const spinner = ora('Checking system health...').start();

  try {
    const response = await apiClient.get<HealthResponse>('/api/v1/system/health');
    spinner.stop();

    const { status, timestamp, uptime, version, components } = response;

    const icon = statusIcons[status] ?? '[?]';
    const color = statusColors[status] ?? chalk.white;

    printHeader(`System Health: ${icon} ${color(status.toUpperCase())}`);

    printKeyValue('Version', version);
    printKeyValue('Uptime', formatUptime(uptime));
    printKeyValue('Checked', new Date(timestamp).toLocaleString());

    console.log();
    console.log(chalk.bold('Components:'));

    // Display each component
    displayComponent('Database', components.database);
    displayComponent('Redis', components.redis);
    displayComponent('Worker', components.worker);
    displayComponent('Storage', components.storage);

    console.log();

    if (status === 'healthy') {
      printSuccess('All systems operational');
    } else if (status === 'degraded') {
      printWarning('System is running with degraded performance');
    } else {
      printError('System is experiencing issues');
    }

  } catch (error) {
    spinner.fail('Health check failed');
    
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      printError('Unable to connect to API server');
      console.log(chalk.gray('Make sure the server is running: media-bot start'));
    } else {
      printError(error instanceof Error ? error.message : 'Unknown error');
    }
    
    process.exit(1);
  }
}

function displayComponent(name: string, component: ComponentHealth): void {
  const icon = statusIcons[component.status] ?? '[?]';
  const color = statusColors[component.status] ?? chalk.white;
  const latency = component.latency !== undefined ? `${component.latency}ms` : '';
  
  console.log(
    `  ${icon} ${name.padEnd(12)} ${color(component.status.padEnd(10))} ` +
    chalk.gray(latency)
  );
  
  if (component.message) {
    console.log(`     ${chalk.gray(component.message)}`);
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${Math.floor(seconds)}s`);
  
  return parts.join(' ');
}
