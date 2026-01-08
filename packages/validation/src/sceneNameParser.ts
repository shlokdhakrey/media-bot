/**
 * Scene Naming Parser
 * 
 * Parses scene release names following standard conventions.
 * Supports movies, TV shows, music, and software naming patterns.
 * 
 * Examples:
 * - Movie.Title.2024.1080p.BluRay.x264-GROUP
 * - Show.Name.S01E02.Episode.Title.720p.WEB-DL.AAC2.0.H.264-GROUP
 * - Artist-Album-2024-GROUP
 */

export interface ParsedReleaseName {
  // Original input
  raw: string;
  
  // Content type
  type: 'movie' | 'tv' | 'music' | 'software' | 'unknown';
  
  // Basic info
  title: string;
  year?: number;
  group?: string;
  
  // TV specific
  season?: number;
  episode?: number;
  episodeEnd?: number; // For multi-episode releases
  episodeTitle?: string;
  daily?: { year: number; month: number; day: number };
  
  // Quality info
  resolution?: string;
  source?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: string;
  
  // Flags
  proper?: boolean;
  repack?: boolean;
  real?: boolean;
  internal?: boolean;
  dirfix?: boolean;
  nfofix?: boolean;
  samplefix?: boolean;
  prooffix?: boolean;
  
  // Special editions
  edition?: string;
  extended?: boolean;
  uncut?: boolean;
  unrated?: boolean;
  directors?: boolean;
  theatrical?: boolean;
  remastered?: boolean;
  
  // HDR/3D
  hdr?: string;
  is3d?: boolean;
  
  // Audio
  dualAudio?: boolean;
  multilingual?: boolean;
  subbed?: boolean;
  dubbed?: boolean;
  language?: string;
  
  // Container
  container?: string;
  
  // Music specific
  artist?: string;
  album?: string;
  genre?: string;
  bitrate?: string;
  
  // Validation
  isValid: boolean;
  issues: string[];
}

