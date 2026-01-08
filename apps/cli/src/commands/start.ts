/**
 * Start Command
 * 
 * Initializes connection to API and shows system status.
 */

import ora from 'ora';
import chalk from 'chalk';
import { apiClient } from '../lib/apiClient.js';
import { printSuccess, printError, printHeader, printKeyValue, printInfo, printWarning } from '../lib/output.js';
import { config } from '../config/index.js';

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version?: string;
  timestamp: string;
}

export async function startCommand(): Promise<void> {
  printHeader('Media-Bot System Status');
  
  printKeyValue('API URL', config.apiUrl);
  printKeyValue('Authenticated', apiClient.isAuthenticated() ? chalk.green('Yes') : chalk.yellow('No'));
  console.log();

  const spinner = ora('Connecting to API...').start();

  try {
    const response = await apiClient.get<HealthResponse>('/api/v1/system/health');
    
    spinner.succeed('Connected to API');
    
    const statusColor = response.status === 'healthy' 
      ? chalk.green 
      : response.status === 'degraded' 
        ? chalk.yellow 
        : chalk.red;
    
    printKeyValue('Status', statusColor(response.status));
    if (response.version) {
      printKeyValue('Version', response.version);
    }
    printKeyValue('Timestamp', new Date(response.timestamp).toLocaleString());
    
    console.log();
    
    if (response.status === 'healthy') {
      printSuccess('System is ready');
    } else if (response.status === 'degraded') {
      printWarning('System is running with degraded performance');
    } else {
      printError('System is experiencing issues');
    }

    if (!apiClient.isAuthenticated()) {
      console.log();
      printInfo('Run "media-bot login" to authenticate');
    }
  } catch (error) {
    spinner.fail('Failed to connect to API');
    printError(error instanceof Error ? error.message : 'Unknown error');
    
    console.log();
    console.log(chalk.gray('Troubleshooting:'));
    console.log(chalk.gray('  1. Check if the API server is running'));
    console.log(chalk.gray('  2. Verify the API URL: media-bot config apiUrl'));
    console.log(chalk.gray('  3. Check network connectivity'));
    
    process.exit(1);
  }
}
