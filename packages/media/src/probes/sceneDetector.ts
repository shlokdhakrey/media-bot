/**
 * Scene Detector
 * 
 * Uses FFmpeg's scene detection filter to find scene changes.
 * Useful for:
 * - Chapter generation
 * - Thumbnail extraction
 * - Quality analysis
 * - Sync verification (scene changes should align)
 */

import { executeCommand, logger } from '@media-bot/utils';

export interface SceneChange {
  timestamp: number; // seconds
  frame: number;
  score: number; // 0-1, higher = more significant change
}

export interface SceneDetectionResult {
  scenes: SceneChange[];
  totalFrames: number;
  duration: number;
  averageSceneDuration: number;
  minSceneDuration: number;
  maxSceneDuration: number;
}

export interface SceneDetectorOptions {
  /** Threshold for scene detection (0-1, default 0.3) */
  threshold?: number;
  /** FFmpeg path */
  ffmpegPath?: string;
  /** FFprobe path */
  ffprobePath?: string;
  /** Timeout in ms */
  timeout?: number;
}

export class SceneDetector {
  private ffmpegPath: string;
  private ffprobePath: string;
  private defaultThreshold: number;
  private timeout: number;

  constructor(options: SceneDetectorOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    this.ffprobePath = options.ffprobePath ?? 'ffprobe';
    this.defaultThreshold = options.threshold ?? 0.3;
    this.timeout = options.timeout ?? 600000; // 10 minutes
  }

  /**
   * Detect scene changes in a video file
   */
  async detect(
    filePath: string,
    options: { threshold?: number; maxScenes?: number } = {}
  ): Promise<SceneDetectionResult> {
    const threshold = options.threshold ?? this.defaultThreshold;
    const maxScenes = options.maxScenes ?? 1000;

    logger.info({ filePath, threshold }, 'Starting scene detection');

    // Get video duration and frame count first
    const videoInfo = await this.getVideoInfo(filePath);

    // Run scene detection
    const scenes = await this.runSceneDetection(filePath, threshold, maxScenes);

    // Calculate statistics
    const sceneDurations = this.calculateSceneDurations(scenes, videoInfo.duration);

    const result: SceneDetectionResult = {
      scenes,
      totalFrames: videoInfo.totalFrames,
      duration: videoInfo.duration,
      averageSceneDuration: sceneDurations.length > 0 
        ? sceneDurations.reduce((a, b) => a + b, 0) / sceneDurations.length 
        : videoInfo.duration,
      minSceneDuration: sceneDurations.length > 0 
        ? Math.min(...sceneDurations) 
        : videoInfo.duration,
      maxSceneDuration: sceneDurations.length > 0 
        ? Math.max(...sceneDurations) 
        : videoInfo.duration,
    };

    logger.info({ 
      filePath, 
      sceneCount: scenes.length,
      avgDuration: result.averageSceneDuration.toFixed(2),
    }, 'Scene detection complete');

    return result;
  }

  /**
   * Get video info (duration, frame count)
   */
  private async getVideoInfo(filePath: string): Promise<{
    duration: number;
    totalFrames: number;
    fps: number;
  }> {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-count_frames',
      '-show_entries', 'stream=nb_read_frames,r_frame_rate,duration',
      '-of', 'json',
      filePath,
    ];

