/**
 * Config Command
 * 
 * View and manage CLI configuration.
 */

import chalk from 'chalk';
import { config, saveConfig } from '../config/index.js';
import { printError, printHeader, printKeyValue, printSuccess, printInfo } from '../lib/output.js';

type ConfigAction = 'get' | 'set' | 'list' | 'reset';

interface ConfigOptions {
  action: ConfigAction;
}

const configKeys = ['apiUrl', 'apiKey', 'timeout'] as const;
type ConfigKey = typeof configKeys[number];

const configDescriptions: Record<ConfigKey, string> = {
  apiUrl: 'Base URL for the API server',
  apiKey: 'API key for authentication (alternative to JWT)',
  timeout: 'Request timeout in milliseconds',
};

export async function configCommand(
  key?: string,
  value?: string,
  options?: ConfigOptions
): Promise<void> {
  // Determine action from arguments
  const action = options?.action || determineAction(key, value);

  switch (action) {
    case 'list':
      listConfig();
      break;
    case 'get':
      if (!key) {
        listConfig();
      } else {
        getConfig(key);
      }
      break;
    case 'set':
      if (!key || value === undefined) {
        printError('Usage: media-bot config set <key> <value>');
        process.exit(1);
      }
      setConfig(key, value);
      break;
    case 'reset':
      resetConfig();
      break;
    default:
      listConfig();
  }
}

function determineAction(key?: string, value?: string): ConfigAction {
  if (!key) return 'list';
  if (value !== undefined) return 'set';
  return 'get';
}

function listConfig(): void {
  printHeader('CLI Configuration');

  for (const key of configKeys) {
    const value = config[key as keyof typeof config];
    const description = configDescriptions[key];
    
    if (key === 'apiKey' && value) {
      // Mask API key
      const masked = (value as string).slice(0, 4) + '****' + (value as string).slice(-4);
      console.log(`${chalk.cyan(key)}: ${masked}`);
    } else {
      console.log(`${chalk.cyan(key)}: ${value ?? chalk.gray('not set')}`);
    }
    console.log(`  ${chalk.gray(description)}`);
    console.log();
  }

  console.log(chalk.gray('Use "media-bot config <key> <value>" to set a value'));
}

function getConfig(key: string): void {
  if (!isValidKey(key)) {
    printError(`Unknown config key: ${key}`);
    console.log(chalk.gray(`Valid keys: ${configKeys.join(', ')}`));
    process.exit(1);
  }

  const value = config[key as keyof typeof config];
  
  if (key === 'apiKey' && value) {
    // Mask API key
    const masked = (value as string).slice(0, 4) + '****' + (value as string).slice(-4);
    printKeyValue(key, masked);
  } else {
    printKeyValue(key, value?.toString() ?? 'not set');
  }
}

function setConfig(key: string, value: string): void {
  if (!isValidKey(key)) {
    printError(`Unknown config key: ${key}`);
    console.log(chalk.gray(`Valid keys: ${configKeys.join(', ')}`));
    process.exit(1);
  }

  // Validate and convert value
  let convertedValue: string | number | undefined;

  switch (key) {
    case 'apiUrl':
      if (!value.startsWith('http://') && !value.startsWith('https://')) {
        printError('API URL must start with http:// or https://');
        process.exit(1);
      }
      convertedValue = value;
      break;
    case 'apiKey':
      convertedValue = value;
      break;
    case 'timeout':
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 0) {
        printError('Timeout must be a positive number');
        process.exit(1);
      }
      convertedValue = num;
      break;
  }

  // Update config
  const newConfig = { ...config };
  (newConfig as Record<string, unknown>)[key] = convertedValue;
  
  saveConfig({
    apiUrl: newConfig.apiUrl,
    apiKey: newConfig.apiKey,
    timeout: newConfig.timeout,
  });

  printSuccess(`Set ${key} = ${key === 'apiKey' ? '****' : value}`);
}

function resetConfig(): void {
  saveConfig({});
  printSuccess('Configuration reset to defaults');
  printInfo('API URL: http://localhost:3000');
  printInfo('Timeout: 30000ms');
}

function isValidKey(key: string): key is ConfigKey {
  return configKeys.includes(key as ConfigKey);
}
