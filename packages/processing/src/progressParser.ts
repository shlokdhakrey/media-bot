/**
 * Progress Parser
 * 
 * Advanced FFmpeg progress parsing with ETA calculation,
 * file size estimation, and statistics.
 */

import { EventEmitter } from 'node:events';

export interface ProgressStats {
  frame: number;
  fps: number;
  q: number;  // Quality factor
  size: number;  // Bytes
  time: number;  // Milliseconds
  bitrate: number;  // kbps
  speed: number;  // x realtime
  dup: number;  // Duplicate frames
  drop: number;  // Dropped frames
}

export interface ProgressEstimate {
  progress: number;  // 0-100
  timeElapsed: number;  // ms
  timeRemaining: number;  // ms
  eta: Date | null;
  estimatedSize: number;  // bytes
  avgFps: number;
  avgSpeed: number;
  avgBitrate: number;  // kbps
}

export interface ProgressEvent {
  stats: ProgressStats;
  estimate: ProgressEstimate;
  rawLine: string;
  phase: 'starting' | 'running' | 'finalizing' | 'complete';
}

export class FFmpegProgressParser extends EventEmitter {
  private durationMs: number;
  private startTime: Date;
  
  // Current stats
  private current: ProgressStats = {
    frame: 0,
    fps: 0,
    q: 0,
    size: 0,
    time: 0,
    bitrate: 0,
    speed: 0,
    dup: 0,
    drop: 0,
  };

  // History for averaging
  private fpsHistory: number[] = [];
  private speedHistory: number[] = [];
  private bitrateHistory: number[] = [];
  private readonly historySize = 10;

  // State
  private buffer = '';
  private phase: 'starting' | 'running' | 'finalizing' | 'complete' = 'starting';

  constructor(durationMs: number) {
    super();
    this.durationMs = durationMs;
    this.startTime = new Date();
  }

  /**
   * Reset the parser state
   */
  reset(): void {
    this.startTime = new Date();
    this.current = {
      frame: 0,
      fps: 0,
      q: 0,
      size: 0,
      time: 0,
      bitrate: 0,
      speed: 0,
      dup: 0,
      drop: 0,
    };
    this.fpsHistory = [];
    this.speedHistory = [];
    this.bitrateHistory = [];
    this.buffer = '';
    this.phase = 'starting';
  }

  /**
   * Parse progress data from FFmpeg -progress pipe:1
   */
  parseProgressData(data: string): void {
    this.buffer += data;
    
    // Process complete lines
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    
    for (const line of lines) {
      this.parseProgressLine(line.trim());
    }
  }

  /**
   * Parse stderr line (traditional progress format)
   */
  parseStderrLine(line: string): ProgressEvent | null {
    // Match standard FFmpeg progress line
    // frame= 1000 fps=24.5 q=28.0 size=   1234kB time=00:00:42.00 bitrate= 240.5kbits/s dup=0 drop=0 speed=2.01x
    const match = line.match(
      /frame=\s*(\d+)\s+fps=\s*([\d.]+)\s+q=\s*([\d.-]+)\s+.*size=\s*([\d.]+)(\w+)\s+time=\s*([\d:.]+)\s+bitrate=\s*([\d.]+)(\w+)\/s.*speed=\s*([\d.]+)x/
    );

    if (!match) {
      // Try alternate format
      return this.parseAlternateFormat(line);
    }

    const [, frame, fps, q, sizeNum, sizeUnit, time, bitrateNum, bitrateUnit, speed] = match;

    // Parse size
    const size = this.parseSize(parseFloat(sizeNum ?? '0'), sizeUnit ?? 'B');

    // Parse bitrate
    const bitrate = this.parseBitrate(parseFloat(bitrateNum ?? '0'), bitrateUnit ?? 'kbits');

    // Parse time to ms
    const timeMs = this.parseTime(time ?? '00:00:00');

    // Update current stats
    this.current = {
      frame: parseInt(frame ?? '0', 10),
      fps: parseFloat(fps ?? '0'),
      q: parseFloat(q ?? '0'),
      size,
      time: timeMs,
      bitrate,
      speed: parseFloat(speed ?? '0'),
      dup: 0,
      drop: 0,
    };

    // Parse dup/drop if present
    const dupMatch = line.match(/dup=\s*(\d+)/);
    const dropMatch = line.match(/drop=\s*(\d+)/);
    if (dupMatch) this.current.dup = parseInt(dupMatch[1] ?? '0', 10);
    if (dropMatch) this.current.drop = parseInt(dropMatch[1] ?? '0', 10);

    this.updatePhase();
    this.updateHistory();

    return this.createProgressEvent(line);
  }

