/**
 * Tag Injector
 * 
 * Handles metadata tagging for media files.
 * Supports multiple container formats and tag standards.
 * 
 * Features:
 * - Matroska native tags (nested structure)
 * - MP4 iTunes-style metadata
 * - Scene release metadata extraction and injection
 * - Cover art embedding
 * - Custom tag schemas
 */

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname, join, basename } from 'node:path';

export interface MediaTag {
  name: string;
  value: string | number | Buffer;
  language?: string;         // ISO 639-2 (e.g., 'eng')
  isDefault?: boolean;
  targetType?: TagTarget;    // What this tag applies to
}

export type TagTarget = 
  | 'collection'             // TARGETTYPE 70 - TV Show, Movie series
  | 'season'                 // TARGETTYPE 60 - Season
  | 'volume'                 // TARGETTYPE 50 - Album, Movie
  | 'part'                   // TARGETTYPE 40 - Part of volume
  | 'track'                  // TARGETTYPE 30 - Episode, Track
  | 'subtrack';              // TARGETTYPE 20 - Scene

export interface TagSet {
  // Standard tags
  title?: string;
  sortTitle?: string;
  originalTitle?: string;
  
  // Content info
  description?: string;
  synopsis?: string;
  genre?: string | string[];
  mood?: string | string[];
  
  // Release info
  releaseDate?: string;       // YYYY-MM-DD
  releaseYear?: number;
  country?: string;
  originalLanguage?: string;
  
  // Credits
  director?: string | string[];
  writer?: string | string[];
  producer?: string | string[];
  actor?: string | string[];
  composer?: string | string[];
  
  // TV-specific
  showTitle?: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  network?: string;
  
  // Movie-specific
  collection?: string;         // Movie series name
  collectionIndex?: number;    // Position in series
  
  // Technical
  encoder?: string;
  encodingSettings?: string;
  contentRating?: string;      // e.g., "TV-MA", "R"
  
  // Scene-specific
  releaseGroup?: string;
  source?: string;             // BluRay, WEB-DL, HDTV, etc.
  videoCodec?: string;
  audioCodec?: string;
  resolution?: string;
  
  // Cover art
  coverArt?: Buffer | string;  // Buffer or file path
  
  // Custom tags
  custom?: Record<string, string | number>;
}

export interface TagInjectorConfig {
  mkvpropeditPath?: string;
  ffmpegPath?: string;
  atomicparsleyPath?: string;  // For MP4 tagging
  tempDir?: string;
}

export interface TagResult {
  success: boolean;
  tagsWritten: number;
  error?: string;
}

export class TagInjector extends EventEmitter {
  private config: Required<TagInjectorConfig>;

  constructor(config: TagInjectorConfig = {}) {
    super();
    
    this.config = {
      mkvpropeditPath: config.mkvpropeditPath ?? 'mkvpropedit',
      ffmpegPath: config.ffmpegPath ?? 'ffmpeg',
      atomicparsleyPath: config.atomicparsleyPath ?? 'AtomicParsley',
      tempDir: config.tempDir ?? '',
    };
  }

  /**
   * Inject tags into a media file
   */
  async inject(filePath: string, tags: TagSet): Promise<TagResult> {
    const ext = extname(filePath).toLowerCase();

    switch (ext) {
      case '.mkv':
      case '.mka':
      case '.mks':
      case '.webm':
        return this.injectMkv(filePath, tags);
      case '.mp4':
      case '.m4v':
      case '.m4a':
        return this.injectMp4(filePath, tags);
      default:
        return this.injectFFmpeg(filePath, tags);
    }
  }

  /**
   * Read tags from a media file
   */
  async read(filePath: string): Promise<TagSet> {
    const ext = extname(filePath).toLowerCase();

    switch (ext) {
      case '.mkv':
      case '.mka':
      case '.mks':
        return this.readMkv(filePath);
      case '.mp4':
      case '.m4v':
      case '.m4a':
        return this.readMp4(filePath);
      default:
        return this.readFFprobe(filePath);
    }
  }

