/**
 * Chapter Manager
 * 
 * Creates, edits, and manages chapter markers in video containers.
 * Supports multiple formats and automatic chapter generation.
 * 
 * Features:
 * - XML/OGM chapter format support
 * - Automatic chapter generation from scene detection
 * - Chapter import from various sources (FFmetadata, CUE, etc.)
 * - Multi-language chapter names
 * - Chapter thumbnail extraction
 */

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, basename, extname } from 'node:path';

export interface Chapter {
  startTime: number;      // Start time in milliseconds
  endTime?: number;       // End time in milliseconds (optional, calculated from next chapter)
  title: string;          // Chapter title
  language?: string;      // ISO 639-2 language code
  hidden?: boolean;       // Whether chapter is hidden
  enabled?: boolean;      // Whether chapter is enabled (default: true)
  uid?: string;           // Unique identifier
}

export interface ChapterEdition {
  uid?: string;
  name?: string;
  isDefault?: boolean;
  isHidden?: boolean;
  isOrdered?: boolean;    // Ordered chapters (for segment linking)
  chapters: Chapter[];
}

export type ChapterFormat = 'xml' | 'ogm' | 'ffmetadata' | 'cue' | 'json';

export interface ChapterManagerConfig {
  mkvmergePath?: string;
  mkvpropeditPath?: string;
  mkvextractPath?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  tempDir?: string;
}

export interface GenerateOptions {
  // Interval-based generation
  interval?: number;              // Interval in seconds
  
  // Scene-based generation
  sceneThreshold?: number;        // Scene change threshold (0.0-1.0)
  minSceneLength?: number;        // Minimum scene length in seconds
  
  // Black frame detection
  blackFrameThreshold?: number;   // Darkness threshold for black frames
  blackFrameMinDuration?: number; // Minimum black frame duration in seconds
  
  // Naming options
  nameTemplate?: string;          // Template: "Chapter {n}", "Scene {n}", etc.
  includeTimestamp?: boolean;     // Include timestamp in chapter name
  language?: string;              // Chapter language
}

export interface ThumbnailOptions {
  outputDir: string;
  width?: number;
  height?: number;
  format?: 'jpg' | 'png' | 'webp';
  quality?: number;               // 1-100 for JPEG/WebP
}

export class ChapterManager extends EventEmitter {
  private config: Required<ChapterManagerConfig>;

  constructor(config: ChapterManagerConfig = {}) {
    super();
    
    this.config = {
      mkvmergePath: config.mkvmergePath ?? 'mkvmerge',
      mkvpropeditPath: config.mkvpropeditPath ?? 'mkvpropedit',
      mkvextractPath: config.mkvextractPath ?? 'mkvextract',
      ffmpegPath: config.ffmpegPath ?? 'ffmpeg',
      ffprobePath: config.ffprobePath ?? 'ffprobe',
      tempDir: config.tempDir ?? '',
    };
  }

  /**
   * Extract chapters from a video file
   */
  async extract(videoPath: string, format: ChapterFormat = 'json'): Promise<ChapterEdition[]> {
    const ext = extname(videoPath).toLowerCase();

    if (ext === '.mkv') {
      return this.extractFromMkv(videoPath, format);
    }

    return this.extractWithFFprobe(videoPath);
  }

  /**
   * Import chapters from a file
   */
  async import(chapterFile: string): Promise<ChapterEdition[]> {
    const ext = extname(chapterFile).toLowerCase();
    const content = await readFile(chapterFile, 'utf-8');

    switch (ext) {
      case '.xml':
        return this.parseMatroskaXml(content);
      case '.txt':
        // Could be OGM or FFmetadata
        if (content.includes(';FFMETADATA')) {
          return this.parseFFmetadata(content);
        }
        return this.parseOgm(content);
      case '.cue':
        return this.parseCue(content);
      case '.json':
        return JSON.parse(content);
      default:
        throw new Error(`Unknown chapter format: ${ext}`);
    }
  }

