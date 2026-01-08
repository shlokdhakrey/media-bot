/**
 * Subtitle Embedder
 * 
 * Handles embedding subtitles into containers with proper configuration.
 * Supports multiple formats, languages, and font attachments.
 * 
 * Features:
 * - Multi-track subtitle embedding
 * - Language and metadata assignment
 * - Default/forced flag management
 * - Font extraction and embedding (for ASS/SSA)
 * - Format conversion (SRT ↔ ASS, VobSub → PGS, etc.)
 * - SDH/CC track detection and flagging
 */

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { readFile, writeFile, readdir, stat, mkdir, copyFile } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';

export interface SubtitleTrack {
  path: string;
  language?: string;          // ISO 639-2 (e.g., 'eng', 'jpn')
  name?: string;              // Track name (e.g., 'English SDH', 'Signs/Songs')
  isDefault?: boolean;
  isForced?: boolean;
  isSDH?: boolean;            // Subtitles for deaf/hard of hearing
  isCC?: boolean;             // Closed captions
  encoding?: string;          // Character encoding (e.g., 'UTF-8')
  
  // Timing adjustments
  delay?: number;             // Delay in milliseconds
  
  // For external conversion
  convertTo?: SubtitleFormat;
}

export type SubtitleFormat = 'srt' | 'ass' | 'ssa' | 'vtt' | 'sub' | 'sup' | 'pgs';

export interface FontInfo {
  path: string;
  name: string;
  family?: string;
  style?: string;
  mimeType?: string;
}

export interface SubtitleEmbedderConfig {
  mkvmergePath?: string;
  ffmpegPath?: string;
  tempDir?: string;
  
  // Font handling
  defaultFontDir?: string;
  embedFonts?: boolean;
  extractUsedFonts?: boolean;  // Extract only fonts used in ASS
  
  // Default language
  defaultLanguage?: string;
}

export interface EmbedOptions {
  inputVideo: string;
  outputPath: string;
  subtitles: SubtitleTrack[];
  
  // Font options
  fonts?: FontInfo[];
  autoDetectFonts?: boolean;
  
  // Preserve existing subtitles
  keepExistingSubtitles?: boolean;
  
  // Container preference
  preferMkv?: boolean;
}

export interface EmbedResult {
  success: boolean;
  output: string;
  subtitlesAdded: number;
  fontsAdded: number;
  command: string;
  error?: string;
}

export interface SubtitleInfo {
  format: SubtitleFormat;
  lineCount: number;
  duration?: number;
  hasStyles?: boolean;
  usedFonts?: string[];
  encoding?: string;
  isSDH?: boolean;
}

export class SubtitleEmbedder extends EventEmitter {
  private config: Required<SubtitleEmbedderConfig>;

  constructor(config: SubtitleEmbedderConfig = {}) {
    super();
    
    this.config = {
      mkvmergePath: config.mkvmergePath ?? 'mkvmerge',
      ffmpegPath: config.ffmpegPath ?? 'ffmpeg',
      tempDir: config.tempDir ?? '',
      defaultFontDir: config.defaultFontDir ?? '',
      embedFonts: config.embedFonts ?? true,
      extractUsedFonts: config.extractUsedFonts ?? true,
      defaultLanguage: config.defaultLanguage ?? 'eng',
    };
  }

