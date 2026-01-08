/**
 * Authentication Commands
 * 
 * Login, logout, and user info commands.
 */

import ora from 'ora';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { apiClient } from '../lib/apiClient.js';
import { printSuccess, printError, printKeyValue, printHeader } from '../lib/output.js';
import { clearTokens, getValidToken } from '../config/index.js';

interface LoginOptions {
  username?: string;
  password?: string;
}

interface UserInfo {
  username: string;
  role: string;
  createdAt: string;
}

/**
 * Prompt for input
 */
async function prompt(question: string, hidden = false): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (hidden) {
      process.stdout.write(question);
      let input = '';
      
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', (char) => {
        const c = char.toString();
        if (c === '\n' || c === '\r') {
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          rl.close();
          resolve(input);
        } else if (c === '\u0003') {
          process.exit();
        } else if (c === '\u007F') {
          input = input.slice(0, -1);
        } else {
          input += c;
        }
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Login command
 */
export async function loginCommand(options: LoginOptions): Promise<void> {
  printHeader('Login to Media-Bot');

  // Get credentials
  let username = options.username;
  let password = options.password;

  if (!username) {
    username = await prompt('Username: ');
  }
  
  if (!password) {
    password = await prompt('Password: ', true);
  }

  if (!username || !password) {
    printError('Username and password are required');
    process.exit(1);
  }

  const spinner = ora('Authenticating...').start();

  try {
    const success = await apiClient.login(username, password);

    if (success) {
      spinner.succeed('Login successful');
      printSuccess(`Logged in as ${chalk.bold(username)}`);
    } else {
      spinner.fail('Login failed');
      printError('Invalid username or password');
      process.exit(1);
    }
  } catch (error) {
    spinner.fail('Login failed');
    printError(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

/**
 * Logout command
 */
export async function logoutCommand(): Promise<void> {
  const spinner = ora('Logging out...').start();

  try {
    await apiClient.logout();
    spinner.succeed('Logged out successfully');
  } catch (error) {
    // Clear tokens even if API call fails
    clearTokens();
    spinner.succeed('Logged out (locally)');
  }
}

/**
 * Whoami command
 */
export async function whoamiCommand(): Promise<void> {
  const spinner = ora('Checking authentication...').start();

  // Check if we have a valid token
  const token = getValidToken();
  
  if (!token && !apiClient.isAuthenticated()) {
    spinner.fail('Not logged in');
    printError('Run `media-bot login` to authenticate');
    process.exit(1);
  }

  try {
    const user = await apiClient.get<UserInfo>('/api/v1/auth/me');
    spinner.stop();

    printHeader('Current User');
    printKeyValue('Username', user.username);
    printKeyValue('Role', user.role);
    printKeyValue('Created', new Date(user.createdAt).toLocaleString());
  } catch (error) {
    spinner.fail('Failed to get user info');
    printError(error instanceof Error ? error.message : 'Unknown error');
    printError('You may need to login again: `media-bot login`');
    process.exit(1);
  }
}
