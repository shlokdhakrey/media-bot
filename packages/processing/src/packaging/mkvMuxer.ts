/**
 * MKV Muxer
 * 
 * Advanced MKV container operations using mkvmerge.
 * Handles track ordering, default flags, forced flags, language tags, and more.
 * 
 * Why mkvmerge over FFmpeg for MKV?
 * - Better MKV-specific features (attachments, editions, segment linking)
 * - Proper handling of default/forced flags
 * - Better font attachment support
 * - Native MKV chapter format support
 */

import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { stat, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import { createHash } from 'node:crypto';

export interface TrackInfo {
  id: number;
  type: 'video' | 'audio' | 'subtitles';
  codec: string;
  language?: string;
  name?: string;
  isDefault?: boolean;
  isForced?: boolean;
  isEnabled?: boolean;
}

export interface InputFile {
  path: string;
  
  // Track selection
  tracks?: number[];              // Which tracks to include (empty = all)
  excludeTracks?: number[];       // Tracks to exclude
  
  // Track properties
  language?: string;              // Override language for all tracks
  trackLanguages?: Record<number, string>;  // Per-track language
  trackNames?: Record<number, string>;      // Per-track names
  defaultTrack?: number | false;            // Which track is default (false = none)
  forcedTrack?: number;                     // Which track is forced
  
  // Timing
  syncOffset?: number;            // Delay in ms (positive = later)
  stretchFactor?: number;         // Speed factor (1.0 = normal)
  
  // Chapters
  noChapters?: boolean;           // Don't copy chapters from this file
  chapterLanguage?: string;       // Override chapter language
  
  // Attachments
  noAttachments?: boolean;        // Don't copy attachments from this file
  
  // Tags
  noTags?: boolean;               // Don't copy tags from this file
}

export interface Attachment {
  path: string;
  name?: string;
  mimeType?: string;
  description?: string;
}

export interface MkvMuxerConfig {
  mkvmergePath?: string;
  mkvextractPath?: string;
  mkvpropeditPath?: string;
  tempDir?: string;
  defaultLanguage?: string;
}

export interface MuxOptions {
  inputs: InputFile[];
  output: string;
  
  // Global options
  title?: string;
  segmentUid?: string;
  
  // Track ordering
  trackOrder?: Array<{ fileIndex: number; trackId: number }>;
  
  // Chapters
  chaptersFile?: string;
  generateChapters?: boolean;
  chapterInterval?: number;       // seconds
  
  // Attachments
  attachments?: Attachment[];
  
  // Tags
  tagsFile?: string;
  globalTags?: Record<string, string>;
  
  // Split options
  split?: SplitOptions;
  
  // Linking
  linkToPrevious?: string;        // Previous segment UID
  linkToNext?: string;            // Next segment UID
  
  // Misc
  noGlobalTags?: boolean;
  noCues?: boolean;
  webm?: boolean;                 // Output as WebM
}

export interface SplitOptions {
  mode: 'size' | 'duration' | 'chapters' | 'timestamps' | 'parts';
  value: string | string[];       // e.g., "700M", "00:30:00", etc.
}

export interface MuxResult {
  success: boolean;
  output: string;
  outputs?: string[];             // Multiple outputs if split
  command: string;
  stdout: string;
  stderr: string;
  duration: number;
  error?: string;
}

export interface ExtractOptions {
  input: string;
  outputDir: string;
  
  // What to extract
  tracks?: Array<{ id: number; output?: string }>;
  attachments?: boolean | number[];
  chapters?: boolean;
  tags?: boolean;
  cuesheet?: boolean;
  timestamps?: number[];          // Track IDs to extract timestamps from
}

export interface ExtractResult {
  success: boolean;
  files: string[];
  command: string;
  error?: string;
}

export class MkvMuxer extends EventEmitter {
  private config: Required<MkvMuxerConfig>;

  constructor(config: MkvMuxerConfig = {}) {
    super();
    
    this.config = {
      mkvmergePath: config.mkvmergePath ?? 'mkvmerge',
      mkvextractPath: config.mkvextractPath ?? 'mkvextract',
      mkvpropeditPath: config.mkvpropeditPath ?? 'mkvpropedit',
      tempDir: config.tempDir ?? '',
      defaultLanguage: config.defaultLanguage ?? 'eng',
    };
  }

  /**
   * Mux files into MKV container
   */
  async mux(options: MuxOptions): Promise<MuxResult> {
    const startTime = Date.now();
    
    // Ensure output directory exists
    await mkdir(dirname(options.output), { recursive: true });

    const args = this.buildMuxCommand(options);
    const command = `mkvmerge ${args.join(' ')}`;

    try {
      const result = await this.execute(this.config.mkvmergePath, args);

      // mkvmerge returns 0 for success, 1 for warnings, 2 for errors
      const success = result.exitCode === 0 || result.exitCode === 1;

      return {
        success,
        output: options.output,
        outputs: options.split ? await this.findSplitOutputs(options.output) : undefined,
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        duration: Date.now() - startTime,
        error: !success ? result.stderr : undefined,
      };
    } catch (error) {
      return {
        success: false,
        output: options.output,
        command,
        stdout: '',
        stderr: '',
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Extract tracks/attachments from MKV
   */
  async extract(options: ExtractOptions): Promise<ExtractResult> {
    await mkdir(options.outputDir, { recursive: true });

    const extractedFiles: string[] = [];
    const errors: string[] = [];

    // Extract tracks
    if (options.tracks && options.tracks.length > 0) {
      const trackArgs: string[] = ['tracks', options.input];
      
      for (const track of options.tracks) {
        const output = track.output ?? join(options.outputDir, `track_${track.id}`);
        trackArgs.push(`${track.id}:${output}`);
        extractedFiles.push(output);
      }

      const result = await this.execute(this.config.mkvextractPath, trackArgs);
      if (result.exitCode !== 0) {
        errors.push(`Track extraction failed: ${result.stderr}`);
      }
    }

    // Extract attachments
    if (options.attachments) {
      const attachArgs: string[] = ['attachments', options.input];
      
      if (Array.isArray(options.attachments)) {
        for (const id of options.attachments) {
          const output = join(options.outputDir, `attachment_${id}`);
          attachArgs.push(`${id}:${output}`);
          extractedFiles.push(output);
        }
      } else {
        // Extract all - need to get attachment list first
        const info = await this.identify(options.input);
        if (info.attachments) {
          for (const att of info.attachments) {
            const output = join(options.outputDir, att.name ?? `attachment_${att.id}`);
            attachArgs.push(`${att.id}:${output}`);
            extractedFiles.push(output);
          }
        }
      }

      if (attachArgs.length > 2) {
        const result = await this.execute(this.config.mkvextractPath, attachArgs);
        if (result.exitCode !== 0) {
          errors.push(`Attachment extraction failed: ${result.stderr}`);
        }
      }
    }

    // Extract chapters
    if (options.chapters) {
      const output = join(options.outputDir, 'chapters.xml');
      const args = ['chapters', options.input, '-s', output];
      
      const result = await this.execute(this.config.mkvextractPath, args);
      if (result.exitCode === 0) {
        extractedFiles.push(output);
      }
    }

    // Extract tags
    if (options.tags) {
      const output = join(options.outputDir, 'tags.xml');
      const args = ['tags', options.input, '-s', output];
      
      const result = await this.execute(this.config.mkvextractPath, args);
      if (result.exitCode === 0) {
        extractedFiles.push(output);
      }
    }

    return {
      success: errors.length === 0,
      files: extractedFiles,
      command: `mkvextract ... (multiple commands)`,
      error: errors.length > 0 ? errors.join('\n') : undefined,
    };
  }

  /**
   * Get information about MKV file
   */
  async identify(input: string): Promise<{
    container: {
      type: string;
      duration?: number;
      title?: string;
    };
    tracks: TrackInfo[];
    attachments?: Array<{ id: number; name: string; mimeType: string; size: number }>;
    chapters?: number;
  }> {
    const args = ['-J', input];
    const result = await this.execute(this.config.mkvmergePath, args);

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(`Failed to identify file: ${result.stderr}`);
    }

    const info = JSON.parse(result.stdout);

    return {
      container: {
        type: info.container?.type ?? 'unknown',
        duration: info.container?.properties?.duration 
          ? Math.floor(info.container.properties.duration / 1000000000)
          : undefined,
        title: info.container?.properties?.title,
      },
      tracks: (info.tracks ?? []).map((t: Record<string, unknown>) => ({
        id: t.id as number,
        type: t.type as string,
        codec: t.codec as string,
        language: (t.properties as Record<string, unknown>)?.language as string | undefined,
        name: (t.properties as Record<string, unknown>)?.track_name as string | undefined,
        isDefault: (t.properties as Record<string, unknown>)?.default_track as boolean | undefined,
        isForced: (t.properties as Record<string, unknown>)?.forced_track as boolean | undefined,
        isEnabled: (t.properties as Record<string, unknown>)?.enabled_track as boolean | undefined,
      })),
      attachments: info.attachments?.map((a: Record<string, unknown>) => ({
        id: a.id as number,
        name: a.file_name as string,
        mimeType: a.content_type as string,
        size: a.size as number,
      })),
      chapters: info.chapters?.length,
    };
  }

  /**
   * Edit properties of existing MKV file in-place
   */
  async editProperties(
    input: string,
    edits: {
      title?: string;
      trackProperties?: Array<{
        selector: string;  // e.g., "track:v1", "track:a2", "track:s1"
        properties: Record<string, string | boolean | number>;
      }>;
      attachmentEdits?: Array<{
        action: 'add' | 'delete' | 'replace';
        id?: number;
        attachment?: Attachment;
      }>;
      chaptersFile?: string;
      tagsFile?: string;
    }
  ): Promise<{ success: boolean; error?: string }> {
    const args: string[] = [input];

    // Edit title
    if (edits.title !== undefined) {
      args.push('--edit', 'info', '--set', `title=${edits.title}`);
    }

    // Edit track properties
    if (edits.trackProperties) {
      for (const track of edits.trackProperties) {
        args.push('--edit', track.selector);
        for (const [key, value] of Object.entries(track.properties)) {
          const propName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
          args.push('--set', `${propName}=${value}`);
        }
      }
    }

    // Edit attachments
    if (edits.attachmentEdits) {
      for (const edit of edits.attachmentEdits) {
        if (edit.action === 'add' && edit.attachment) {
          args.push('--add-attachment', edit.attachment.path);
          if (edit.attachment.name) {
            args.push('--attachment-name', edit.attachment.name);
          }
          if (edit.attachment.mimeType) {
            args.push('--attachment-mime-type', edit.attachment.mimeType);
          }
        } else if (edit.action === 'delete' && edit.id !== undefined) {
          args.push('--delete-attachment', edit.id.toString());
        } else if (edit.action === 'replace' && edit.id !== undefined && edit.attachment) {
          args.push('--replace-attachment', `${edit.id}:${edit.attachment.path}`);
        }
      }
    }

    // Replace chapters
    if (edits.chaptersFile) {
      args.push('--chapters', edits.chaptersFile);
    }

    // Replace tags
    if (edits.tagsFile) {
      args.push('--tags', `global:${edits.tagsFile}`);
    }

    const result = await this.execute(this.config.mkvpropeditPath, args);

    return {
      success: result.exitCode === 0,
      error: result.exitCode !== 0 ? result.stderr : undefined,
    };
  }

  // Private methods

  private buildMuxCommand(options: MuxOptions): string[] {
    const args: string[] = [];

    // Output file first
    args.push('-o', options.output);

    // Global options
    if (options.title) {
      args.push('--title', options.title);
    }

    if (options.segmentUid) {
      args.push('--segment-uid', options.segmentUid);
    }

    if (options.linkToPrevious) {
      args.push('--link-to-previous', `=${options.linkToPrevious}`);
    }

    if (options.linkToNext) {
      args.push('--link-to-next', `=${options.linkToNext}`);
    }

    if (options.webm) {
      args.push('--webm');
    }

    if (options.noGlobalTags) {
      args.push('--no-global-tags');
    }

    // Chapters
    if (options.chaptersFile) {
      args.push('--chapters', options.chaptersFile);
    } else if (options.generateChapters && options.chapterInterval) {
      args.push('--generate-chapters', `interval:${options.chapterInterval}s`);
    }

    // Tags
    if (options.tagsFile) {
      args.push('--global-tags', options.tagsFile);
    }

    // Attachments
    if (options.attachments) {
      for (const att of options.attachments) {
        args.push('--attach-file', att.path);
        if (att.name) {
          args.push('--attachment-name', att.name);
        }
        if (att.mimeType) {
          args.push('--attachment-mime-type', att.mimeType);
        }
        if (att.description) {
          args.push('--attachment-description', att.description);
        }
      }
    }

    // Split options
    if (options.split) {
      args.push(...this.buildSplitArgs(options.split));
    }

    // Track order
    if (options.trackOrder && options.trackOrder.length > 0) {
      const order = options.trackOrder.map(t => `${t.fileIndex}:${t.trackId}`).join(',');
      args.push('--track-order', order);
    }

    // Input files
    for (const input of options.inputs) {
      args.push(...this.buildInputArgs(input));
    }

    return args;
  }

  private buildInputArgs(input: InputFile): string[] {
    const args: string[] = [];

    // Track selection
    if (input.tracks && input.tracks.length > 0) {
      args.push('--video-tracks', input.tracks.filter(() => true).join(','));
      args.push('--audio-tracks', input.tracks.filter(() => true).join(','));
      args.push('--subtitle-tracks', input.tracks.filter(() => true).join(','));
    }

    if (input.excludeTracks && input.excludeTracks.length > 0) {
      args.push('--video-tracks', `!${input.excludeTracks.join(',!')}`);
      args.push('--audio-tracks', `!${input.excludeTracks.join(',!')}`);
      args.push('--subtitle-tracks', `!${input.excludeTracks.join(',!')}`);
    }

    // Language
    if (input.language) {
      args.push('--language', `-1:${input.language}`);
    }

    if (input.trackLanguages) {
      for (const [trackId, lang] of Object.entries(input.trackLanguages)) {
        args.push('--language', `${trackId}:${lang}`);
      }
    }

    // Track names
    if (input.trackNames) {
      for (const [trackId, name] of Object.entries(input.trackNames)) {
        args.push('--track-name', `${trackId}:${name}`);
      }
    }

    // Default track
    if (input.defaultTrack !== undefined) {
      if (input.defaultTrack === false) {
        args.push('--default-track-flag', '-1:no');
      } else {
        args.push('--default-track-flag', `${input.defaultTrack}:yes`);
      }
    }

    // Forced track
    if (input.forcedTrack !== undefined) {
      args.push('--forced-display-flag', `${input.forcedTrack}:yes`);
    }

    // Sync offset
    if (input.syncOffset !== undefined && input.syncOffset !== 0) {
      args.push('--sync', `-1:${input.syncOffset}`);
    }

    // Stretch factor
    if (input.stretchFactor !== undefined && input.stretchFactor !== 1.0) {
      // Convert to d,n/d format
      const factor = input.stretchFactor;
      if (factor > 1) {
        args.push('--sync', `-1:0,${Math.round(factor * 1000)}/1000`);
      } else {
        args.push('--sync', `-1:0,1000/${Math.round(1000 / factor)}`);
      }
    }

    // Chapters
    if (input.noChapters) {
      args.push('--no-chapters');
    }

    if (input.chapterLanguage) {
      args.push('--chapter-language', input.chapterLanguage);
    }

    // Attachments
    if (input.noAttachments) {
      args.push('--no-attachments');
    }

    // Tags
    if (input.noTags) {
      args.push('--no-tags');
    }

    // Input file
    args.push(input.path);

    return args;
  }

  private buildSplitArgs(split: SplitOptions): string[] {
    switch (split.mode) {
      case 'size':
        return ['--split', `size:${split.value}`];
      case 'duration':
        return ['--split', `duration:${split.value}`];
      case 'chapters':
        return ['--split', 'chapters:all'];
      case 'timestamps':
        if (Array.isArray(split.value)) {
          return ['--split', `timestamps:${split.value.join(',')}`];
        }
        return ['--split', `timestamps:${split.value}`];
      case 'parts':
        if (Array.isArray(split.value)) {
          return ['--split', `parts:${split.value.join(',')}`];
        }
        return ['--split', `parts:${split.value}`];
      default:
        return [];
    }
  }

  private async findSplitOutputs(output: string): Promise<string[]> {
    const dir = dirname(output);
    const base = basename(output, extname(output));
    const ext = extname(output);
    
    const outputs: string[] = [];
    
    // mkvmerge names split files as: output-001.mkv, output-002.mkv, etc.
    for (let i = 1; i <= 999; i++) {
      const splitPath = join(dir, `${base}-${i.toString().padStart(3, '0')}${ext}`);
      try {
        await stat(splitPath);
        outputs.push(splitPath);
      } catch {
        break;
      }
    }

    return outputs.length > 0 ? outputs : [output];
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
 * Generate a random segment UID
 */
export function generateSegmentUid(): string {
  return createHash('md5')
    .update(Date.now().toString() + Math.random().toString())
    .digest('hex');
}