  /**
   * Embed subtitles into video container
   */
  async embed(options: EmbedOptions): Promise<EmbedResult> {
    await mkdir(dirname(options.outputPath), { recursive: true });

    const fontsToEmbed: FontInfo[] = [];

    // Auto-detect fonts from ASS subtitles
    if (options.autoDetectFonts) {
      for (const sub of options.subtitles) {
        const ext = extname(sub.path).toLowerCase();
        if (ext === '.ass' || ext === '.ssa') {
          const fonts = await this.extractFontReferences(sub.path);
          fontsToEmbed.push(...fonts);
        }
      }
    }

    // Add manually specified fonts
    if (options.fonts) {
      fontsToEmbed.push(...options.fonts);
    }

    // Deduplicate fonts by path
    const uniqueFonts = Array.from(
      new Map(fontsToEmbed.map(f => [f.path, f])).values()
    );

    // Build mkvmerge command
    const args = this.buildEmbedCommand(options, uniqueFonts);
    const command = `mkvmerge ${args.join(' ')}`;

    try {
      const result = await this.execute(this.config.mkvmergePath, args);
      const success = result.exitCode === 0 || result.exitCode === 1;

      return {
        success,
        output: options.outputPath,
        subtitlesAdded: options.subtitles.length,
        fontsAdded: uniqueFonts.length,
        command,
        error: !success ? result.stderr : undefined,
      };
    } catch (error) {
      return {
        success: false,
        output: options.outputPath,
        subtitlesAdded: 0,
        fontsAdded: 0,
        command,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Analyze subtitle file
   */
  async analyze(subtitlePath: string): Promise<SubtitleInfo> {
    const ext = extname(subtitlePath).toLowerCase();
    const content = await readFile(subtitlePath, 'utf-8');
    const lines = content.split('\n');

    const info: SubtitleInfo = {
      format: this.getFormat(ext),
      lineCount: lines.length,
      isSDH: this.detectSDH(content),
    };

    // Parse based on format
    switch (ext) {
      case '.ass':
      case '.ssa':
        info.hasStyles = content.includes('[V4+ Styles]') || content.includes('[V4 Styles]');
        info.usedFonts = this.extractFontNames(content);
        info.duration = this.parseAssDuration(content);
        break;
      case '.srt':
        info.duration = this.parseSrtDuration(content);
        break;
      case '.vtt':
        info.duration = this.parseVttDuration(content);
        break;
    }

    // Detect encoding
    info.encoding = this.detectEncoding(content);

    return info;
  }

  /**
   * Convert subtitle format
   */
  async convert(
    input: string,
    output: string,
    options?: {
      targetFormat?: SubtitleFormat;
      encoding?: string;
      timeShift?: number;
      scaleFactor?: number;
    }
  ): Promise<{ success: boolean; output: string; error?: string }> {
    await mkdir(dirname(output), { recursive: true });

    const inputExt = extname(input).toLowerCase();
    const outputExt = extname(output).toLowerCase();

    // Text-based conversions
    if (this.isTextFormat(inputExt) && this.isTextFormat(outputExt)) {
      const content = await readFile(input, { encoding: (options?.encoding ?? 'utf-8') as BufferEncoding });
      let converted: string;

      if (inputExt === '.srt' && outputExt === '.ass') {
        converted = this.srtToAss(content);
      } else if (inputExt === '.ass' && outputExt === '.srt') {
        converted = this.assToSrt(content);
      } else if (inputExt === '.vtt' && outputExt === '.srt') {
        converted = this.vttToSrt(content);
      } else if (inputExt === '.srt' && outputExt === '.vtt') {
        converted = this.srtToVtt(content);
      } else {
        // Use FFmpeg for other conversions
        return this.ffmpegConvert(input, output);
      }

      // Apply time shift if needed
      if (options?.timeShift) {
        converted = this.shiftTimestamps(converted, outputExt, options.timeShift);
      }

      await writeFile(output, converted, 'utf-8');
      return { success: true, output };
    }

    // Use FFmpeg for image-based formats
    return this.ffmpegConvert(input, output);
  }

  /**
   * Find and match fonts for ASS subtitles
   */
  async findFonts(
    subtitlePath: string,
    fontDirs?: string[]
  ): Promise<{ found: FontInfo[]; missing: string[] }> {
    const content = await readFile(subtitlePath, 'utf-8');
    const usedFontNames = this.extractFontNames(content);

    const searchDirs = [
      ...(fontDirs ?? []),
      this.config.defaultFontDir,
      // Common Windows font paths
      'C:\\Windows\\Fonts',
      // Common Linux font paths
      '/usr/share/fonts',
      '/usr/local/share/fonts',
      `${process.env['HOME'] ?? ''}/.fonts`,
    ].filter(Boolean);

    const found: FontInfo[] = [];
    const missing: string[] = [];

    for (const fontName of usedFontNames) {
      let fontFound = false;

      for (const dir of searchDirs) {
        try {
          const fontPath = await this.searchFontInDir(dir, fontName);
          if (fontPath) {
            found.push({
              path: fontPath,
              name: basename(fontPath),
              family: fontName,
              mimeType: this.getFontMimeType(fontPath),
            });
            fontFound = true;
            break;
          }
        } catch {
          // Directory doesn't exist, continue
        }
      }

      if (!fontFound) {
        missing.push(fontName);
      }
    }

    return { found, missing };
  }

  /**
   * Create SDH subtitles from regular subtitles (add speaker labels, sound descriptions)
   */
  createSDH(subtitlePath: string, options?: {
    addSpeakerLabels?: boolean;
    addSoundDescriptions?: boolean;
  }): Promise<string> {
    // This would require NLP/ML for proper implementation
    // Placeholder for now
    return Promise.resolve(subtitlePath);
  }

  // Private methods

  private buildEmbedCommand(options: EmbedOptions, fonts: FontInfo[]): string[] {
    const args: string[] = [];

    // Output file
    args.push('-o', options.outputPath);

    // Input video file
    args.push(options.inputVideo);

    // Handle existing subtitles
    if (!options.keepExistingSubtitles) {
      args.push('--no-subtitles');
    }

    // Add subtitle tracks
    for (let i = 0; i < options.subtitles.length; i++) {
      const sub = options.subtitles[i]!;

      // Language
      args.push('--language', `0:${sub.language ?? this.config.defaultLanguage}`);

      // Track name
      if (sub.name) {
        let trackName = sub.name;
        if (sub.isSDH) trackName += ' (SDH)';
        if (sub.isCC) trackName += ' (CC)';
        args.push('--track-name', `0:${trackName}`);
      }

      // Default flag
      if (sub.isDefault) {
        args.push('--default-track-flag', '0:yes');
      }

      // Forced flag
      if (sub.isForced) {
        args.push('--forced-display-flag', '0:yes');
      }

      // Hearing impaired flag
      if (sub.isSDH) {
        args.push('--hearing-impaired-flag', '0:yes');
      }

      // Sync offset
      if (sub.delay) {
        args.push('--sync', `0:${sub.delay}`);
      }

      // Character encoding
      if (sub.encoding) {
        args.push('--sub-charset', `0:${sub.encoding}`);
      }

      // Subtitle file
      args.push(sub.path);
    }

    // Attach fonts
    for (const font of fonts) {
      args.push('--attach-file', font.path);
      if (font.mimeType) {
        args.push('--attachment-mime-type', font.mimeType);
      }
      if (font.name) {
        args.push('--attachment-name', font.name);
      }
    }

    return args;
  }

  private async extractFontReferences(assPath: string): Promise<FontInfo[]> {
    const fontNames = this.extractFontNames(await readFile(assPath, 'utf-8'));
    const { found } = await this.findFonts(assPath);
    return found;
  }

  private extractFontNames(content: string): string[] {
    const fonts = new Set<string>();

    // From [V4+ Styles] section
    const styleMatch = content.match(/\[V4\+? Styles\]([\s\S]*?)(?:\[|$)/i);
    if (styleMatch) {
      const styleSection = styleMatch[1] ?? '';
      const fontMatches = styleSection.matchAll(/Style:\s*[^,]*,\s*([^,]+)/g);
      for (const match of fontMatches) {
        if (match[1]) {
          fonts.add(match[1].trim());
        }
      }
    }

    // From inline {\fn} tags
    const inlineMatches = content.matchAll(/\\fn([^\\}]+)/g);
    for (const match of inlineMatches) {
      if (match[1]) {
        fonts.add(match[1].trim());
      }
    }

    return Array.from(fonts);
  }

  private async searchFontInDir(dir: string, fontName: string): Promise<string | null> {
    const normalizedName = fontName.toLowerCase().replace(/\s+/g, '');
    
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const result = await this.searchFontInDir(join(dir, entry.name), fontName);
          if (result) return result;
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (['.ttf', '.otf', '.ttc', '.woff', '.woff2'].includes(ext)) {
            const fileName = basename(entry.name, ext).toLowerCase().replace(/\s+/g, '');
            if (fileName.includes(normalizedName) || normalizedName.includes(fileName)) {
              return join(dir, entry.name);
            }
          }
        }
      }
    } catch {
      // Directory access error
    }

    return null;
  }

