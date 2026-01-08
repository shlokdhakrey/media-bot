/**
 * NFO Parser
 * 
 * Parses scene NFO files to extract release information.
 * NFO files contain ASCII art and release metadata in various formats.
 * 
 * Supports:
 * - Scene group NFOs
 * - Media information sections
 * - Release notes and credits
 */

import { readFile } from 'node:fs/promises';
import { logger } from '@media-bot/utils';

export interface NFOParseResult {
  // Raw content
  raw: string;
  rawClean: string; // Stripped of ASCII art
  
  // Release info
  releaseName?: string;
  releaseDate?: string;
  group?: string;
  
  // Content info
  title?: string;
  originalTitle?: string;
  year?: number;
  imdbId?: string;
  tvdbId?: string;
  tmdbId?: string;
  
  // Media info from NFO
  runtime?: string;
  resolution?: string;
  videoCodec?: string;
  videoBitrate?: string;
  audioCodec?: string;
  audioBitrate?: string;
  audioChannels?: string;
  audioLanguages?: string[];
  subtitleLanguages?: string[];
  frameRate?: string;
  aspectRatio?: string;
  fileSize?: string;
  container?: string;
  
  // Source info
  source?: string;
  encoder?: string;
  encoderSettings?: string;
  
  // Release notes
  notes?: string[];
  
  // Detected sections
  sections: NFOSection[];
  
  // Parsing info
  isValid: boolean;
  issues: string[];
}

export interface NFOSection {
  name: string;
  content: string;
  startLine: number;
  endLine: number;
}

// Common NFO patterns
const PATTERNS = {
  // Release name
  releaseName: /(?:Release(?:\s*Name)?|Rls(?:\s*Name)?)\s*[:\.]?\s*(.+)/i,
  
  // Release date
  releaseDate: /(?:Release(?:\s*Date)?|Rls(?:\s*Date)?|Date)\s*[:\.]?\s*(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}|\d{4}[\.\/-]\d{1,2}[\.\/-]\d{1,2})/i,
  
  // Group name
  group: /(?:Group|Team|Crew|Grp)\s*[:\.]?\s*(\S+)/i,
  groupFromArt: /\s+([A-Z][A-Za-z0-9]+)\s+(?:presents|proudly)/i,
  
  // Title
  title: /(?:Title|Movie|Film|Show)\s*[:\.]?\s*(.+)/i,
  originalTitle: /(?:Original\s*Title|Orig\.?\s*Title)\s*[:\.]?\s*(.+)/i,
  
  // Year
  year: /(?:Year|Release\s*Year)\s*[:\.]?\s*(\d{4})/i,
  
  // IDs
  imdbId: /(?:IMDB|IMDb)\s*[:\.]?\s*(?:tt)?(\d{7,8})|imdb\.com\/title\/(tt\d{7,8})/i,
  tvdbId: /(?:TVDB|TheTVDB)\s*[:\.]?\s*(\d+)|thetvdb\.com\/.*?(\d+)/i,
  tmdbId: /(?:TMDB|TheMovieDB)\s*[:\.]?\s*(\d+)|themoviedb\.org\/(?:movie|tv)\/(\d+)/i,
  
  // Runtime
  runtime: /(?:Runtime|Duration|Length|Run\s*Time)\s*[:\.]?\s*(\d+\s*(?:min(?:utes?)?|h(?:ours?)?(?:\s*\d+\s*m(?:in)?)?|\d{1,2}:\d{2}(?::\d{2})?))/i,
  
  // Video info
  resolution: /(?:Resolution|Res)\s*[:\.]?\s*(\d{3,4}\s*[x×]\s*\d{3,4}|\d{3,4}p)/i,
  videoCodec: /(?:Video\s*(?:Codec)?|Codec)\s*[:\.]?\s*((?:x|h)\.?26[45]|HEVC|AVC|VP9|AV1|XviD)/i,
  videoBitrate: /(?:Video\s*)?(?:Bitrate|Bit\s*Rate)\s*[:\.]?\s*([\d\.]+\s*(?:k|m)bps)/i,
  frameRate: /(?:Frame\s*Rate|FPS|Framerate)\s*[:\.]?\s*([\d\.]+\s*(?:fps)?)/i,
  aspectRatio: /(?:Aspect\s*Ratio|AR|DAR)\s*[:\.]?\s*([\d\.]+\s*:\s*[\d\.]+|\d+\.\d+)/i,
  
  // Audio info
  audioCodec: /(?:Audio\s*(?:Codec)?|Sound)\s*[:\.]?\s*(AAC|AC-?3|E-?AC-?3|DTS(?:-HD(?:\s*MA)?)?|TrueHD|FLAC|MP3|Atmos)/i,
  audioBitrate: /(?:Audio\s*)?(?:Bitrate|Bit\s*Rate)\s*[:\.]?\s*([\d\.]+\s*(?:k|m)bps)/i,
  audioChannels: /(?:Channels?|Audio\s*Ch(?:annels?)?)\s*[:\.]?\s*(\d+\.?\d?|[12567]\.[01]|stereo|mono)/i,
  
  // Languages
  audioLanguages: /(?:Audio\s*(?:Lang(?:uages?)?)?|Language)\s*[:\.]?\s*([A-Za-z,\s\/]+)/i,
  subtitles: /(?:Subtitles?|Subs?)\s*[:\.]?\s*([A-Za-z,\s\/]+)/i,
  
  // Size
  fileSize: /(?:Size|File\s*Size)\s*[:\.]?\s*([\d\.]+\s*(?:GB|MB|GiB|MiB))/i,
  
  // Source
  source: /(?:Source|Src)\s*[:\.]?\s*(.+)/i,
  
  // Container
  container: /(?:Container|Format)\s*[:\.]?\s*(MKV|MP4|AVI|M4V)/i,
  
  // Encoder
  encoder: /(?:Encoder|Encoded\s*By|Ripper|Ripped\s*By)\s*[:\.]?\s*(\S+)/i,
  
  // Section headers
  sectionHeader: /^[═╔╗╚╝║├┤┬┴┼─│▀▄█▌▐░▒▓\s]*([A-Z][A-Za-z\s]+)[═╔╗╚╝║├┤┬┴┼─│▀▄█▌▐░▒▓\s]*$/,
  sectionDivider: /^[═╔╗╚╝║├┤┬┴┼─│▀▄█▌▐░▒▓\-=_~*]+$/,
};