// Pattern definitions
const PATTERNS = {
  // Resolution patterns
  resolution: /\b(2160p|1080p|1080i|720p|576p|576i|480p|480i|4k|uhd)\b/i,
  
  // Source patterns
  source: /\b(BluRay|Blu-Ray|BDRip|BRRip|HDTV|PDTV|DVDRip|DVDScr|DVD-R|DVDR|WEBRip|WEB-DL|WEBDL|WEB|HDCAM|CAM|TS|TELESYNC|TC|TELECINE|SCR|SCREENER|R5|VHSRip|LaserDisc|AMZN|NF|DSNP|HMAX|ATVP|PCOK|PMTP|iT|HULU)\b/i,
  
  // Video codec patterns
  videoCodec: /\b(x264|x\.264|h\.264|h264|x265|x\.265|h\.265|h265|HEVC|AVC|XviD|DivX|VP9|AV1|MPEG2|MPEG-2)\b/i,
  
  // Audio codec patterns
  audioCodec: /\b(AAC|AC3|AC-3|EAC3|E-AC-3|DTS|DTS-HD|DTS-HD\.MA|TrueHD|Atmos|FLAC|MP3|OGG|LPCM|DD5\.1|DD|DD2\.0|DDPlus)\b/i,
  
  // Audio channels
  audioChannels: /\b(7\.1|5\.1|2\.1|2\.0|1\.0|Stereo|Mono)\b/i,
  
  // Year pattern
  year: /\b(19[0-9]{2}|20[0-9]{2})\b/,
  
  // TV patterns
  tvSeason: /\bS(\d{1,2})(?:E(\d{1,3})(?:-?E?(\d{1,3}))?)?\b/i,
  tvSeasonFull: /\bSeason\s*(\d{1,2})\b/i,
  tvEpisodeOnly: /\bE(\d{1,3})(?:-?E?(\d{1,3}))?\b/i,
  tvDaily: /\b(\d{4})\.(\d{2})\.(\d{2})\b/,
  
  // Group pattern (usually at end after dash)
  group: /-([A-Za-z0-9]+)$/,
  
  // Flags
  proper: /\bPROPER\b/i,
  repack: /\bREPACK\b/i,
  real: /\bREAL\b/i,
  internal: /\bINTERNAL|iNTERNAL\b/,
  dirfix: /\bDIRFIX\b/i,
  nfofix: /\bNFOFIX\b/i,
  samplefix: /\bSAMPLEFIX\b/i,
  prooffix: /\bPROOFFIX\b/i,
  
  // Special editions
  extended: /\bEXTENDED\b/i,
  uncut: /\bUNCUT\b/i,
  unrated: /\bUNRATED\b/i,
  directors: /\bDIRECTORS?\s*CUT|DC\b/i,
  theatrical: /\bTHEATRICAL\b/i,
  remastered: /\bREMASTERED\b/i,
  edition: /\b(COLLECTORS?|SPECIAL|LIMITED|ANNIVERSARY|CRITERION|DIAMOND|ULTIMATE|DELUXE)\s*EDITION\b/i,
  
  // HDR
  hdr: /\b(HDR10\+?|HDR|DV|DoVi|Dolby\.?Vision|HLG)\b/i,
  
  // 3D
  is3d: /\b(3D|SBS|HSBS|OU|HOU|Half-SBS|Full-SBS)\b/i,
  
  // Audio flags
  dualAudio: /\bDual\.?Audio|DA\b/i,
  multilingual: /\bMULTi\b/i,
  subbed: /\bSUBBED|SUBS?\b/i,
  dubbed: /\bDUBBED|DUB\b/i,
  
  // Container
  container: /\b(MKV|MP4|AVI|M4V|WMV|MOV|M2TS|TS)\b/i,
  
  // Music patterns
  musicBitrate: /\b(\d{2,4})\s*k(?:bps)?\b/i,
  musicFormat: /\b(MP3|FLAC|AAC|OGG|ALAC|WAV|WMA)\b/i,
  musicType: /\b(Album|Single|EP|Compilation|Discography|Anthology)\b/i,
};

export class SceneNameParser {
  /**
   * Parse a release name into structured data
   */
  parse(releaseName: string): ParsedReleaseName {
    const result: ParsedReleaseName = {
      raw: releaseName,
      type: 'unknown',
      title: '',
      isValid: true,
      issues: [],
    };

    // Clean the input
    let name = releaseName.trim();
    
    // Detect type and parse accordingly
    if (this.looksLikeTV(name)) {
      result.type = 'tv';
      this.parseTVRelease(name, result);
    } else if (this.looksLikeMusic(name)) {
      result.type = 'music';
      this.parseMusicRelease(name, result);
    } else {
      result.type = 'movie';
      this.parseMovieRelease(name, result);
    }

    // Parse common elements
    this.parseQuality(name, result);
    this.parseFlags(name, result);
    this.parseGroup(name, result);

    // Validate the result
    this.validate(result);

    return result;
  }

  /**
   * Check if release looks like a TV show
   */
  private looksLikeTV(name: string): boolean {
    return PATTERNS.tvSeason.test(name) || 
           PATTERNS.tvSeasonFull.test(name) ||
           PATTERNS.tvDaily.test(name);
  }

  /**
   * Check if release looks like music
   */
  private looksLikeMusic(name: string): boolean {
    // Music releases typically use dashes between artist-album-year
    const dashCount = (name.match(/-/g) || []).length;
    const hasYear = PATTERNS.year.test(name);
    const hasResolution = PATTERNS.resolution.test(name);
    const hasMusicFormat = PATTERNS.musicFormat.test(name) || PATTERNS.musicBitrate.test(name);
    
    return hasMusicFormat && !hasResolution && dashCount >= 2;
  }