  /**
   * Get current progress
   */
  getCurrentProgress(): ProgressEvent | null {
    if (this.current.time === 0) return null;
    return this.createProgressEvent('');
  }

  /**
   * Mark as complete
   */
  complete(): void {
    this.phase = 'complete';
    const event = this.createProgressEvent('progress=end');
    event.estimate.progress = 100;
    this.emit('progress', event);
    this.emit('complete', event);
  }

  // Private methods

  private parseProgressLine(line: string): void {
    const match = line.match(/^(\w+)=(.+)$/);
    if (!match) return;

    const [, key, value] = match;

    switch (key) {
      case 'frame':
        this.current.frame = parseInt(value ?? '0', 10);
        break;
      case 'fps':
        this.current.fps = parseFloat(value ?? '0');
        break;
      case 'bitrate':
        this.current.bitrate = this.parseBitrateString(value ?? '0');
        break;
      case 'total_size':
        this.current.size = parseInt(value ?? '0', 10);
        break;
      case 'out_time_ms':
        this.current.time = parseInt(value ?? '0', 10) / 1000;
        break;
      case 'speed':
        this.current.speed = parseFloat((value ?? '0').replace('x', ''));
        break;
      case 'dup_frames':
        this.current.dup = parseInt(value ?? '0', 10);
        break;
      case 'drop_frames':
        this.current.drop = parseInt(value ?? '0', 10);
        break;
      case 'progress':
        this.updatePhase();
        this.updateHistory();
        
        const event = this.createProgressEvent(line);
        this.emit('progress', event);
        
        if (value === 'end') {
          this.phase = 'complete';
          this.emit('complete', event);
        }
        break;
    }
  }

  private parseAlternateFormat(line: string): ProgressEvent | null {
    // Simpler format without all fields
    const match = line.match(/frame=\s*(\d+).*fps=\s*([\d.]+).*time=\s*([\d:.]+)/);
    if (!match) return null;

    const [, frame, fps, time] = match;
    this.current.frame = parseInt(frame ?? '0', 10);
    this.current.fps = parseFloat(fps ?? '0');
    this.current.time = this.parseTime(time ?? '00:00:00');

    this.updatePhase();
    this.updateHistory();

    return this.createProgressEvent(line);
  }

  private parseSize(num: number, unit: string): number {
    const multipliers: Record<string, number> = {
      'B': 1,
      'kB': 1024,
      'KB': 1024,
      'mB': 1024 * 1024,
      'MB': 1024 * 1024,
      'gB': 1024 * 1024 * 1024,
      'GB': 1024 * 1024 * 1024,
    };
    return num * (multipliers[unit] ?? 1);
  }

  private parseBitrate(num: number, unit: string): number {
    if (unit.toLowerCase().includes('m')) {
      return num * 1000;  // Mbps to kbps
    }
    return num;  // Already kbps
  }

  private parseBitrateString(str: string): number {
    const match = str.match(/([\d.]+)(\w+)/);
    if (!match) return 0;
    
    const [, num, unit] = match;
    return this.parseBitrate(parseFloat(num ?? '0'), unit ?? 'kbits');
  }

  private parseTime(time: string): number {
    const parts = time.split(':');
    if (parts.length !== 3) return 0;

    const [hours, minutes, seconds] = parts.map(p => parseFloat(p ?? '0'));
    return ((hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0)) * 1000;
  }