  private getFormat(ext: string): SubtitleFormat {
    const formatMap: Record<string, SubtitleFormat> = {
      '.srt': 'srt',
      '.ass': 'ass',
      '.ssa': 'ssa',
      '.vtt': 'vtt',
      '.sub': 'sub',
      '.sup': 'sup',
      '.pgs': 'pgs',
    };
    return formatMap[ext] ?? 'srt';
  }

  private isTextFormat(ext: string): boolean {
    return ['.srt', '.ass', '.ssa', '.vtt'].includes(ext);
  }

  private detectSDH(content: string): boolean {
    // Common SDH patterns
    const sdhPatterns = [
      /\[.*?\]/,                    // Sound descriptions in brackets
      /\(.*?sounds?\)/i,            // Sound descriptions
      /\(.*?music\)/i,              // Music descriptions
      /♪/,                          // Music symbols
      /^\s*-?\s*[A-Z]+:/m,          // Speaker labels like "JOHN:"
      /\(.*?speaking.*?\)/i,        // Speaking language notes
    ];

    return sdhPatterns.some(pattern => pattern.test(content));
  }

  private detectEncoding(content: string): string {
    // Simple BOM detection
    if (content.startsWith('\ufeff')) return 'UTF-8-BOM';
    if (content.startsWith('\xfe\xff')) return 'UTF-16BE';
    if (content.startsWith('\xff\xfe')) return 'UTF-16LE';

    // Check for UTF-8 validity (simplified)
    try {
      Buffer.from(content, 'utf-8').toString('utf-8');
      return 'UTF-8';
    } catch {
      return 'LATIN1';
    }
  }