  /**
   * Export chapters to a file
   */
  async export(
    editions: ChapterEdition[],
    outputPath: string,
    format?: ChapterFormat
  ): Promise<void> {
    const fmt = format ?? this.detectFormat(outputPath);
    let content: string;

    switch (fmt) {
      case 'xml':
        content = this.toMatroskaXml(editions);
        break;
      case 'ogm':
        content = this.toOgm(editions);
        break;
      case 'ffmetadata':
        content = this.toFFmetadata(editions);
        break;
      case 'cue':
        content = this.toCue(editions);
        break;
      case 'json':
        content = JSON.stringify(editions, null, 2);
        break;
      default:
        throw new Error(`Unknown format: ${fmt}`);
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, 'utf-8');
  }

  /**
   * Embed chapters into video file
   */
  async embed(
    videoPath: string,
    editions: ChapterEdition[],
    outputPath?: string
  ): Promise<{ success: boolean; error?: string }> {
    const tempChapterFile = join(
      this.config.tempDir || dirname(videoPath),
      `chapters_${Date.now()}.xml`
    );

    await this.export(editions, tempChapterFile, 'xml');

    try {
      if (outputPath && outputPath !== videoPath) {
        // Mux to new file
        const args = [
          '-o', outputPath,
          '--chapters', tempChapterFile,
          videoPath,
        ];

        const result = await this.execute(this.config.mkvmergePath, args);
        return {
          success: result.exitCode === 0 || result.exitCode === 1,
          error: result.exitCode > 1 ? result.stderr : undefined,
        };
      } else {
        // Edit in place
        const args = [
          videoPath,
          '--chapters', tempChapterFile,
        ];

        const result = await this.execute(this.config.mkvpropeditPath, args);
        return {
          success: result.exitCode === 0,
          error: result.exitCode !== 0 ? result.stderr : undefined,
        };
      }
    } finally {
      // Clean up temp file
      try {
        const { unlink } = await import('node:fs/promises');
        await unlink(tempChapterFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Generate chapters automatically
   */
  async generate(
    videoPath: string,
    options: GenerateOptions
  ): Promise<ChapterEdition> {
    const chapters: Chapter[] = [];
    const language = options.language ?? 'eng';
    const template = options.nameTemplate ?? 'Chapter {n}';

    // Get video duration
    const duration = await this.getVideoDuration(videoPath);

    if (options.interval) {
      // Interval-based generation
      const intervalMs = options.interval * 1000;
      let chapterNum = 1;

      for (let time = 0; time < duration; time += intervalMs) {
        chapters.push({
          startTime: time,
          title: this.formatChapterName(template, chapterNum, time, options.includeTimestamp),
          language,
        });
        chapterNum++;
      }
    } else if (options.sceneThreshold !== undefined) {
      // Scene-based generation
      const scenes = await this.detectScenes(
        videoPath,
        options.sceneThreshold,
        options.minSceneLength
      );

      let chapterNum = 1;
      for (const sceneTime of scenes) {
        chapters.push({
          startTime: sceneTime,
          title: this.formatChapterName(template, chapterNum, sceneTime, options.includeTimestamp),
          language,
        });
        chapterNum++;
      }
    } else if (options.blackFrameThreshold !== undefined) {
      // Black frame detection
      const blackFrames = await this.detectBlackFrames(
        videoPath,
        options.blackFrameThreshold,
        options.blackFrameMinDuration
      );

      let chapterNum = 1;
      // First chapter at start
      chapters.push({
        startTime: 0,
        title: this.formatChapterName(template, chapterNum, 0, options.includeTimestamp),
        language,
      });
      chapterNum++;

      // Chapters after each black frame sequence
      for (const frame of blackFrames) {
        chapters.push({
          startTime: frame.end,
          title: this.formatChapterName(template, chapterNum, frame.end, options.includeTimestamp),
          language,
        });
        chapterNum++;
      }
    }

    return {
      isDefault: true,
      chapters,
    };
  }

  /**
   * Extract chapter thumbnails
   */
  async extractThumbnails(
    videoPath: string,
    chapters: Chapter[],
    options: ThumbnailOptions
  ): Promise<string[]> {
    await mkdir(options.outputDir, { recursive: true });

    const format = options.format ?? 'jpg';
    const thumbnails: string[] = [];

    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i]!;
      const outputFile = join(
        options.outputDir,
        `chapter_${(i + 1).toString().padStart(3, '0')}.${format}`
      );

      const timeStr = this.msToTimestamp(chapter.startTime + 1000); // 1s after chapter start

      const args = [
        '-ss', timeStr,
        '-i', videoPath,
        '-vframes', '1',
      ];

      // Size
      if (options.width || options.height) {
        const scale = options.width && options.height
          ? `${options.width}:${options.height}`
          : options.width
            ? `${options.width}:-1`
            : `-1:${options.height}`;
        args.push('-vf', `scale=${scale}`);
      }

      // Quality
      if (options.quality && (format === 'jpg' || format === 'webp')) {
        args.push('-q:v', Math.round(31 - (options.quality / 100 * 30)).toString());
      }

      args.push('-y', outputFile);

      const result = await this.execute(this.config.ffmpegPath, args);
      if (result.exitCode === 0) {
        thumbnails.push(outputFile);
      }
    }

    return thumbnails;
  }

  /**
   * Merge multiple chapter lists
   */
  merge(editions: ChapterEdition[], dedupeThresholdMs: number = 1000): ChapterEdition {
    const allChapters: Chapter[] = [];

    for (const edition of editions) {
      allChapters.push(...edition.chapters);
    }

    // Sort by start time
    allChapters.sort((a, b) => a.startTime - b.startTime);

    // Deduplicate
    const merged: Chapter[] = [];
    for (const chapter of allChapters) {
      const last = merged[merged.length - 1];
      if (!last || Math.abs(chapter.startTime - last.startTime) > dedupeThresholdMs) {
        merged.push(chapter);
      }
    }

    return {
      isDefault: true,
      chapters: merged,
    };
  }

  /**
   * Shift all chapter times
   */
  shift(edition: ChapterEdition, offsetMs: number): ChapterEdition {
    return {
      ...edition,
      chapters: edition.chapters.map(ch => ({
        ...ch,
        startTime: Math.max(0, ch.startTime + offsetMs),
        endTime: ch.endTime ? Math.max(0, ch.endTime + offsetMs) : undefined,
      })),
    };
  }

  /**
   * Scale chapter times (for speed changes)
   */
  scale(edition: ChapterEdition, factor: number): ChapterEdition {
    return {
      ...edition,
      chapters: edition.chapters.map(ch => ({
        ...ch,
        startTime: Math.round(ch.startTime * factor),
        endTime: ch.endTime ? Math.round(ch.endTime * factor) : undefined,
      })),
    };
  }

  // Private methods

  private async extractFromMkv(videoPath: string, format: ChapterFormat): Promise<ChapterEdition[]> {
    const tempFile = join(
      this.config.tempDir || dirname(videoPath),
      `chapters_extract_${Date.now()}.xml`
    );

    const args = ['chapters', videoPath, '-s', tempFile];
    const result = await this.execute(this.config.mkvextractPath, args);

    if (result.exitCode !== 0) {
      return [];
    }

    try {
      const content = await readFile(tempFile, 'utf-8');
      return this.parseMatroskaXml(content);
    } finally {
      try {
        const { unlink } = await import('node:fs/promises');
        await unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private async extractWithFFprobe(videoPath: string): Promise<ChapterEdition[]> {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_chapters',
      videoPath,
    ];

    const result = await this.execute(this.config.ffprobePath, args);
    if (result.exitCode !== 0 || !result.stdout) {
      return [];
    }

    const data = JSON.parse(result.stdout);
    const chapters: Chapter[] = (data.chapters ?? []).map((ch: Record<string, unknown>) => ({
      startTime: Math.round((ch.start_time as number) * 1000),
      endTime: ch.end_time ? Math.round((ch.end_time as number) * 1000) : undefined,
      title: (ch.tags as Record<string, string>)?.title ?? 'Chapter',
    }));

    return [{
      isDefault: true,
      chapters,
    }];
  }

  private async getVideoDuration(videoPath: string): Promise<number> {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      videoPath,
    ];

    const result = await this.execute(this.config.ffprobePath, args);
    if (result.exitCode !== 0) {
      throw new Error('Failed to get video duration');
    }

    const data = JSON.parse(result.stdout);
    return Math.round(parseFloat(data.format.duration) * 1000);
  }

  private async detectScenes(
    videoPath: string,
    threshold: number,
    minLength?: number
  ): Promise<number[]> {
    const filterGraph = `select='gt(scene,${threshold})',showinfo`;
    const args = [
      '-i', videoPath,
      '-vf', filterGraph,
      '-f', 'null',
      '-',
    ];

    const result = await this.execute(this.config.ffmpegPath, args);
    const scenes: number[] = [0]; // Always include start

    const regex = /pts_time:(\d+\.?\d*)/g;
    let match;
    let lastScene = 0;
    const minLengthMs = (minLength ?? 5) * 1000;

    while ((match = regex.exec(result.stderr)) !== null) {
      const time = Math.round(parseFloat(match[1]!) * 1000);
      if (time - lastScene >= minLengthMs) {
        scenes.push(time);
        lastScene = time;
      }
    }

    return scenes;
  }

  private async detectBlackFrames(
    videoPath: string,
    threshold: number = 0.1,
    minDuration: number = 0.5
  ): Promise<Array<{ start: number; end: number }>> {
    const args = [
      '-i', videoPath,
      '-vf', `blackdetect=d=${minDuration}:pix_th=${threshold}`,
      '-f', 'null',
      '-',
    ];

    const result = await this.execute(this.config.ffmpegPath, args);
    const blackFrames: Array<{ start: number; end: number }> = [];

    const regex = /black_start:(\d+\.?\d*)\s+black_end:(\d+\.?\d*)/g;
    let match;

    while ((match = regex.exec(result.stderr)) !== null) {
      blackFrames.push({
        start: Math.round(parseFloat(match[1]!) * 1000),
        end: Math.round(parseFloat(match[2]!) * 1000),
      });
    }

    return blackFrames;
  }

  private parseMatroskaXml(xml: string): ChapterEdition[] {
    const editions: ChapterEdition[] = [];
    
    // Simple XML parsing (for production, use a proper XML parser)
    const editionMatches = xml.matchAll(/<EditionEntry>([\s\S]*?)<\/EditionEntry>/g);

    for (const editionMatch of editionMatches) {
      const editionXml = editionMatch[1] ?? '';
      const chapters: Chapter[] = [];

      const chapterMatches = editionXml.matchAll(/<ChapterAtom>([\s\S]*?)<\/ChapterAtom>/g);

      for (const chapterMatch of chapterMatches) {
        const chapterXml = chapterMatch[1] ?? '';

        const startMatch = chapterXml.match(/<ChapterTimeStart>(\d+):(\d+):(\d+)\.(\d+)<\/ChapterTimeStart>/);
        const endMatch = chapterXml.match(/<ChapterTimeEnd>(\d+):(\d+):(\d+)\.(\d+)<\/ChapterTimeEnd>/);
        const titleMatch = chapterXml.match(/<ChapterString>([^<]*)<\/ChapterString>/);
        const langMatch = chapterXml.match(/<ChapterLanguage>([^<]*)<\/ChapterLanguage>/);

        if (startMatch) {
          const [, h, m, s, ns] = startMatch;
          const startTime = (parseInt(h!) * 3600000) + (parseInt(m!) * 60000) + 
                           (parseInt(s!) * 1000) + Math.round(parseInt(ns!) / 1000000);

          let endTime: number | undefined;
          if (endMatch) {
            const [, eh, em, es, ens] = endMatch;
            endTime = (parseInt(eh!) * 3600000) + (parseInt(em!) * 60000) + 
                     (parseInt(es!) * 1000) + Math.round(parseInt(ens!) / 1000000);
          }

          chapters.push({
            startTime,
            endTime,
            title: titleMatch?.[1] ?? 'Chapter',
            language: langMatch?.[1],
          });
        }
      }

      if (chapters.length > 0) {
        editions.push({
          isDefault: true,
          chapters,
        });
      }
    }

    return editions;
  }

  private parseOgm(content: string): ChapterEdition[] {
    const chapters: Chapter[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const timeMatch = line.match(/CHAPTER(\d+)=(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
      const nameMatch = line.match(/CHAPTER\d+NAME=(.+)/);

      if (timeMatch) {
        const [, num, h, m, s, ms] = timeMatch;
        const startTime = (parseInt(h!) * 3600000) + (parseInt(m!) * 60000) + 
                         (parseInt(s!) * 1000) + parseInt(ms!);

        chapters.push({
          startTime,
          title: '',
        });
      } else if (nameMatch && chapters.length > 0) {
        chapters[chapters.length - 1]!.title = nameMatch[1]!.trim();
      }
    }

    return [{ isDefault: true, chapters }];
  }

  private parseFFmetadata(content: string): ChapterEdition[] {
    const chapters: Chapter[] = [];
    const chapterBlocks = content.split('[CHAPTER]').slice(1);

    for (const block of chapterBlocks) {
      const startMatch = block.match(/START=(\d+)/);
      const endMatch = block.match(/END=(\d+)/);
      const titleMatch = block.match(/title=(.+)/);

      if (startMatch) {
        chapters.push({
          startTime: Math.round(parseInt(startMatch[1]!) / 1000), // ns to ms
          endTime: endMatch ? Math.round(parseInt(endMatch[1]!) / 1000) : undefined,
          title: titleMatch?.[1]?.trim() ?? 'Chapter',
        });
      }
    }

    return [{ isDefault: true, chapters }];
  }

  private parseCue(content: string): ChapterEdition[] {
    const chapters: Chapter[] = [];
    const trackBlocks = content.split(/TRACK\s+\d+/i).slice(1);

    for (const block of trackBlocks) {
      const titleMatch = block.match(/TITLE\s+"(.+)"/i);
      const indexMatch = block.match(/INDEX\s+01\s+(\d{2}):(\d{2}):(\d{2})/i);

      if (indexMatch) {
        const [, m, s, f] = indexMatch;
        // CUE uses mm:ss:ff where ff is frames (75 fps)
        const startTime = (parseInt(m!) * 60000) + (parseInt(s!) * 1000) + 
                         Math.round((parseInt(f!) / 75) * 1000);

        chapters.push({
          startTime,
          title: titleMatch?.[1] ?? 'Track',
        });
      }
    }

    return [{ isDefault: true, chapters }];
  }

  private toMatroskaXml(editions: ChapterEdition[]): string {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<!DOCTYPE Chapters SYSTEM "matroskachapters.dtd">\n';
    xml += '<Chapters>\n';

    for (const edition of editions) {
      xml += '  <EditionEntry>\n';
      if (edition.uid) {
        xml += `    <EditionUID>${edition.uid}</EditionUID>\n`;
      }
      if (edition.isDefault) {
        xml += '    <EditionFlagDefault>1</EditionFlagDefault>\n';
      }
      if (edition.isHidden) {
        xml += '    <EditionFlagHidden>1</EditionFlagHidden>\n';
      }

      for (const chapter of edition.chapters) {
        xml += '    <ChapterAtom>\n';
        xml += `      <ChapterTimeStart>${this.msToMatroskaTime(chapter.startTime)}</ChapterTimeStart>\n`;
        if (chapter.endTime !== undefined) {
          xml += `      <ChapterTimeEnd>${this.msToMatroskaTime(chapter.endTime)}</ChapterTimeEnd>\n`;
        }
        if (chapter.hidden) {
          xml += '      <ChapterFlagHidden>1</ChapterFlagHidden>\n';
        }
        xml += '      <ChapterDisplay>\n';
        xml += `        <ChapterString>${this.escapeXml(chapter.title)}</ChapterString>\n`;
        xml += `        <ChapterLanguage>${chapter.language ?? 'eng'}</ChapterLanguage>\n`;
        xml += '      </ChapterDisplay>\n';
        xml += '    </ChapterAtom>\n';
      }

      xml += '  </EditionEntry>\n';
    }

    xml += '</Chapters>\n';
    return xml;
  }

  private toOgm(editions: ChapterEdition[]): string {
    const lines: string[] = [];
    let num = 1;

    for (const edition of editions) {
      for (const chapter of edition.chapters) {
        const time = this.msToTimestamp(chapter.startTime);
        lines.push(`CHAPTER${num.toString().padStart(2, '0')}=${time}`);
        lines.push(`CHAPTER${num.toString().padStart(2, '0')}NAME=${chapter.title}`);
        num++;
      }
    }

    return lines.join('\n');
  }

  private toFFmetadata(editions: ChapterEdition[]): string {
    let output = ';FFMETADATA1\n';

    for (const edition of editions) {
      for (let i = 0; i < edition.chapters.length; i++) {
        const chapter = edition.chapters[i]!;
        const nextChapter = edition.chapters[i + 1];

        output += '\n[CHAPTER]\n';
        output += 'TIMEBASE=1/1000\n';
        output += `START=${chapter.startTime}\n`;
        output += `END=${chapter.endTime ?? nextChapter?.startTime ?? chapter.startTime + 1000}\n`;
        output += `title=${chapter.title}\n`;
      }
    }

    return output;
  }

  private toCue(editions: ChapterEdition[]): string {
    const lines: string[] = [
      'REM Generated by ChapterManager',
      'TITLE "Chapters"',
      'FILE "video.mkv" VIDEO',
    ];

    let trackNum = 1;

    for (const edition of editions) {
      for (const chapter of edition.chapters) {
        const [m, s, f] = this.msToCueTime(chapter.startTime);
        lines.push(`  TRACK ${trackNum.toString().padStart(2, '0')} AUDIO`);
        lines.push(`    TITLE "${chapter.title}"`);
        lines.push(`    INDEX 01 ${m}:${s}:${f}`);
        trackNum++;
      }
    }

    return lines.join('\n');
  }

  private detectFormat(path: string): ChapterFormat {
    const ext = extname(path).toLowerCase();
    const formatMap: Record<string, ChapterFormat> = {
      '.xml': 'xml',
      '.txt': 'ogm',
      '.cue': 'cue',
      '.json': 'json',
    };
    return formatMap[ext] ?? 'xml';
  }

  private msToTimestamp(ms: number): string {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const msRemain = ms % 1000;

    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${msRemain.toString().padStart(3, '0')}`;
  }

  private msToMatroskaTime(ms: number): string {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const ns = (ms % 1000) * 1000000;

    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ns.toString().padStart(9, '0')}`;
  }

  private msToCueTime(ms: number): [string, string, string] {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const f = Math.round(((ms % 1000) / 1000) * 75); // 75 frames per second

    return [
      m.toString().padStart(2, '0'),
      s.toString().padStart(2, '0'),
      f.toString().padStart(2, '0'),
    ];
  }

  private formatChapterName(
    template: string,
    num: number,
    timeMs: number,
    includeTimestamp?: boolean
  ): string {
    let name = template.replace('{n}', num.toString());
    
    if (includeTimestamp) {
      const timestamp = this.msToTimestamp(timeMs).split('.')[0]; // Remove ms
      name += ` (${timestamp})`;
    }

    return name;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private execute(
    command: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const child = spawn(command, args);
      
      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 0,
        });
      });

      child.on('error', (err) => {
        resolve({
          stdout,
          stderr: err.message,
          exitCode: 1,
        });
      });
    });
  }
}

/**
 * Create chapters from timestamps array
 */
export function createChaptersFromTimestamps(
  timestamps: number[],
  options?: {
    nameTemplate?: string;
    language?: string;
  }
): Chapter[] {
  const template = options?.nameTemplate ?? 'Chapter {n}';
  
  return timestamps.map((time, i) => ({
    startTime: time,
    title: template.replace('{n}', (i + 1).toString()),
    language: options?.language ?? 'eng',
  }));
}

/**
 * Create chapters at regular intervals
 */
export function createChaptersAtIntervals(
  durationMs: number,
  intervalMs: number,
  options?: {
    nameTemplate?: string;
    language?: string;
  }
): Chapter[] {
  const chapters: Chapter[] = [];
  const template = options?.nameTemplate ?? 'Chapter {n}';
  let num = 1;

  for (let time = 0; time < durationMs; time += intervalMs) {
    chapters.push({
      startTime: time,
      title: template.replace('{n}', num.toString()),
      language: options?.language ?? 'eng',
    });
    num++;
  }

  return chapters;
}