  /**
   * Parse TV release
   */
  private parseTVRelease(name: string, result: ParsedReleaseName): void {
    // Extract season/episode
    const tvMatch = name.match(PATTERNS.tvSeason);
    if (tvMatch) {
      result.season = parseInt(tvMatch[1], 10);
      if (tvMatch[2]) {
        result.episode = parseInt(tvMatch[2], 10);
      }
      if (tvMatch[3]) {
        result.episodeEnd = parseInt(tvMatch[3], 10);
      }
    }

    // Check for daily format
    const dailyMatch = name.match(PATTERNS.tvDaily);
    if (dailyMatch) {
      result.daily = {
        year: parseInt(dailyMatch[1], 10),
        month: parseInt(dailyMatch[2], 10),
        day: parseInt(dailyMatch[3], 10),
      };
    }

    // Extract title (everything before S##E##)
    let titleEnd = name.search(PATTERNS.tvSeason);
    if (titleEnd === -1) {
      titleEnd = name.search(PATTERNS.tvDaily);
    }
    
    if (titleEnd > 0) {
      result.title = this.cleanTitle(name.substring(0, titleEnd));
    }

    // Try to extract episode title (between S##E## and quality info)
    if (tvMatch) {
      const afterEpisode = name.substring(tvMatch.index! + tvMatch[0].length);
      const qualityStart = afterEpisode.search(PATTERNS.resolution) || 
                           afterEpisode.search(PATTERNS.source);
      
      if (qualityStart > 1) {
        result.episodeTitle = this.cleanTitle(afterEpisode.substring(0, qualityStart));
      }
    }

    // Extract year if present
    const yearMatch = name.match(PATTERNS.year);
    if (yearMatch && !result.daily) {
      result.year = parseInt(yearMatch[1], 10);
    }
  }

  /**
   * Parse movie release
   */
  private parseMovieRelease(name: string, result: ParsedReleaseName): void {
    // Find year
    const yearMatch = name.match(PATTERNS.year);
    if (yearMatch) {
      result.year = parseInt(yearMatch[1], 10);
      // Title is everything before year
      const yearIndex = name.indexOf(yearMatch[0]);
      result.title = this.cleanTitle(name.substring(0, yearIndex));
    } else {
      // No year found - title is everything before quality info
      let titleEnd = name.search(PATTERNS.resolution);
      if (titleEnd === -1) titleEnd = name.search(PATTERNS.source);
      if (titleEnd === -1) titleEnd = name.search(PATTERNS.videoCodec);
      
      if (titleEnd > 0) {
        result.title = this.cleanTitle(name.substring(0, titleEnd));
      } else {
        // Fallback - remove group and use rest as title
        const groupMatch = name.match(PATTERNS.group);
        if (groupMatch) {
          result.title = this.cleanTitle(name.substring(0, groupMatch.index));
        } else {
          result.title = this.cleanTitle(name);
        }
      }
    }
  }

  /**
   * Parse music release
   */
  private parseMusicRelease(name: string, result: ParsedReleaseName): void {
    // Music format: Artist-Album-Year-Group or Artist-Album-Type-Year-Group
    const parts = name.split('-');
    
    if (parts.length >= 3) {
      result.artist = this.cleanTitle(parts[0]);
      result.album = this.cleanTitle(parts[1]);
      result.title = `${result.artist} - ${result.album}`;
      
      // Look for year in remaining parts
      for (let i = 2; i < parts.length; i++) {
        const yearMatch = parts[i].match(PATTERNS.year);
        if (yearMatch) {
          result.year = parseInt(yearMatch[1], 10);
        }
      }
      
      // Last part is usually group
      if (parts.length > 3) {
        result.group = parts[parts.length - 1].trim();
      }
    }

    // Extract bitrate
    const bitrateMatch = name.match(PATTERNS.musicBitrate);
    if (bitrateMatch) {
      result.bitrate = bitrateMatch[1] + 'kbps';
    }

    // Extract format as audio codec
    const formatMatch = name.match(PATTERNS.musicFormat);
    if (formatMatch) {
      result.audioCodec = formatMatch[1].toUpperCase();
    }
  }