  private parseAssDuration(content: string): number | undefined {
    // Find last Dialogue line
    const dialogueLines = content.match(/Dialogue:\s*\d+,\s*(\d+:\d+:\d+\.\d+),\s*(\d+:\d+:\d+\.\d+)/g);
    if (!dialogueLines || dialogueLines.length === 0) return undefined;

    const lastLine = dialogueLines[dialogueLines.length - 1];
    const match = lastLine?.match(/Dialogue:\s*\d+,\s*\d+:\d+:\d+\.\d+,\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (!match) return undefined;

    const [, h, m, s, cs] = match;
    return (parseInt(h!) * 3600) + (parseInt(m!) * 60) + parseInt(s!) + (parseInt(cs!) / 100);
  }

  private parseSrtDuration(content: string): number | undefined {
    const timestamps = content.matchAll(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g);
    let maxTime = 0;

    for (const match of timestamps) {
      const [, h, m, s, ms] = match;
      const time = (parseInt(h!) * 3600) + (parseInt(m!) * 60) + parseInt(s!) + (parseInt(ms!) / 1000);
      maxTime = Math.max(maxTime, time);
    }

    return maxTime > 0 ? maxTime : undefined;
  }

  private parseVttDuration(content: string): number | undefined {
    const timestamps = content.matchAll(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g);
    let maxTime = 0;

    for (const match of timestamps) {
      const [, h, m, s, ms] = match;
      const time = (parseInt(h!) * 3600) + (parseInt(m!) * 60) + parseInt(s!) + (parseInt(ms!) / 1000);
      maxTime = Math.max(maxTime, time);
    }

    return maxTime > 0 ? maxTime : undefined;
  }

  private srtToAss(srt: string): string {
    const lines: string[] = [
      '[Script Info]',
      'Title: Converted from SRT',
      'ScriptType: v4.00+',
      'Collisions: Normal',
      'PlayDepth: 0',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      'Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ];

    // Parse SRT blocks
    const blocks = srt.split(/\n\s*\n/).filter(Boolean);
    
    for (const block of blocks) {
      const blockLines = block.trim().split('\n');
      if (blockLines.length < 3) continue;

      // Skip index line
      const timeMatch = blockLines[1]?.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
      if (!timeMatch) continue;

      const [, sh, sm, ss, sms, eh, em, es, ems] = timeMatch;
      const startTime = `${sh}:${sm}:${ss}.${sms?.slice(0, 2)}`;
      const endTime = `${eh}:${em}:${es}.${ems?.slice(0, 2)}`;

      const text = blockLines.slice(2).join('\\N').replace(/<[^>]+>/g, '');
      
      lines.push(`Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${text}`);
    }

    return lines.join('\n');
  }

  private assToSrt(ass: string): string {
    const lines: string[] = [];
    let index = 1;

    const dialogueMatches = ass.matchAll(/Dialogue:\s*\d+,\s*(\d+:\d+:\d+\.\d+),\s*(\d+:\d+:\d+\.\d+),[^,]*,[^,]*,\d+,\d+,\d+,[^,]*,(.*)/g);

    for (const match of dialogueMatches) {
      const [, start, end, text] = match;
      if (!start || !end || !text) continue;

      // Convert ASS time to SRT time
      const startSrt = start.replace('.', ',') + '0';
      const endSrt = end.replace('.', ',') + '0';

      // Clean ASS formatting
      const cleanText = text
        .replace(/\{[^}]*\}/g, '')
        .replace(/\\N/g, '\n')
        .replace(/\\n/g, '\n')
        .trim();

      if (cleanText) {
        lines.push(`${index}`);
        lines.push(`${startSrt} --> ${endSrt}`);
        lines.push(cleanText);
        lines.push('');
        index++;
      }
    }

    return lines.join('\n');
  }

  private vttToSrt(vtt: string): string {
    let srt = vtt
      .replace(/^WEBVTT.*\n/, '')
      .replace(/\n(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '\n$1,$2')
      .replace(/(\d{2}:\d{2})\.(\d{3})/g, '00:$1,$2');

    // Add indices
    const blocks = srt.split(/\n\s*\n/).filter(Boolean);
    const indexedBlocks = blocks.map((block, i) => {
      if (block.includes(' --> ')) {
        return `${i + 1}\n${block}`;
      }
      return block;
    });

    return indexedBlocks.join('\n\n');
  }

  private srtToVtt(srt: string): string {
    const vtt = srt
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
      .replace(/^\d+\s*\n/gm, '');

    return `WEBVTT\n\n${vtt}`;
  }

  private shiftTimestamps(content: string, ext: string, shiftMs: number): string {
    const shiftTime = (h: number, m: number, s: number, ms: number): [number, number, number, number] => {
      const totalMs = (h * 3600000) + (m * 60000) + (s * 1000) + ms + shiftMs;
      const newMs = Math.max(0, totalMs);
      
      return [
        Math.floor(newMs / 3600000),
        Math.floor((newMs % 3600000) / 60000),
        Math.floor((newMs % 60000) / 1000),
        newMs % 1000,
      ];
    };

    const pad = (n: number, len: number = 2) => n.toString().padStart(len, '0');

    if (ext === '.srt') {
      return content.replace(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g, (_, h, m, s, ms) => {
        const [nh, nm, ns, nms] = shiftTime(parseInt(h), parseInt(m), parseInt(s), parseInt(ms));
        return `${pad(nh)}:${pad(nm)}:${pad(ns)},${pad(nms, 3)}`;
      });
    }

    if (ext === '.ass' || ext === '.ssa') {
      return content.replace(/(\d+):(\d{2}):(\d{2})\.(\d{2})/g, (_, h, m, s, cs) => {
        const [nh, nm, ns, nms] = shiftTime(parseInt(h), parseInt(m), parseInt(s), parseInt(cs) * 10);
        return `${h.length > 1 ? pad(nh) : nh}:${pad(nm)}:${pad(ns)}.${pad(Math.floor(nms / 10))}`;
      });
    }

    return content;
  }

  private async ffmpegConvert(
    input: string,
    output: string
  ): Promise<{ success: boolean; output: string; error?: string }> {
    const args = ['-i', input, '-y', output];

    return new Promise((resolve) => {
      const child = spawn(this.config.ffmpegPath, args);
      let stderr = '';

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          output,
          error: code !== 0 ? stderr : undefined,
        });
      });

      child.on('error', (err) => {
        resolve({
          success: false,
          output,
          error: err.message,
        });
      });
    });
  }

  private getFontMimeType(path: string): string {
    const ext = extname(path).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.ttf': 'font/ttf',
      '.otf': 'font/otf',
      '.ttc': 'font/collection',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
    };
    return mimeTypes[ext] ?? 'application/x-truetype-font';
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
 * Find subtitle files for a video
 */