    const result = await executeCommand(this.ffprobePath, args, {
      timeout: this.timeout,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Failed to get video info: ${result.stderr}`);
    }

    const data = JSON.parse(result.stdout);
    const stream = data.streams?.[0];

    if (!stream) {
      throw new Error('No video stream found');
    }

    // Parse frame rate
    const fpsStr = stream.r_frame_rate ?? '24/1';
    const [num, den] = fpsStr.split('/').map((s: string) => parseInt(s, 10));
    const fps = den === 0 ? 24 : num / den;

    // Duration - may need to be calculated
    let duration = parseFloat(stream.duration ?? '0');
    const totalFrames = parseInt(stream.nb_read_frames ?? '0', 10);

    if (duration === 0 && totalFrames > 0) {
      duration = totalFrames / fps;
    }

    return { duration, totalFrames, fps };
  }

  /**
   * Run FFmpeg scene detection filter
   */
  private async runSceneDetection(
    filePath: string,
    threshold: number,
    maxScenes: number
  ): Promise<SceneChange[]> {
    // Use select filter with scene detection
    const filterComplex = `select='gt(scene,${threshold})',showinfo`;

    const args = [
      '-i', filePath,
      '-vf', filterComplex,
      '-f', 'null',
      '-',
    ];

    const result = await executeCommand(this.ffmpegPath, args, {
      timeout: this.timeout,
    });

    // Scene detection output is in stderr
    return this.parseSceneOutput(result.stderr, maxScenes);
  }

  /**
   * Parse scene detection output from FFmpeg
   */
  private parseSceneOutput(stderr: string, maxScenes: number): SceneChange[] {
    const scenes: SceneChange[] = [];

    // Pattern: [Parsed_showinfo_1 @ 0x...] n:   1 pts:   1001 pts_time:0.041708
    const pattern = /n:\s*(\d+)\s+pts:\s*\d+\s+pts_time:([0-9.]+)/g;

    let match;
    while ((match = pattern.exec(stderr)) !== null && scenes.length < maxScenes) {
      const frame = parseInt(match[1] ?? '0', 10);
      const timestamp = parseFloat(match[2] ?? '0');

      // Extract scene score from the scene filter output
      // The score comes before the showinfo output
      const scoreMatch = stderr.substring(
        Math.max(0, match.index - 200), 
        match.index
      ).match(/scene:([0-9.]+)/);

      const score = scoreMatch?.[1] ? parseFloat(scoreMatch[1]) : 1.0;

      scenes.push({ timestamp, frame, score });
    }

    return scenes;
  }

  /**
   * Calculate scene durations
   */
  private calculateSceneDurations(scenes: SceneChange[], totalDuration: number): number[] {
    if (scenes.length === 0) return [];

    const durations: number[] = [];
    
    // First scene starts at 0
    const firstScene = scenes[0];
    if (firstScene) durations.push(firstScene.timestamp);

    // Middle scenes
    for (let i = 1; i < scenes.length; i++) {
      const currScene = scenes[i];
      const prevScene = scenes[i - 1];
      if (currScene && prevScene) {
        durations.push(currScene.timestamp - prevScene.timestamp);
      }
    }

    // Last scene ends at total duration
    const lastScene = scenes[scenes.length - 1];
    if (lastScene) durations.push(totalDuration - lastScene.timestamp);

    return durations.filter(d => d > 0);
  }

  /**
   * Extract thumbnails at scene changes
   */
  async extractSceneThumbnails(
    filePath: string,
    outputDir: string,
    options: {
      threshold?: number;
      maxThumbnails?: number;
      width?: number;
      quality?: number;
    } = {}
  ): Promise<string[]> {
    const threshold = options.threshold ?? this.defaultThreshold;
    const maxThumbnails = options.maxThumbnails ?? 10;
    const width = options.width ?? 640;
    const quality = options.quality ?? 2; // 2-31, lower is better

    // First detect scenes
    const detection = await this.detect(filePath, { 
      threshold, 
      maxScenes: maxThumbnails * 2,
    });

    // Select evenly distributed scenes
    const selectedScenes = this.selectEvenlyDistributed(
      detection.scenes, 
      maxThumbnails
    );

    // Extract thumbnails
    const thumbnails: string[] = [];

    for (let i = 0; i < selectedScenes.length; i++) {
      const scene = selectedScenes[i]!;
      const outputPath = `${outputDir}/scene_${i.toString().padStart(4, '0')}.jpg`;

      const args = [
        '-ss', scene.timestamp.toFixed(3),
        '-i', filePath,
        '-vframes', '1',
        '-vf', `scale=${width}:-1`,
        '-qscale:v', quality.toString(),
        '-y',
        outputPath,
      ];

      const result = await executeCommand(this.ffmpegPath, args, {
        timeout: 30000,
      });

      if (result.exitCode === 0) {
        thumbnails.push(outputPath);
      }
    }

    return thumbnails;
  }

  /**
   * Select evenly distributed scenes
   */
  private selectEvenlyDistributed(
    scenes: SceneChange[], 
    count: number
  ): SceneChange[] {
    if (scenes.length <= count) return scenes;

    const step = scenes.length / count;
    const selected: SceneChange[] = [];

    for (let i = 0; i < count; i++) {
      const index = Math.floor(i * step);
      const scene = scenes[index];
      if (scene) selected.push(scene);
    }

    return selected;
  }

  /**
   * Check if FFmpeg is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await executeCommand(this.ffmpegPath, ['-version'], {
        timeout: 5000,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const sceneDetector = new SceneDetector();