export class NFOParser {
  /**
   * Parse an NFO file from disk
   */
  async parseFile(filePath: string): Promise<NFOParseResult> {
    try {
      // NFO files are often CP437 or Latin-1 encoded
      const buffer = await readFile(filePath);
      const content = this.decodeNFO(buffer);
      return this.parse(content);
    } catch (error) {
      return {
        raw: '',
        rawClean: '',
        sections: [],
        isValid: false,
        issues: [`Failed to read NFO file: ${(error as Error).message}`],
      };
    }
  }

  /**
   * Parse NFO content string
   */
  parse(content: string): NFOParseResult {
    const result: NFOParseResult = {
      raw: content,
      rawClean: this.stripAsciiArt(content),
      sections: [],
      isValid: true,
      issues: [],
    };

    // Parse sections first
    result.sections = this.parseSections(content);

    // Extract basic info
    this.extractReleaseInfo(result);
    this.extractContentInfo(result);
    this.extractMediaInfo(result);
    this.extractNotes(result);

    // Validate
    this.validate(result);

    return result;
  }

  /**
   * Decode NFO buffer (handles CP437/Latin-1)
   */
  private decodeNFO(buffer: Buffer): string {
    // Try UTF-8 first
    const utf8 = buffer.toString('utf8');
    if (!utf8.includes('�')) {
      return utf8;
    }

    // Fallback to Latin-1 (covers most CP437 ASCII art)
    return buffer.toString('latin1');
  }

  /**
   * Strip ASCII art and decorations
   */
  private stripAsciiArt(content: string): string {
    const lines = content.split('\n');
    const cleanLines: string[] = [];

    for (const line of lines) {
      // Skip lines that are mostly ASCII art characters
      const artChars = line.match(/[═╔╗╚╝║├┤┬┴┼─│▀▄█▌▐░▒▓]/g)?.length ?? 0;
      const totalChars = line.trim().length;
      
      if (totalChars === 0) {
        cleanLines.push('');
        continue;
      }

      // If more than 50% is art, skip or extract text
      if (artChars / totalChars > 0.5) {
        // Try to extract any actual text
        const text = line.replace(/[═╔╗╚╝║├┤┬┴┼─│▀▄█▌▐░▒▓]/g, ' ').trim();
        if (text.length > 3) {
          cleanLines.push(text);
        }
      } else {
        // Clean line but keep it
        cleanLines.push(line.replace(/[║│]/g, ' ').trim());
      }
    }

    return cleanLines.join('\n');
  }