  /**
   * Parse quality information
   */
  private parseQuality(name: string, result: ParsedReleaseName): void {
    // Resolution
    const resMatch = name.match(PATTERNS.resolution);
    if (resMatch) {
      result.resolution = resMatch[1].toLowerCase();
    }

    // Source
    const sourceMatch = name.match(PATTERNS.source);
    if (sourceMatch) {
      result.source = this.normalizeSource(sourceMatch[1]);
    }

    // Video codec
    const videoMatch = name.match(PATTERNS.videoCodec);
    if (videoMatch) {
      result.videoCodec = this.normalizeVideoCodec(videoMatch[1]);
    }

    // Audio codec
    const audioMatch = name.match(PATTERNS.audioCodec);
    if (audioMatch) {
      result.audioCodec = this.normalizeAudioCodec(audioMatch[1]);
    }

    // Audio channels
    const channelsMatch = name.match(PATTERNS.audioChannels);
    if (channelsMatch) {
      result.audioChannels = channelsMatch[1];
    }

    // HDR
    const hdrMatch = name.match(PATTERNS.hdr);
    if (hdrMatch) {
      result.hdr = this.normalizeHDR(hdrMatch[1]);
    }

    // 3D
    result.is3d = PATTERNS.is3d.test(name);

    // Container
    const containerMatch = name.match(PATTERNS.container);
    if (containerMatch) {
      result.container = containerMatch[1].toLowerCase();
    }
  }

  /**
   * Parse flags
   */
  private parseFlags(name: string, result: ParsedReleaseName): void {
    result.proper = PATTERNS.proper.test(name);
    result.repack = PATTERNS.repack.test(name);
    result.real = PATTERNS.real.test(name);
    result.internal = PATTERNS.internal.test(name);
    result.dirfix = PATTERNS.dirfix.test(name);
    result.nfofix = PATTERNS.nfofix.test(name);
    result.samplefix = PATTERNS.samplefix.test(name);
    result.prooffix = PATTERNS.prooffix.test(name);

    result.extended = PATTERNS.extended.test(name);
    result.uncut = PATTERNS.uncut.test(name);
    result.unrated = PATTERNS.unrated.test(name);
    result.directors = PATTERNS.directors.test(name);
    result.theatrical = PATTERNS.theatrical.test(name);
    result.remastered = PATTERNS.remastered.test(name);

    const editionMatch = name.match(PATTERNS.edition);
    if (editionMatch) {
      result.edition = editionMatch[1];
    }

    result.dualAudio = PATTERNS.dualAudio.test(name);
    result.multilingual = PATTERNS.multilingual.test(name);
    result.subbed = PATTERNS.subbed.test(name);
    result.dubbed = PATTERNS.dubbed.test(name);
  }

  /**
   * Parse group name
   */
  private parseGroup(name: string, result: ParsedReleaseName): void {
    // Group is typically after the last dash
    const groupMatch = name.match(PATTERNS.group);
    if (groupMatch && !result.group) {
      result.group = groupMatch[1];
    }
  }

