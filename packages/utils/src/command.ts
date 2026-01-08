/**
 * Command Execution Wrapper
 * 
 * Safe wrapper for executing external commands with:
 * - Timeout handling
 * - Output capture
 * - Error handling
 * - Signal forwarding
 */

import { spawn, SpawnOptions } from 'node:child_process';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timedOut: boolean;
}

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number; // milliseconds
  maxOutputSize?: number; // bytes
  signal?: AbortSignal;
}

/**
 * Execute an external command safely
 * 
 * @param command - The command to execute
 * @param args - Command arguments
 * @param options - Execution options
 * @returns Promise resolving to CommandResult
 */
export async function executeCommand(
  command: string,
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  const {
    cwd = process.cwd(),
    env = process.env as Record<string, string>,
    timeout = 300000, // 5 minutes default
    maxOutputSize = 10 * 1024 * 1024, // 10MB default
    signal,
  } = options;

  const startTime = Date.now();
  let timedOut = false;

  return new Promise((resolve, reject) => {
    const spawnOptions: SpawnOptions = {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    };

    const child = spawn(command, args, spawnOptions);

    let stdout = '';
    let stderr = '';
    let stdoutSize = 0;
    let stderrSize = 0;

    // Handle timeout
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Force kill after 10 seconds
      setTimeout(() => child.kill('SIGKILL'), 10000);
    }, timeout);

    // Handle abort signal
    if (signal) {
      signal.addEventListener('abort', () => {
        child.kill('SIGTERM');
      });
    }

    // Capture stdout with size limit
    child.stdout?.on('data', (data: Buffer) => {
      if (stdoutSize < maxOutputSize) {
        const chunk = data.toString();
        stdout += chunk;
        stdoutSize += data.length;
      }
    });

    // Capture stderr with size limit
    child.stderr?.on('data', (data: Buffer) => {
      if (stderrSize < maxOutputSize) {
        const chunk = data.toString();
        stderr += chunk;
        stderrSize += data.length;
      }
    });

    // Handle process exit
    child.on('close', (code, signal) => {
      clearTimeout(timeoutId);
      
      resolve({
        exitCode: code ?? (signal ? 128 : 1),
        stdout,
        stderr,
        duration: Date.now() - startTime,
        timedOut,
      });
    });

    // Handle spawn errors
    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

/**
 * Execute a shell command string (simpler interface)
 * 
 * @param cmd - Shell command string to execute
 * @param options - Execution options
 * @returns Promise resolving to stdout string
 */
export async function execAsync(
  cmd: string,
  options: CommandOptions = {}
): Promise<string> {
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'cmd' : 'sh';
  const shellArg = isWindows ? '/c' : '-c';
  
  const result = await executeCommand(shell, [shellArg, cmd], {
    timeout: 3600000, // 1 hour for media processing
    ...options,
  });
  
  if (result.exitCode !== 0) {
    const error = new Error(`Command failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`);
    (error as any).exitCode = result.exitCode;
    (error as any).stderr = result.stderr;
    (error as any).stdout = result.stdout;
    throw error;
  }
  
  return result.stdout;
}

/**
 * Execute ffmpeg command with proper argument handling
 * 
 * @param args - Array of ffmpeg arguments (NOT including 'ffmpeg')
 * @param options - Execution options
 * @returns Promise resolving to CommandResult
 */
export async function execFFmpeg(
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  const result = await executeCommand('ffmpeg', args, {
    timeout: 3600000, // 1 hour for media processing
    ...options,
  });
  
  if (result.exitCode !== 0) {
    const error = new Error(`FFmpeg failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`);
    (error as any).exitCode = result.exitCode;
    (error as any).stderr = result.stderr;
    (error as any).stdout = result.stdout;
    throw error;
  }
  
  return result;
}

/**
 * Execute mkvmerge command with proper argument handling
 * 
 * @param args - Array of mkvmerge arguments (NOT including 'mkvmerge')
 * @param options - Execution options
 * @returns Promise resolving to CommandResult
 */
export async function execMkvmerge(
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  const result = await executeCommand('mkvmerge', args, {
    timeout: 3600000, // 1 hour for media processing
    ...options,
  });
  
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    // mkvmerge returns 1 for warnings, 2 for errors
    const error = new Error(`mkvmerge failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`);
    (error as any).exitCode = result.exitCode;
    (error as any).stderr = result.stderr;
    (error as any).stdout = result.stdout;
    throw error;
  }
  
  return result;
}