export async function findSubtitlesForVideo(videoPath: string): Promise<string[]> {
  const dir = dirname(videoPath);
  const videoName = basename(videoPath, extname(videoPath));
  const subtitles: string[] = [];

  const subExtensions = ['.srt', '.ass', '.ssa', '.sub', '.vtt', '.sup'];

  try {
    const entries = await readdir(dir);

    for (const entry of entries) {
      const entryBase = basename(entry, extname(entry));
      const entryExt = extname(entry).toLowerCase();

      // Match by name prefix
      if (subExtensions.includes(entryExt) && entryBase.startsWith(videoName)) {
        subtitles.push(join(dir, entry));
      }
    }
  } catch {
    // Directory read error
  }

  return subtitles;
}

/**
 * Parse language from subtitle filename
 * e.g., "Movie.2024.eng.srt" -> "eng"
 */
export function parseSubtitleLanguage(filename: string): string | undefined {
  const name = basename(filename, extname(filename));
  
  // Common patterns
  const patterns = [
    /\.([a-z]{2,3})$/i,                    // .eng, .en
    /\[([a-z]{2,3})\]$/i,                  // [eng], [en]
    /\.([a-z]{2,3})\.(?:forced|sdh|cc)$/i, // .eng.forced
  ];

  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }

  return undefined;
}