  /**
   * Clean title string
   */
  private cleanTitle(title: string): string {
    return title
      .replace(/\./g, ' ')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Normalize source name
   */
  private normalizeSource(source: string): string {
    const normalized = source.toUpperCase();
    const map: Record<string, string> = {
      'BLURAY': 'BluRay',
      'BLU-RAY': 'BluRay',
      'BDRIP': 'BDRip',
      'BRRIP': 'BRRip',
      'WEB-DL': 'WEB-DL',
      'WEBDL': 'WEB-DL',
      'WEBRIP': 'WEBRip',
      'WEB': 'WEB',
      'HDTV': 'HDTV',
      'PDTV': 'PDTV',
      'DVDRIP': 'DVDRip',
      'DVD-R': 'DVD-R',
      'DVDR': 'DVD-R',
    };
    return map[normalized] ?? source;
  }

  /**
   * Normalize video codec
   */
  private normalizeVideoCodec(codec: string): string {
    const upper = codec.toUpperCase().replace(/\./g, '');
    if (upper.includes('264')) return 'H.264';
    if (upper.includes('265') || upper === 'HEVC') return 'H.265';
    if (upper === 'AV1') return 'AV1';
    if (upper === 'VP9') return 'VP9';
    if (upper.includes('XVID')) return 'XviD';
    return codec;
  }

  /**
   * Normalize audio codec
   */
  private normalizeAudioCodec(codec: string): string {
    const upper = codec.toUpperCase().replace(/[\.-]/g, '');
    if (upper === 'AC3') return 'AC3';
    if (upper.includes('EAC3') || upper.includes('EAC')) return 'EAC3';
    if (upper.includes('TRUEHD')) return 'TrueHD';
    if (upper.includes('ATMOS')) return 'Atmos';
    if (upper.includes('DTSHD')) return 'DTS-HD MA';
    if (upper === 'DTS') return 'DTS';
    if (upper === 'AAC') return 'AAC';
    if (upper === 'FLAC') return 'FLAC';
    return codec;
  }

  /**
   * Normalize HDR format
   */
  private normalizeHDR(hdr: string): string {
    const upper = hdr.toUpperCase().replace(/[\.-]/g, '');
    if (upper.includes('HDR10+') || upper === 'HDR10PLUS') return 'HDR10+';
    if (upper === 'HDR10' || upper === 'HDR') return 'HDR10';
    if (upper.includes('DOLBY') || upper === 'DV' || upper.includes('DOVI')) return 'Dolby Vision';
    if (upper === 'HLG') return 'HLG';
    return hdr;
  }

  /**
   * Validate the parsed result
   */
  private validate(result: ParsedReleaseName): void {
    if (!result.title || result.title.length < 1) {
      result.issues.push('Could not extract title');
      result.isValid = false;
    }

    if (result.type === 'tv' && !result.season && !result.daily) {
      result.issues.push('TV release missing season/episode info');
      result.isValid = false;
    }

    if (result.type === 'movie' && !result.year) {
      result.issues.push('Movie release missing year');
      // Not invalid, just a warning
    }

    if (!result.group) {
      result.issues.push('Could not identify release group');
      // Not invalid for all cases
    }

    // Check for suspicious patterns
    if (result.proper && result.repack) {
      result.issues.push('Both PROPER and REPACK flags present');
    }
  }

  /**
   * Generate a clean filename from parsed data
   */
  generateFilename(parsed: ParsedReleaseName, extension: string = 'mkv'): string {
    const parts: string[] = [];

    // Title
    parts.push(parsed.title.replace(/\s+/g, '.'));

    // Year (movie) or Season/Episode (TV)
    if (parsed.type === 'tv') {
      if (parsed.season !== undefined) {
        let ep = `S${parsed.season.toString().padStart(2, '0')}`;
        if (parsed.episode !== undefined) {
          ep += `E${parsed.episode.toString().padStart(2, '0')}`;
          if (parsed.episodeEnd !== undefined) {
            ep += `-E${parsed.episodeEnd.toString().padStart(2, '0')}`;
          }
        }
        parts.push(ep);
      } else if (parsed.daily) {
        parts.push(`${parsed.daily.year}.${parsed.daily.month.toString().padStart(2, '0')}.${parsed.daily.day.toString().padStart(2, '0')}`);
      }
    } else if (parsed.year) {
      parts.push(parsed.year.toString());
    }

    // Quality info
    if (parsed.resolution) parts.push(parsed.resolution);
    if (parsed.source) parts.push(parsed.source);
    if (parsed.videoCodec) parts.push(parsed.videoCodec);
    if (parsed.audioCodec) parts.push(parsed.audioCodec);
    if (parsed.hdr) parts.push(parsed.hdr);

    // Group
    if (parsed.group) {
      const lastPart = parts.pop();
      parts.push(`${lastPart}-${parsed.group}`);
    }

    return `${parts.join('.')}.${extension}`;
  }
}

// Singleton instance
export const sceneNameParser = new SceneNameParser();