  /**
   * Clear all tags from a file
   */
  async clear(filePath: string): Promise<{ success: boolean; error?: string }> {
    const ext = extname(filePath).toLowerCase();

    if (['.mkv', '.mka', '.mks', '.webm'].includes(ext)) {
      const args = [filePath, '--tags', 'all:'];
      const result = await this.execute(this.config.mkvpropeditPath, args);
      return {
        success: result.exitCode === 0,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    }

    // For other formats, would need to remux without metadata
    return { success: false, error: 'Clearing tags not supported for this format' };
  }

  /**
   * Generate tags from scene release name
   */
  parseSceneName(releaseName: string): Partial<TagSet> {
    const tags: Partial<TagSet> = {};

    // Extract release group (usually at the end after last dash)
    const groupMatch = releaseName.match(/-([a-zA-Z0-9]+)$/);
    if (groupMatch) {
      tags.releaseGroup = groupMatch[1];
    }

    // Extract resolution
    const resMatch = releaseName.match(/\b(2160p|1080p|1080i|720p|576p|480p|4K|UHD)\b/i);
    if (resMatch) {
      tags.resolution = resMatch[1]?.toUpperCase();
    }

    // Extract source
    const sourcePatterns = [
      { pattern: /\b(BluRay|Blu-Ray|BDRip|BRRip)\b/i, source: 'BluRay' },
      { pattern: /\b(WEB-DL|WEBDL)\b/i, source: 'WEB-DL' },
      { pattern: /\b(WEBRip|WEB)\b/i, source: 'WEBRip' },
      { pattern: /\b(HDTV|PDTV|DSR)\b/i, source: 'HDTV' },
      { pattern: /\b(DVDRip|DVD)\b/i, source: 'DVDRip' },
      { pattern: /\b(AMZN|NF|DSNP|HMAX|ATVP|PMTP)\b/i, source: (m: string) => m.toUpperCase() },
    ];

    for (const { pattern, source } of sourcePatterns) {
      const match = releaseName.match(pattern);
      if (match) {
        tags.source = typeof source === 'function' ? source(match[1]!) : source;
        break;
      }
    }

    // Extract video codec
    const videoCodecMatch = releaseName.match(/\b(x264|x265|H\.?264|H\.?265|HEVC|AVC|VP9|AV1|XviD|DivX)\b/i);
    if (videoCodecMatch) {
      tags.videoCodec = videoCodecMatch[1]?.replace(/\./g, '');
    }

    // Extract audio codec
    const audioCodecMatch = releaseName.match(/\b(DTS-HD\.?MA|DTS-HD|DTS|TrueHD|Atmos|DD\+?|AC3|AAC|FLAC|EAC3|DD5\.?1|DDP5\.?1)\b/i);
    if (audioCodecMatch) {
      tags.audioCodec = audioCodecMatch[1]?.replace(/\./g, '');
    }

    // Extract year
    const yearMatch = releaseName.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      tags.releaseYear = parseInt(yearMatch[0]!);
    }

    // Extract TV episode info
    const tvMatch = releaseName.match(/S(\d{1,2})E(\d{1,2})/i);
    if (tvMatch) {
      tags.season = parseInt(tvMatch[1]!);
      tags.episode = parseInt(tvMatch[2]!);
      
      // Extract show title (everything before SxxExx)
      const titlePart = releaseName.substring(0, tvMatch.index);
      tags.showTitle = this.cleanTitle(titlePart);
    } else {
      // Movie - extract title (everything before year)
      const titleMatch = releaseName.match(/^(.+?)\s*(19|20)\d{2}/);
      if (titleMatch) {
        tags.title = this.cleanTitle(titleMatch[1]!);
      }
    }

    return tags;
  }

  /**
   * Create scene-style release tags
   */
  createSceneTags(info: {
    title: string;
    year?: number;
    resolution: string;
    source: string;
    videoCodec: string;
    audioCodec?: string;
    group: string;
    season?: number;
    episode?: number;
  }): TagSet {
    return {
      title: info.title,
      releaseYear: info.year,
      resolution: info.resolution,
      source: info.source,
      videoCodec: info.videoCodec,
      audioCodec: info.audioCodec,
      releaseGroup: info.group,
      season: info.season,
      episode: info.episode,
      encoder: `${info.videoCodec}/${info.audioCodec ?? 'AAC'}`,
    };
  }

  // Private methods - MKV