  private updatePhase(): void {
    if (this.durationMs <= 0) {
      this.phase = 'running';
      return;
    }

    const progress = (this.current.time / this.durationMs) * 100;
    
    if (progress < 5) {
      this.phase = 'starting';
    } else if (progress > 95) {
      this.phase = 'finalizing';
    } else {
      this.phase = 'running';
    }
  }

  private updateHistory(): void {
    if (this.current.fps > 0) {
      this.fpsHistory.push(this.current.fps);
      if (this.fpsHistory.length > this.historySize) {
        this.fpsHistory.shift();
      }
    }

    if (this.current.speed > 0) {
      this.speedHistory.push(this.current.speed);
      if (this.speedHistory.length > this.historySize) {
        this.speedHistory.shift();
      }
    }

    if (this.current.bitrate > 0) {
      this.bitrateHistory.push(this.current.bitrate);
      if (this.bitrateHistory.length > this.historySize) {
        this.bitrateHistory.shift();
      }
    }
  }

  private average(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private createProgressEvent(rawLine: string): ProgressEvent {
    const timeElapsed = Date.now() - this.startTime.getTime();
    
    // Calculate progress
    let progress = 0;
    if (this.durationMs > 0) {
      progress = Math.min(100, (this.current.time / this.durationMs) * 100);
    }

    // Calculate time remaining
    let timeRemaining = Infinity;
    let eta: Date | null = null;
    
    if (progress > 0 && this.current.speed > 0) {
      const remainingMs = this.durationMs - this.current.time;
      timeRemaining = remainingMs / this.current.speed;
      eta = new Date(Date.now() + timeRemaining);
    }

    // Estimate final size
    let estimatedSize = 0;
    if (progress > 0 && this.current.size > 0) {
      estimatedSize = (this.current.size / progress) * 100;
    }

    const estimate: ProgressEstimate = {
      progress,
      timeElapsed,
      timeRemaining,
      eta,
      estimatedSize,
      avgFps: this.average(this.fpsHistory),
      avgSpeed: this.average(this.speedHistory),
      avgBitrate: this.average(this.bitrateHistory),
    };

    return {
      stats: { ...this.current },
      estimate,
      rawLine,
      phase: this.phase,
    };
  }
}

/**
 * Parse a single progress line
 */
export function parseProgressLine(
  line: string,
  durationMs: number = 0
): ProgressStats | null {
  const parser = new FFmpegProgressParser(durationMs);
  const event = parser.parseStderrLine(line);
  return event?.stats ?? null;
}

/**
 * Format progress for display
 */
export function formatProgress(event: ProgressEvent): string {
  const { stats, estimate } = event;
  
  const parts: string[] = [];
  
  // Progress percentage
  parts.push(`${estimate.progress.toFixed(1)}%`);
  
  // Frame count
  if (stats.frame > 0) {
    parts.push(`frame ${stats.frame}`);
  }
  
  // FPS
  if (stats.fps > 0) {
    parts.push(`${stats.fps.toFixed(1)} fps`);
  }
  
  // Speed
  if (stats.speed > 0) {
    parts.push(`${stats.speed.toFixed(2)}x`);
  }
  
  // Size
  if (stats.size > 0) {
    parts.push(formatBytes(stats.size));
  }
  
  // ETA
  if (estimate.eta && estimate.timeRemaining < Infinity) {
    parts.push(`ETA: ${formatDuration(estimate.timeRemaining)}`);
  }
  
  return parts.join(' | ');
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  
  return `${size.toFixed(2)} ${units[i]}`;
}

/**
 * Format duration in ms to human readable
 */
export function formatDuration(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '--:--';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Format time in ms to FFmpeg time format (HH:MM:SS.mmm)
 */
export function formatFFmpegTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;
}

/**
 * Parse FFmpeg time format to ms
 */
export function parseFFmpegTime(time: string): number {
  const parts = time.split(':');
  if (parts.length !== 3) return 0;
  
  const [hours, minutes, seconds] = parts.map(p => parseFloat(p ?? '0'));
  return ((hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0)) * 1000;
}