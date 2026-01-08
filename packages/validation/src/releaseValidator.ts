/**
 * Release Validator
 * 
 * Validates releases against scene rules and standards.
 * Checks naming conventions, file structure, and content requirements.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { logger } from '@media-bot/utils';
import { SceneNameParser, ParsedReleaseName, sceneNameParser } from './sceneNameParser.js';
import { NFOParser, NFOParseResult, nfoParser } from './nfoParser.js';

export interface ReleaseFile {
  name: string;
  path: string;
  size: number;
  extension: string;
  type: 'video' | 'audio' | 'nfo' | 'sample' | 'proof' | 'sfv' | 'other';
}

export interface ReleaseStructure {
  path: string;
  name: string;
  
  // Parsed release name
  parsed: ParsedReleaseName;
  
  // NFO info
  nfo?: NFOParseResult;
  nfoPath?: string;
  
  // Files
  files: ReleaseFile[];
  videoFiles: ReleaseFile[];
  audioFiles: ReleaseFile[];
  
  // Structure checks
  hasSample: boolean;
  hasProof: boolean;
  hasSFV: boolean;
  hasNFO: boolean;
  
  // Size info
  totalSize: number;
  videoSize: number;
}

export interface ValidationRule {
  id: string;
  name: string;
  severity: 'error' | 'warning' | 'info';
  check: (release: ReleaseStructure) => RuleResult;
}

export interface RuleResult {
  passed: boolean;
  message?: string;
  details?: string;
}

export interface ReleaseValidationResult {
  // Overall result
  isValid: boolean;
  score: number; // 0-100
  
  // Release info
  release: ReleaseStructure;
  
  // Rule results
  passed: { rule: ValidationRule; result: RuleResult }[];
  failed: { rule: ValidationRule; result: RuleResult }[];
  warnings: { rule: ValidationRule; result: RuleResult }[];
  
  // Summary
  errors: string[];
  warningMessages: string[];
  info: string[];
}

// Video extensions
const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.m4v', '.wmv', '.mov', '.m2ts', '.ts'];
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.aac', '.ogg', '.m4a', '.wav', '.alac'];
const SAMPLE_INDICATORS = ['sample', 'trailer', 'preview'];

export class ReleaseValidator {
  private nameParser: SceneNameParser;
  private nfoParser: NFOParser;
  private rules: ValidationRule[];

  constructor() {
    this.nameParser = sceneNameParser;
    this.nfoParser = nfoParser;
    this.rules = this.createDefaultRules();
  }

  /**
   * Validate a release directory
   */
  async validate(releasePath: string): Promise<ReleaseValidationResult> {
    logger.info({ path: releasePath }, 'Validating release');

    // Analyze structure
    const structure = await this.analyzeStructure(releasePath);

    // Run all rules
    const passed: { rule: ValidationRule; result: RuleResult }[] = [];
    const failed: { rule: ValidationRule; result: RuleResult }[] = [];
    const warnings: { rule: ValidationRule; result: RuleResult }[] = [];

    for (const rule of this.rules) {
      const result = rule.check(structure);

      if (result.passed) {
        passed.push({ rule, result });
      } else if (rule.severity === 'error') {
        failed.push({ rule, result });
      } else {
        warnings.push({ rule, result });
      }
    }

    // Calculate score
    const errorCount = failed.length;
    const warningCount = warnings.length;
    const totalRules = this.rules.filter(r => r.severity === 'error').length;
    const score = Math.max(0, Math.round((1 - errorCount / Math.max(totalRules, 1)) * 100 - warningCount * 2));

    const result: ReleaseValidationResult = {
      isValid: failed.length === 0,
      score,
      release: structure,
      passed,
      failed,
      warnings,
      errors: failed.map(f => f.result.message ?? f.rule.name),
      warningMessages: warnings.map(w => w.result.message ?? w.rule.name),
      info: passed.filter(p => p.result.message).map(p => p.result.message!),
    };

    logger.info({
      path: releasePath,
      isValid: result.isValid,
      score: result.score,
      errors: result.errors.length,
      warnings: result.warningMessages.length,
    }, 'Release validation complete');

    return result;
  }

  /**
   * Analyze release structure
   */
  async analyzeStructure(releasePath: string): Promise<ReleaseStructure> {
    const name = basename(releasePath);
    const parsed = this.nameParser.parse(name);
    const files = await this.scanFiles(releasePath);

    // Categorize files
    const videoFiles = files.filter(f => f.type === 'video');
    const audioFiles = files.filter(f => f.type === 'audio');

    // Find and parse NFO
    const nfoFile = files.find(f => f.type === 'nfo');
    let nfo: NFOParseResult | undefined;
    
    if (nfoFile) {
      nfo = await this.nfoParser.parseFile(nfoFile.path);
    }

    // Calculate sizes
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const videoSize = videoFiles.reduce((sum, f) => sum + f.size, 0);

    return {
      path: releasePath,
      name,
      parsed,
      nfo,
      nfoPath: nfoFile?.path,
      files,
      videoFiles,
      audioFiles,
      hasSample: files.some(f => f.type === 'sample'),
      hasProof: files.some(f => f.type === 'proof'),
      hasSFV: files.some(f => f.type === 'sfv'),
      hasNFO: nfoFile !== undefined,
      totalSize,
      videoSize,
    };
  }

  /**
   * Scan files in release directory
   */
  private async scanFiles(dir: string, depth: number = 0): Promise<ReleaseFile[]> {
    const files: ReleaseFile[] = [];
    const maxDepth = 3;

    if (depth > maxDepth) return files;

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          // Check for special directories
          const lowerName = entry.name.toLowerCase();
          
          if (lowerName === 'sample' || lowerName === 'subs' || lowerName === 'proof') {
            const subFiles = await this.scanFiles(fullPath, depth + 1);
            files.push(...subFiles);
          } else if (!lowerName.startsWith('.')) {
            const subFiles = await this.scanFiles(fullPath, depth + 1);
            files.push(...subFiles);
          }
        } else if (entry.isFile()) {
          const stats = await stat(fullPath);
          const ext = extname(entry.name).toLowerCase();
          
          files.push({
            name: entry.name,
            path: fullPath,
            size: stats.size,
            extension: ext,
            type: this.categorizeFile(entry.name, ext, fullPath),
          });
        }
      }
    } catch (error) {
      logger.warn({ dir, error: (error as Error).message }, 'Failed to scan directory');
    }

    return files;
  }

  /**
   * Categorize file by name and extension
   */
  private categorizeFile(name: string, ext: string, path: string): ReleaseFile['type'] {
    const lowerName = name.toLowerCase();
    const lowerPath = path.toLowerCase();

    // NFO
    if (ext === '.nfo') return 'nfo';

    // SFV
    if (ext === '.sfv') return 'sfv';

    // Sample detection
    if (SAMPLE_INDICATORS.some(s => lowerName.includes(s) || lowerPath.includes(`/${s}/`) || lowerPath.includes(`\\${s}\\`))) {
      return 'sample';
    }

    // Proof
    if (lowerName.includes('proof') || lowerPath.includes('/proof/') || lowerPath.includes('\\proof\\')) {
      return 'proof';
    }

    // Video
    if (VIDEO_EXTENSIONS.includes(ext)) return 'video';

    // Audio
    if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';

    return 'other';
  }

  /**
   * Create default validation rules
   */
  private createDefaultRules(): ValidationRule[] {
    return [
      // Naming rules
      {
        id: 'valid-name',
        name: 'Valid release name',
        severity: 'error',
        check: (rel) => ({
          passed: rel.parsed.isValid,
          message: rel.parsed.isValid ? undefined : 'Invalid release name format',
          details: rel.parsed.issues.join(', '),
        }),
      },
      {
        id: 'has-group',
        name: 'Release group identified',
        severity: 'warning',
        check: (rel) => ({
          passed: !!rel.parsed.group,
          message: rel.parsed.group ? undefined : 'No release group found in name',
        }),
      },
      {
        id: 'has-year',
        name: 'Year present (movies)',
        severity: 'warning',
        check: (rel) => ({
          passed: rel.parsed.type !== 'movie' || !!rel.parsed.year,
          message: rel.parsed.type === 'movie' && !rel.parsed.year 
            ? 'Movie releases should include year' 
            : undefined,
        }),
      },
      {
        id: 'has-season-episode',
        name: 'Season/episode info (TV)',
        severity: 'error',
        check: (rel) => ({
          passed: rel.parsed.type !== 'tv' || !!(rel.parsed.season || rel.parsed.daily),
          message: rel.parsed.type === 'tv' && !rel.parsed.season && !rel.parsed.daily
            ? 'TV releases must have season/episode info'
            : undefined,
        }),
      },

      // File structure rules
      {
        id: 'has-nfo',
        name: 'NFO file present',
        severity: 'error',
        check: (rel) => ({
          passed: rel.hasNFO,
          message: rel.hasNFO ? undefined : 'Missing NFO file',
        }),
      },
      {
        id: 'has-video',
        name: 'Video file present',
        severity: 'error',
        check: (rel) => ({
          passed: rel.videoFiles.length > 0 || rel.parsed.type === 'music',
          message: rel.videoFiles.length === 0 && rel.parsed.type !== 'music'
            ? 'No video files found'
            : undefined,
        }),
      },
      {
        id: 'has-sample',
        name: 'Sample included',
        severity: 'warning',
        check: (rel) => ({
          passed: rel.hasSample || rel.parsed.type === 'music',
          message: !rel.hasSample && rel.parsed.type !== 'music'
            ? 'No sample file included'
            : undefined,
        }),
      },

      // Size rules
      {
        id: 'minimum-size',
        name: 'Minimum file size',
        severity: 'error',
        check: (rel) => {
          const minSize = rel.parsed.type === 'music' ? 1024 * 1024 : 100 * 1024 * 1024; // 1MB music, 100MB video
          return {
            passed: rel.totalSize >= minSize,
            message: rel.totalSize < minSize
              ? `Release too small (${this.formatSize(rel.totalSize)})`
              : undefined,
          };
        },
      },
      {
        id: 'video-size-reasonable',
        name: 'Video size reasonable',
        severity: 'warning',
        check: (rel) => {
          if (rel.videoFiles.length === 0) return { passed: true };
          
          const mainVideo = rel.videoFiles.filter(f => !SAMPLE_INDICATORS.some(s => f.name.toLowerCase().includes(s)))[0];
          if (!mainVideo) return { passed: true };

          // Check if main video is at least 90% of video size
          const ratio = mainVideo.size / rel.videoSize;
          return {
            passed: ratio >= 0.5,
            message: ratio < 0.5
              ? 'Unusual video file size distribution'
              : undefined,
          };
        },
      },

      // NFO content rules
      {
        id: 'nfo-valid',
        name: 'NFO file valid',
        severity: 'warning',
        check: (rel) => ({
          passed: !rel.nfo || rel.nfo.isValid,
          message: rel.nfo && !rel.nfo.isValid
            ? 'NFO file has issues'
            : undefined,
          details: rel.nfo?.issues.join(', '),
        }),
      },
      {
        id: 'nfo-has-imdb',
        name: 'NFO contains IMDB ID',
        severity: 'info',
        check: (rel) => ({
          passed: !!rel.nfo?.imdbId,
          message: !rel.nfo?.imdbId
            ? 'NFO missing IMDB ID'
            : undefined,
        }),
      },

      // Quality rules
      {
        id: 'resolution-present',
        name: 'Resolution specified',
        severity: 'warning',
        check: (rel) => ({
          passed: rel.parsed.type === 'music' || !!rel.parsed.resolution,
          message: rel.parsed.type !== 'music' && !rel.parsed.resolution
            ? 'Resolution not specified in name'
            : undefined,
        }),
      },
      {
        id: 'source-present',
        name: 'Source specified',
        severity: 'warning',
        check: (rel) => ({
          passed: rel.parsed.type === 'music' || !!rel.parsed.source,
          message: rel.parsed.type !== 'music' && !rel.parsed.source
            ? 'Source not specified in name'
            : undefined,
        }),
      },

      // Naming consistency rules
      {
        id: 'no-spaces',
        name: 'No spaces in name',
        severity: 'error',
        check: (rel) => ({
          passed: !rel.name.includes(' '),
          message: rel.name.includes(' ')
            ? 'Release name contains spaces (use dots or underscores)'
            : undefined,
        }),
      },
      {
        id: 'consistent-separators',
        name: 'Consistent separators',
        severity: 'warning',
        check: (rel) => {
          const hasDots = rel.name.includes('.');
          const hasUnderscores = rel.name.includes('_');
          return {
            passed: !(hasDots && hasUnderscores),
            message: hasDots && hasUnderscores
              ? 'Mixed separators (dots and underscores)'
              : undefined,
          };
        },
      },
    ];
  }

  /**
   * Add custom rule
   */
  addRule(rule: ValidationRule): void {
    this.rules.push(rule);
  }

  /**
   * Remove rule by ID
   */
  removeRule(id: string): void {
    this.rules = this.rules.filter(r => r.id !== id);
  }

  /**
   * Get all rules
   */
  getRules(): ValidationRule[] {
    return [...this.rules];
  }

  /**
   * Format bytes to human readable
   */
  private formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unit = 0;
    
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }
    
    return `${size.toFixed(2)} ${units[unit]}`;
  }
}

// Singleton instance
export const releaseValidator = new ReleaseValidator();