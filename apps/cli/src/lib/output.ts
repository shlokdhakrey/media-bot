/**
 * Output Formatter
 * 
 * Consistent CLI output formatting.
 */

import chalk from 'chalk';

export function printSuccess(message: string): void {
  console.log(chalk.green('✓'), message);
}

export function printError(message: string): void {
  console.error(chalk.red('✗'), message);
}

export function printWarning(message: string): void {
  console.warn(chalk.yellow('!'), message);
}

export function printInfo(message: string): void {
  console.log(chalk.blue('i'), message);
}

export function printTable(data: Record<string, unknown>[]): void {
  if (data.length === 0) {
    printInfo('No data to display');
    return;
  }
  console.table(data);
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printHeader(title: string): void {
  console.log();
  console.log(chalk.bold.underline(title));
  console.log();
}

export function printKeyValue(key: string, value: unknown): void {
  console.log(`  ${chalk.gray(key + ':')} ${value}`);
}
