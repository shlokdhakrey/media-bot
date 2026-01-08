/**
 * Analyze Command
 * 
 * Analyze a media file.
 */

import ora from 'ora';
import chalk from 'chalk';
import { apiClient } from '../lib/apiClient.js';
import { printError, printHeader, printKeyValue, printSuccess } from '../lib/output.js';

interface AnalyzeOptions {
  save?: boolean;
}

interface AnalysisResult {
  analysis: {
    format?: {
      formatName: string;
      duration: number;
      bitrate: number;
      size: number;
    };
    video?: Array<{
      codec: string;
      width: number;
      height: number;
      frameRate: number;
      bitrate?: number;
    }>;
    audio?: Array<{
      codec: string;
      channels: number;
      sampleRate: number;
      language?: string;
    }>;
    subtitles?: Array<{
      codec: string;
      language?: string;
      title?: string;
    }>;
  };
}

export async function analyzeCommand(
  path: string,
  options: AnalyzeOptions
): Promise<void> {
  const spinner = ora('Analyzing media file...').start();

  try {
    const response = await apiClient.post<AnalysisResult>('/api/v1/media/analyze', {
      path,
      save: options.save,
    });

    spinner.stop();
    const { analysis } = response;

    printHeader('Media Analysis');
    printKeyValue('File', path);
    console.log();

    // Format info
    if (analysis.format) {
      console.log(chalk.bold('Container:'));
      printKeyValue('Format', analysis.format.formatName);
      printKeyValue('Duration', formatDuration(analysis.format.duration));
      printKeyValue('Bitrate', `${Math.round(analysis.format.bitrate / 1000)} kbps`);
      printKeyValue('Size', formatBytes(analysis.format.size));
      console.log();
    }

    // Video tracks
    if (analysis.video && analysis.video.length > 0) {
      console.log(chalk.bold(`Video Tracks (${analysis.video.length}):`));
      for (let i = 0; i < analysis.video.length; i++) {
        const v = analysis.video[i]!;
        console.log(
          `  ${chalk.cyan(`#${i}`)} ${v.codec} ` +
          `${v.width}x${v.height} @ ${v.frameRate.toFixed(2)} fps` +
          (v.bitrate ? ` (${Math.round(v.bitrate / 1000)} kbps)` : '')
        );
      }
      console.log();
    }

    // Audio tracks
    if (analysis.audio && analysis.audio.length > 0) {
      console.log(chalk.bold(`Audio Tracks (${analysis.audio.length}):`));
      for (let i = 0; i < analysis.audio.length; i++) {
        const a = analysis.audio[i]!;
        console.log(
          `  ${chalk.cyan(`#${i}`)} ${a.codec} ` +
          `${a.channels}ch @ ${a.sampleRate} Hz` +
          (a.language ? ` [${a.language}]` : '')
        );
      }
      console.log();
    }

    // Subtitle tracks
    if (analysis.subtitles && analysis.subtitles.length > 0) {
      console.log(chalk.bold(`Subtitle Tracks (${analysis.subtitles.length}):`));
      for (let i = 0; i < analysis.subtitles.length; i++) {
        const s = analysis.subtitles[i]!;
        console.log(
          `  ${chalk.cyan(`#${i}`)} ${s.codec}` +
          (s.language ? ` [${s.language}]` : '') +
          (s.title ? ` "${s.title}"` : '')
        );
      }
      console.log();
    }

    if (options.save) {
      printSuccess('Analysis saved to database');
    }
  } catch (error) {
    spinner.fail('Analysis failed');
    printError(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