  /**
   * Parse content into sections
   */
  private parseSections(content: string): NFOSection[] {
    const lines = content.split('\n');
    const sections: NFOSection[] = [];
    
    let currentSection: NFOSection | null = null;
    let contentLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check for section header
      const headerMatch = line.match(PATTERNS.sectionHeader);
      const isDivider = PATTERNS.sectionDivider.test(line);

      if (headerMatch || (isDivider && i < lines.length - 1)) {
        // Save previous section
        if (currentSection) {
          currentSection.content = contentLines.join('\n').trim();
          currentSection.endLine = i - 1;
          sections.push(currentSection);
        }

        // Start new section
        const sectionName = headerMatch 
          ? headerMatch[1].trim() 
          : this.guessSectionName(lines.slice(i + 1, i + 5).join('\n'));

        if (sectionName) {
          currentSection = {
            name: sectionName,
            content: '',
            startLine: i,
            endLine: i,
          };
          contentLines = [];
        }
      } else if (currentSection) {
        contentLines.push(line);
      }
    }

    // Save last section
    if (currentSection) {
      currentSection.content = contentLines.join('\n').trim();
      currentSection.endLine = lines.length - 1;
      sections.push(currentSection);
    }

    return sections;
  }

  /**
   * Guess section name from content
   */
  private guessSectionName(content: string): string {
    const lower = content.toLowerCase();
    
    if (lower.includes('video') || lower.includes('resolution') || lower.includes('codec')) {
      return 'Video';
    }
    if (lower.includes('audio') || lower.includes('sound') || lower.includes('channels')) {
      return 'Audio';
    }
    if (lower.includes('release') || lower.includes('info')) {
      return 'Release Info';
    }
    if (lower.includes('note') || lower.includes('about')) {
      return 'Notes';
    }
    if (lower.includes('greet') || lower.includes('thank')) {
      return 'Greets';
    }
    
    return 'Unknown';
  }

  /**
   * Extract release information
   */
  private extractReleaseInfo(result: NFOParseResult): void {
    const content = result.rawClean;

    // Release name
    const rlsMatch = content.match(PATTERNS.releaseName);
    if (rlsMatch) {
      result.releaseName = rlsMatch[1].trim();
    }

    // Release date
    const dateMatch = content.match(PATTERNS.releaseDate);
    if (dateMatch) {
      result.releaseDate = dateMatch[1];
    }

    // Group
    let groupMatch = content.match(PATTERNS.group);
    if (!groupMatch) {
      groupMatch = content.match(PATTERNS.groupFromArt);
    }
    if (groupMatch) {
      result.group = groupMatch[1].trim();
    }
  }

  /**
   * Extract content information
   */
  private extractContentInfo(result: NFOParseResult): void {
    const content = result.rawClean;

    // Title
    const titleMatch = content.match(PATTERNS.title);
    if (titleMatch) {
      result.title = titleMatch[1].trim();
    }

    // Original title
    const origMatch = content.match(PATTERNS.originalTitle);
    if (origMatch) {
      result.originalTitle = origMatch[1].trim();
    }

    // Year
    const yearMatch = content.match(PATTERNS.year);
    if (yearMatch) {
      result.year = parseInt(yearMatch[1], 10);
    }

    // IMDB ID
    const imdbMatch = content.match(PATTERNS.imdbId);
    if (imdbMatch) {
      const id = imdbMatch[1] || imdbMatch[2];
      result.imdbId = id.startsWith('tt') ? id : `tt${id}`;
    }

    // TVDB ID
    const tvdbMatch = content.match(PATTERNS.tvdbId);
    if (tvdbMatch) {
      result.tvdbId = tvdbMatch[1] || tvdbMatch[2];
    }

    // TMDB ID
    const tmdbMatch = content.match(PATTERNS.tmdbId);
    if (tmdbMatch) {
      result.tmdbId = tmdbMatch[1] || tmdbMatch[2];
    }
  }

  /**
   * Extract media information
   */
  private extractMediaInfo(result: NFOParseResult): void {
    const content = result.rawClean;

    // Runtime
    const runtimeMatch = content.match(PATTERNS.runtime);
    if (runtimeMatch) {
      result.runtime = runtimeMatch[1].trim();
    }

    // Resolution
    const resMatch = content.match(PATTERNS.resolution);
    if (resMatch) {
      result.resolution = resMatch[1].trim();
    }

    // Video codec
    const vCodecMatch = content.match(PATTERNS.videoCodec);
    if (vCodecMatch) {
      result.videoCodec = vCodecMatch[1].trim();
    }

    // Video bitrate
    const vBitrateMatch = content.match(PATTERNS.videoBitrate);
    if (vBitrateMatch) {
      result.videoBitrate = vBitrateMatch[1].trim();
    }

    // Frame rate
    const fpsMatch = content.match(PATTERNS.frameRate);
    if (fpsMatch) {
      result.frameRate = fpsMatch[1].trim();
    }

    // Aspect ratio
    const arMatch = content.match(PATTERNS.aspectRatio);
    if (arMatch) {
      result.aspectRatio = arMatch[1].trim();
    }

    // Audio codec
    const aCodecMatch = content.match(PATTERNS.audioCodec);
    if (aCodecMatch) {
      result.audioCodec = aCodecMatch[1].trim();
    }

    // Audio bitrate
    const aBitrateMatch = content.match(PATTERNS.audioBitrate);
    if (aBitrateMatch) {
      result.audioBitrate = aBitrateMatch[1].trim();
    }

    // Audio channels
    const chMatch = content.match(PATTERNS.audioChannels);
    if (chMatch) {
      result.audioChannels = chMatch[1].trim();
    }

    // Audio languages
    const langMatch = content.match(PATTERNS.audioLanguages);
    if (langMatch) {
      result.audioLanguages = this.parseLanguageList(langMatch[1]);
    }

    // Subtitles
    const subMatch = content.match(PATTERNS.subtitles);
    if (subMatch) {
      result.subtitleLanguages = this.parseLanguageList(subMatch[1]);
    }

    // File size
    const sizeMatch = content.match(PATTERNS.fileSize);
    if (sizeMatch) {
      result.fileSize = sizeMatch[1].trim();
    }

    // Source
    const sourceMatch = content.match(PATTERNS.source);
    if (sourceMatch) {
      result.source = sourceMatch[1].trim();
    }

    // Container
    const containerMatch = content.match(PATTERNS.container);
    if (containerMatch) {
      result.container = containerMatch[1].toUpperCase();
    }

    // Encoder
    const encoderMatch = content.match(PATTERNS.encoder);
    if (encoderMatch) {
      result.encoder = encoderMatch[1].trim();
    }
  }

  /**
   * Parse comma/slash separated language list
   */
  private parseLanguageList(input: string): string[] {
    return input
      .split(/[,\/\|]/)
      .map(lang => lang.trim())
      .filter(lang => lang.length > 0 && lang.length < 30);
  }

  /**
   * Extract notes section
   */
  private extractNotes(result: NFOParseResult): void {
    const notesSection = result.sections.find(
      s => s.name.toLowerCase().includes('note') || 
           s.name.toLowerCase().includes('about')
    );

    if (notesSection && notesSection.content.trim()) {
      result.notes = notesSection.content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    }
  }

  /**
   * Validate parsed result
   */
  private validate(result: NFOParseResult): void {
    if (!result.releaseName && !result.title) {
      result.issues.push('Could not extract release name or title');
    }

    if (!result.group) {
      result.issues.push('Could not identify release group');
    }

    // Check for minimum content
    if (result.rawClean.length < 100) {
      result.issues.push('NFO content seems too short');
      result.isValid = false;
    }
  }

  /**
   * Find NFO file in a directory
   */
  async findNFOFile(dir: string): Promise<string | null> {
    try {
      const { readdir } = await import('node:fs/promises');
      const { join } = await import('node:path');
      
      const files = await readdir(dir);
      const nfoFile = files.find(f => f.toLowerCase().endsWith('.nfo'));
      
      return nfoFile ? join(dir, nfoFile) : null;
    } catch {
      return null;
    }
  }
}

// Singleton instance
export const nfoParser = new NFOParser();