  private async injectMkv(filePath: string, tags: TagSet): Promise<TagResult> {
    // Create XML tag file
    const tagXml = this.createMkvTagXml(tags);
    const tempTagFile = join(
      this.config.tempDir || dirname(filePath),
      `tags_${Date.now()}.xml`
    );

    await mkdir(dirname(tempTagFile), { recursive: true });
    await writeFile(tempTagFile, tagXml, 'utf-8');

    try {
      const args = [filePath, '--tags', `global:${tempTagFile}`];

      // Handle cover art
      if (tags.coverArt) {
        const coverPath = typeof tags.coverArt === 'string' 
          ? tags.coverArt 
          : await this.saveTempCover(tags.coverArt);
        args.push('--add-attachment', coverPath);
        args.push('--attachment-name', 'cover.jpg');
        args.push('--attachment-mime-type', 'image/jpeg');
      }

      const result = await this.execute(this.config.mkvpropeditPath, args);

      return {
        success: result.exitCode === 0,
        tagsWritten: this.countTags(tags),
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    } finally {
      try {
        const { unlink } = await import('node:fs/promises');
        await unlink(tempTagFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private async readMkv(filePath: string): Promise<TagSet> {
    // Use mkvinfo or mkvmerge -J
    const args = ['-J', filePath];
    const result = await this.execute(this.config.mkvpropeditPath.replace('mkvpropedit', 'mkvmerge'), args);

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return {};
    }

    try {
      const info = JSON.parse(result.stdout);
      return this.parseMkvTags(info);
    } catch {
      return {};
    }
  }

  private createMkvTagXml(tags: TagSet): string {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<!DOCTYPE Tags SYSTEM "matroskatags.dtd">\n';
    xml += '<Tags>\n';

    // Movie/Episode level tags (TARGETTYPE 50)
    xml += '  <Tag>\n';
    xml += '    <Targets>\n';
    xml += '      <TargetTypeValue>50</TargetTypeValue>\n';
    xml += '    </Targets>\n';

    // Standard tags
    if (tags.title) xml += this.mkvSimpleTag('TITLE', tags.title);
    if (tags.sortTitle) xml += this.mkvSimpleTag('SORT_WITH', tags.sortTitle);
    if (tags.originalTitle) xml += this.mkvSimpleTag('ORIGINAL_TITLE', tags.originalTitle);
    if (tags.description) xml += this.mkvSimpleTag('DESCRIPTION', tags.description);
    if (tags.synopsis) xml += this.mkvSimpleTag('SYNOPSIS', tags.synopsis);
    if (tags.releaseDate) xml += this.mkvSimpleTag('DATE_RELEASED', tags.releaseDate);
    if (tags.releaseYear) xml += this.mkvSimpleTag('DATE_RELEASED', tags.releaseYear.toString());
    if (tags.country) xml += this.mkvSimpleTag('COUNTRY', tags.country);

    // Genres
    if (tags.genre) {
      const genres = Array.isArray(tags.genre) ? tags.genre : [tags.genre];
      for (const genre of genres) {
        xml += this.mkvSimpleTag('GENRE', genre);
      }
    }

    // Credits
    if (tags.director) {
      const directors = Array.isArray(tags.director) ? tags.director : [tags.director];
      for (const dir of directors) {
        xml += this.mkvSimpleTag('DIRECTOR', dir);
      }
    }

    if (tags.actor) {
      const actors = Array.isArray(tags.actor) ? tags.actor : [tags.actor];
      for (const actor of actors) {
        xml += this.mkvSimpleTag('ACTOR', actor);
      }
    }

    // Content rating
    if (tags.contentRating) xml += this.mkvSimpleTag('CONTENT_RATING', tags.contentRating);

    // Encoder info
    if (tags.encoder) xml += this.mkvSimpleTag('ENCODER', tags.encoder);
    if (tags.encodingSettings) xml += this.mkvSimpleTag('ENCODING_SETTINGS', tags.encodingSettings);

    // Scene tags (custom)
    if (tags.releaseGroup) xml += this.mkvSimpleTag('RELEASE_GROUP', tags.releaseGroup);
    if (tags.source) xml += this.mkvSimpleTag('SOURCE_MEDIUM', tags.source);
    if (tags.videoCodec) xml += this.mkvSimpleTag('VIDEO_CODEC', tags.videoCodec);
    if (tags.audioCodec) xml += this.mkvSimpleTag('AUDIO_CODEC', tags.audioCodec);
    if (tags.resolution) xml += this.mkvSimpleTag('RESOLUTION', tags.resolution);

    // Custom tags
    if (tags.custom) {
      for (const [name, value] of Object.entries(tags.custom)) {
        xml += this.mkvSimpleTag(name.toUpperCase(), value.toString());
      }
    }

    xml += '  </Tag>\n';

    // Collection level tags (TARGETTYPE 70) for TV shows
    if (tags.showTitle || tags.collection) {
      xml += '  <Tag>\n';
      xml += '    <Targets>\n';
      xml += '      <TargetTypeValue>70</TargetTypeValue>\n';
      xml += '    </Targets>\n';
      
      if (tags.showTitle) xml += this.mkvSimpleTag('TITLE', tags.showTitle);
      if (tags.collection) xml += this.mkvSimpleTag('TITLE', tags.collection);
      if (tags.network) xml += this.mkvSimpleTag('NETWORK', tags.network);
      
      xml += '  </Tag>\n';
    }

    // Season level (TARGETTYPE 60)
    if (tags.season !== undefined) {
      xml += '  <Tag>\n';
      xml += '    <Targets>\n';
      xml += '      <TargetTypeValue>60</TargetTypeValue>\n';
      xml += '    </Targets>\n';
      xml += this.mkvSimpleTag('PART_NUMBER', tags.season.toString());
      xml += '  </Tag>\n';
    }

    // Episode level (TARGETTYPE 30)
    if (tags.episode !== undefined) {
      xml += '  <Tag>\n';
      xml += '    <Targets>\n';
      xml += '      <TargetTypeValue>30</TargetTypeValue>\n';
      xml += '    </Targets>\n';
      xml += this.mkvSimpleTag('PART_NUMBER', tags.episode.toString());
      if (tags.episodeTitle) xml += this.mkvSimpleTag('TITLE', tags.episodeTitle);
      xml += '  </Tag>\n';
    }

    xml += '</Tags>\n';
    return xml;
  }

  private mkvSimpleTag(name: string, value: string, language?: string): string {
    let tag = '    <Simple>\n';
    tag += `      <Name>${this.escapeXml(name)}</Name>\n`;
    tag += `      <String>${this.escapeXml(value)}</String>\n`;
    if (language) {
      tag += `      <TagLanguage>${language}</TagLanguage>\n`;
    }
    tag += '    </Simple>\n';
    return tag;
  }

  private parseMkvTags(info: Record<string, unknown>): TagSet {
    const tags: TagSet = {};
    
    // Parse container properties
    const container = info.container as Record<string, unknown> | undefined;
    if (container?.properties) {
      const props = container.properties as Record<string, unknown>;
      if (props.title) tags.title = props.title as string;
    }

    // Would need more complex parsing for full tag support
    return tags;
  }

  // Private methods - MP4

  private async injectMp4(filePath: string, tags: TagSet): Promise<TagResult> {
    // Try AtomicParsley first (better MP4 support)
    try {
      const args = [filePath];

      if (tags.title) args.push('--title', tags.title);
      if (tags.description) args.push('--description', tags.description);
      if (tags.genre) {
        const genre = Array.isArray(tags.genre) ? tags.genre[0] : tags.genre;
        if (genre) args.push('--genre', genre);
      }
      if (tags.releaseYear) args.push('--year', tags.releaseYear.toString());
      if (tags.director) {
        const dir = Array.isArray(tags.director) ? tags.director[0] : tags.director;
        if (dir) args.push('--artist', dir);
      }
      if (tags.showTitle) args.push('--TVShowName', tags.showTitle);
      if (tags.season !== undefined) args.push('--TVSeasonNum', tags.season.toString());
      if (tags.episode !== undefined) args.push('--TVEpisodeNum', tags.episode.toString());
      if (tags.network) args.push('--TVNetwork', tags.network);
      if (tags.contentRating) args.push('--contentRating', tags.contentRating);
      if (tags.encoder) args.push('--encodingTool', tags.encoder);

      // Cover art
      if (tags.coverArt) {
        const coverPath = typeof tags.coverArt === 'string'
          ? tags.coverArt
          : await this.saveTempCover(tags.coverArt);
        args.push('--artwork', coverPath);
      }

      args.push('--overWrite');

      const result = await this.execute(this.config.atomicparsleyPath, args);

      return {
        success: result.exitCode === 0,
        tagsWritten: this.countTags(tags),
        error: result.exitCode !== 0 ? result.stderr : undefined,
      };
    } catch {
      // Fall back to FFmpeg
      return this.injectFFmpeg(filePath, tags);
    }
  }

  private async readMp4(filePath: string): Promise<TagSet> {
    return this.readFFprobe(filePath);
  }

  // Private methods - FFmpeg fallback

  private async injectFFmpeg(filePath: string, tags: TagSet): Promise<TagResult> {
    const ext = extname(filePath);
    const tempOutput = join(
      this.config.tempDir || dirname(filePath),
      `temp_tagged_${Date.now()}${ext}`
    );

    const args = ['-i', filePath, '-c', 'copy'];

    // Add metadata
    if (tags.title) args.push('-metadata', `title=${tags.title}`);
    if (tags.description) args.push('-metadata', `description=${tags.description}`);
    if (tags.genre) {
      const genre = Array.isArray(tags.genre) ? tags.genre.join(', ') : tags.genre;
      args.push('-metadata', `genre=${genre}`);
    }
    if (tags.releaseDate) args.push('-metadata', `date=${tags.releaseDate}`);
    if (tags.releaseYear) args.push('-metadata', `year=${tags.releaseYear}`);
    if (tags.encoder) args.push('-metadata', `encoder=${tags.encoder}`);

    // TV-specific
    if (tags.showTitle) args.push('-metadata', `show=${tags.showTitle}`);
    if (tags.season !== undefined) args.push('-metadata', `season_number=${tags.season}`);
    if (tags.episode !== undefined) args.push('-metadata', `episode_sort=${tags.episode}`);

    // Scene tags as comment
    const sceneTags = [
      tags.releaseGroup && `Group: ${tags.releaseGroup}`,
      tags.source && `Source: ${tags.source}`,
      tags.resolution && `Resolution: ${tags.resolution}`,
    ].filter(Boolean).join(' | ');
    
    if (sceneTags) {
      args.push('-metadata', `comment=${sceneTags}`);
    }

    args.push('-y', tempOutput);

    const result = await this.execute(this.config.ffmpegPath, args);

    if (result.exitCode === 0) {
      // Replace original with tagged file
      const { rename, unlink } = await import('node:fs/promises');
      await unlink(filePath);
      await rename(tempOutput, filePath);
    }

    return {
      success: result.exitCode === 0,
      tagsWritten: this.countTags(tags),
      error: result.exitCode !== 0 ? result.stderr : undefined,
    };
  }

  private async readFFprobe(filePath: string): Promise<TagSet> {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath,
    ];

    const result = await this.execute(this.config.ffmpegPath.replace('ffmpeg', 'ffprobe'), args);
    
    if (result.exitCode !== 0) {
      return {};
    }

    try {
      const data = JSON.parse(result.stdout);
      const rawTags = data.format?.tags ?? {};

      return {
        title: rawTags.title ?? rawTags.TITLE,
        description: rawTags.description ?? rawTags.DESCRIPTION,
        genre: rawTags.genre ?? rawTags.GENRE,
        releaseDate: rawTags.date ?? rawTags.DATE,
        encoder: rawTags.encoder ?? rawTags.ENCODER,
        showTitle: rawTags.show ?? rawTags.SHOW,
      };
    } catch {
      return {};
    }
  }

  // Helper methods

  private async saveTempCover(coverData: Buffer): Promise<string> {
    const tempPath = join(
      this.config.tempDir || '.',
      `cover_${Date.now()}.jpg`
    );
    
    await mkdir(dirname(tempPath), { recursive: true });
    await writeFile(tempPath, coverData);
    
    return tempPath;
  }

  private countTags(tags: TagSet): number {
    let count = 0;
    for (const [key, value] of Object.entries(tags)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          count += value.length;
        } else {
          count++;
        }
      }
    }
    return count;
  }

  private cleanTitle(title: string): string {
    return title
      .replace(/\./g, ' ')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
 * Common content ratings
 */
export const CONTENT_RATINGS = {
  // MPAA (movies)
  G: 'G',
  PG: 'PG',
  PG13: 'PG-13',
  R: 'R',
  NC17: 'NC-17',
  
  // TV ratings
  TV_Y: 'TV-Y',
  TV_Y7: 'TV-Y7',
  TV_G: 'TV-G',
  TV_PG: 'TV-PG',
  TV_14: 'TV-14',
  TV_MA: 'TV-MA',
  
  // International
  PEGI_3: 'PEGI 3',
  PEGI_7: 'PEGI 7',
  PEGI_12: 'PEGI 12',
  PEGI_16: 'PEGI 16',
  PEGI_18: 'PEGI 18',
} as const;

/**
 * Common video sources
 */
export const VIDEO_SOURCES = {
  BLURAY: 'BluRay',
  WEB_DL: 'WEB-DL',
  WEBRIP: 'WEBRip',
  HDTV: 'HDTV',
  DVDRIP: 'DVDRip',
  UHD_BLURAY: 'UHD.BluRay',
  REMUX: 'REMUX',
  
  // Streaming services
  AMZN: 'AMZN',
  NF: 'NF',
  DSNP: 'DSNP',
  HMAX: 'HMAX',
  ATVP: 'ATVP',
  PMTP: 'PMTP',
} as const;
