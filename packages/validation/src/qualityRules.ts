/**
 * Quality Rules Engine
 * 
 * Validates media files against quality standards.
 * Checks video/audio parameters against configurable rules.
 * 
 * Supports:
 * - Resolution requirements
 * - Bitrate minimums/maximums
 * - Codec requirements
 * - HDR verification
 * - Audio quality checks
 */

import { logger } from '@media-bot/utils';
import type { MediaMetadata, VideoStream, AudioStream } from '@media-bot/media';

export interface QualityRule {
  id: string;
  name: string;
  description: string;
  category: 'video' | 'audio' | 'container' | 'general';
  severity: 'error' | 'warning' | 'info';
  enabled: boolean;
  check: (metadata: MediaMetadata) => QualityCheckResult;
}

export interface QualityCheckResult {
  passed: boolean;
  message?: string;
  actual?: string | number;
  expected?: string | number;
}

export interface QualityProfile {
  name: string;
  description: string;
  rules: QualityRule[];
}

export interface QualityValidationResult {
  // Overall result
  passed: boolean;
  score: number;
  
  // Profile used
  profileName: string;
  
  // Detailed results
  results: {
    rule: QualityRule;
    result: QualityCheckResult;
  }[];
  
  // Summary
  errors: string[];
  warnings: string[];
  info: string[];
  
  // Quick stats
  videoQuality: 'excellent' | 'good' | 'acceptable' | 'poor';
  audioQuality: 'excellent' | 'good' | 'acceptable' | 'poor';
}

// Resolution definitions
const RESOLUTIONS: Record<string, { minWidth: number; minHeight: number }> = {
  '2160p': { minWidth: 3840, minHeight: 2160 },
  '1080p': { minWidth: 1920, minHeight: 1080 },
  '720p': { minWidth: 1280, minHeight: 720 },
  '576p': { minWidth: 720, minHeight: 576 },
  '480p': { minWidth: 720, minHeight: 480 },
};

// Codec quality tiers
const VIDEO_CODEC_TIERS: Record<string, number> = {
  'av1': 5,
  'h265': 4,
  'hevc': 4,
  'h264': 3,
  'avc': 3,
  'vp9': 3,
  'xvid': 1,
  'divx': 1,
};

const AUDIO_CODEC_TIERS: Record<string, number> = {
  'truehd': 5,
  'dts-hd ma': 5,
  'dts-hd': 4,
  'dts': 3,
  'eac3': 3,
  'ac3': 3,
  'aac': 2,
  'mp3': 1,
};

export class QualityRulesEngine {
  private profiles: Map<string, QualityProfile> = new Map();

  constructor() {
    this.initializeDefaultProfiles();
  }

  /**
   * Validate media against a quality profile
   */
  validate(
    metadata: MediaMetadata,
    profileName: string = 'standard'
  ): QualityValidationResult {
    const profile = this.profiles.get(profileName);
    if (!profile) {
      throw new Error(`Quality profile not found: ${profileName}`);
    }

    logger.info({ file: metadata.fileName, profile: profileName }, 'Running quality validation');

    const results: { rule: QualityRule; result: QualityCheckResult }[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    const info: string[] = [];

    let passedCount = 0;
    let totalWeight = 0;

    for (const rule of profile.rules) {
      if (!rule.enabled) continue;

      const result = rule.check(metadata);
      results.push({ rule, result });

      const weight = rule.severity === 'error' ? 3 : rule.severity === 'warning' ? 2 : 1;
      totalWeight += weight;

      if (result.passed) {
        passedCount += weight;
        if (result.message) info.push(result.message);
      } else {
        const msg = result.message ?? rule.name;
        if (rule.severity === 'error') {
          errors.push(msg);
        } else if (rule.severity === 'warning') {
          warnings.push(msg);
        } else {
          info.push(msg);
        }
      }
    }

    // Calculate score
    const score = totalWeight > 0 ? Math.round((passedCount / totalWeight) * 100) : 100;

    // Determine quality ratings
    const videoQuality = this.assessVideoQuality(metadata, results);
    const audioQuality = this.assessAudioQuality(metadata, results);

    return {
      passed: errors.length === 0,
      score,
      profileName,
      results,
      errors,
      warnings,
      info,
      videoQuality,
      audioQuality,
    };
  }

  /**
   * Get available profiles
   */
  getProfiles(): string[] {
    return Array.from(this.profiles.keys());
  }

  /**
   * Get profile by name
   */
  getProfile(name: string): QualityProfile | undefined {
    return this.profiles.get(name);
  }

  /**
   * Add or update a profile
   */
  setProfile(profile: QualityProfile): void {
    this.profiles.set(profile.name, profile);
  }

  /**
   * Create a custom profile
   */
  createProfile(
    name: string,
    description: string,
    ruleIds: string[],
    customizations?: Partial<Record<string, Partial<QualityRule>>>
  ): QualityProfile {
    const baseRules = this.getAllRules();
    const selectedRules = baseRules.filter(r => ruleIds.includes(r.id));

    // Apply customizations
    if (customizations) {
      for (const rule of selectedRules) {
        const custom = customizations[rule.id];
        if (custom) {
          Object.assign(rule, custom);
        }
      }
    }

    const profile: QualityProfile = { name, description, rules: selectedRules };
    this.profiles.set(name, profile);
    return profile;
  }

  /**
   * Get all available rules
   */
  getAllRules(): QualityRule[] {
    return [
      ...this.createVideoRules(),
      ...this.createAudioRules(),
      ...this.createContainerRules(),
      ...this.createGeneralRules(),
    ];
  }

  /**
   * Initialize default quality profiles
   */
  private initializeDefaultProfiles(): void {
    // Standard profile - balanced requirements
    this.profiles.set('standard', {
      name: 'standard',
      description: 'Standard quality requirements for most content',
      rules: this.getAllRules(),
    });

    // Strict profile - high quality requirements
    this.profiles.set('strict', {
      name: 'strict',
      description: 'Strict quality requirements for premium content',
      rules: this.getAllRules().map(r => ({
        ...r,
        severity: r.severity === 'warning' ? 'error' : r.severity,
      })),
    });

    // Lenient profile - minimal requirements
    this.profiles.set('lenient', {
      name: 'lenient',
      description: 'Minimal quality requirements',
      rules: this.getAllRules().map(r => ({
        ...r,
        severity: r.severity === 'error' ? 'warning' : r.severity,
      })),
    });

    // 4K HDR profile
    this.profiles.set('4k-hdr', {
      name: '4k-hdr',
      description: 'Requirements for 4K HDR content',
      rules: this.create4KHDRRules(),
    });

    // Streaming profile
    this.profiles.set('streaming', {
      name: 'streaming',
      description: 'Optimized for streaming platforms',
      rules: this.createStreamingRules(),
    });
  }

  /**
   * Create video quality rules
   */
  private createVideoRules(): QualityRule[] {
    return [
      // Resolution check
      {
        id: 'video-resolution-minimum',
        name: 'Minimum resolution',
        description: 'Video must be at least 720p',
        category: 'video',
        severity: 'warning',
        enabled: true,
        check: (m) => {
          const video = m.videoStreams[0];
          if (!video) return { passed: false, message: 'No video stream found' };
          
          const is720p = video.width >= 1280 && video.height >= 720;
          return {
            passed: is720p,
            message: is720p ? undefined : `Resolution too low: ${video.width}x${video.height}`,
            actual: `${video.width}x${video.height}`,
            expected: '1280x720+',
          };
        },
      },

      // Bitrate check
      {
        id: 'video-bitrate-minimum',
        name: 'Minimum video bitrate',
        description: 'Video bitrate should be adequate for resolution',
        category: 'video',
        severity: 'warning',
        enabled: true,
        check: (m) => {
          const video = m.videoStreams[0];
          if (!video || !video.bitRate) return { passed: true };

          // Expected minimum bitrate per resolution
          const minBitrates: Record<string, number> = {
            '2160p': 15_000_000,
            '1080p': 4_000_000,
            '720p': 2_000_000,
            '480p': 1_000_000,
          };

          const resolution = this.getResolutionLabel(video.width, video.height);
          const minBitrate = minBitrates[resolution] ?? 1_000_000;
          const passed = video.bitRate >= minBitrate;

          return {
            passed,
            message: passed ? undefined : `Video bitrate too low for ${resolution}`,
            actual: Math.round(video.bitRate / 1000) + ' kbps',
            expected: Math.round(minBitrate / 1000) + ' kbps+',
          };
        },
      },

      // Codec check
      {
        id: 'video-codec-modern',
        name: 'Modern video codec',
        description: 'Video should use modern codecs (H.264/H.265/AV1)',
        category: 'video',
        severity: 'warning',
        enabled: true,
        check: (m) => {
          const video = m.videoStreams[0];
          if (!video) return { passed: false, message: 'No video stream' };

          const codec = video.codec.toLowerCase();
          const tier = VIDEO_CODEC_TIERS[codec] ?? 0;
          const passed = tier >= 3;

          return {
            passed,
            message: passed ? undefined : `Outdated video codec: ${video.codec}`,
            actual: video.codec,
            expected: 'H.264, H.265, or AV1',
          };
        },
      },

      // Frame rate check
      {
        id: 'video-framerate-valid',
        name: 'Valid frame rate',
        description: 'Frame rate should be standard (23.976, 24, 25, 29.97, 30, 50, 59.94, 60)',
        category: 'video',
        severity: 'warning',
        enabled: true,
        check: (m) => {
          const video = m.videoStreams[0];
          if (!video) return { passed: false, message: 'No video stream' };

          const standardFps = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
          const isStandard = standardFps.some(f => Math.abs(video.fps - f) < 0.1);

          return {
            passed: isStandard,
            message: isStandard ? undefined : `Non-standard frame rate: ${video.fps.toFixed(3)} fps`,
            actual: video.fps.toFixed(3) + ' fps',
          };
        },
      },

      // HDR metadata check
      {
        id: 'video-hdr-metadata',
        name: 'HDR metadata present',
        description: 'HDR content should have proper metadata',
        category: 'video',
        severity: 'warning',
        enabled: true,
        check: (m) => {
          const video = m.videoStreams[0];
          if (!video || !video.isHDR) return { passed: true };

          const hasMetadata = video.hdrFormat !== undefined;
          return {
            passed: hasMetadata,
            message: hasMetadata ? undefined : 'HDR detected but format not identified',
            actual: video.hdrFormat ?? 'Unknown',
          };
        },
      },

      // Edit list warning
      {
        id: 'video-no-edit-list',
        name: 'No edit list',
        description: 'Edit lists can cause sync issues',
        category: 'video',
        severity: 'info',
        enabled: true,
        check: (m) => {
          const video = m.videoStreams[0];
          if (!video) return { passed: true };

          return {
            passed: !video.hasEditList,
            message: video.hasEditList ? 'Video has edit list - may affect sync' : undefined,
          };
        },
      },
    ];
  }

  /**
   * Create audio quality rules
   */
  private createAudioRules(): QualityRule[] {
    return [
      // Audio stream exists
      {
        id: 'audio-stream-present',
        name: 'Audio stream present',
        description: 'File must have at least one audio stream',
        category: 'audio',
        severity: 'error',
        enabled: true,
        check: (m) => ({
          passed: m.audioStreams.length > 0,
          message: m.audioStreams.length === 0 ? 'No audio stream found' : undefined,
        }),
      },

      // Audio codec check
      {
        id: 'audio-codec-quality',
        name: 'Audio codec quality',
        description: 'Audio should use quality codecs',
        category: 'audio',
        severity: 'warning',
        enabled: true,
        check: (m) => {
          const audio = m.audioStreams[0];
          if (!audio) return { passed: false };

          const codec = audio.codec.toLowerCase();
          const tier = AUDIO_CODEC_TIERS[codec] ?? 1;
          const passed = tier >= 2;

          return {
            passed,
            message: passed ? undefined : `Low quality audio codec: ${audio.codec}`,
            actual: audio.codec,
          };
        },
      },

      // Sample rate check
      {
        id: 'audio-sample-rate',
        name: 'Audio sample rate',
        description: 'Sample rate should be at least 44.1kHz',
        category: 'audio',
        severity: 'warning',
        enabled: true,
        check: (m) => {
          const audio = m.audioStreams[0];
          if (!audio) return { passed: false };

          const passed = audio.sampleRate >= 44100;
          return {
            passed,
            message: passed ? undefined : `Low sample rate: ${audio.sampleRate} Hz`,
            actual: audio.sampleRate + ' Hz',
            expected: '44100+ Hz',
          };
        },
      },

      // Channel configuration
      {
        id: 'audio-channels-valid',
        name: 'Valid channel configuration',
        description: 'Audio should have standard channel layout',
        category: 'audio',
        severity: 'info',
        enabled: true,
        check: (m) => {
          const audio = m.audioStreams[0];
          if (!audio) return { passed: false };

          const validChannels = [1, 2, 6, 8]; // Mono, Stereo, 5.1, 7.1
          const passed = validChannels.includes(audio.channels);

          return {
            passed,
            message: passed ? undefined : `Non-standard channel count: ${audio.channels}`,
            actual: `${audio.channels} channels (${audio.channelLayout})`,
          };
        },
      },

      // Language tag
      {
        id: 'audio-language-tagged',
        name: 'Audio language tagged',
        description: 'Audio streams should have language tags',
        category: 'audio',
        severity: 'info',
        enabled: true,
        check: (m) => {
          const hasLanguage = m.audioStreams.every(a => !!a.language);
          return {
            passed: hasLanguage,
            message: hasLanguage ? undefined : 'Some audio streams missing language tags',
          };
        },
      },

      // Codec delay warning
      {
        id: 'audio-no-delay',
        name: 'No audio delay',
        description: 'Audio should not have significant initial padding',
        category: 'audio',
        severity: 'info',
        enabled: true,
        check: (m) => {
          const audio = m.audioStreams[0];
          if (!audio) return { passed: true };

          const hasDelay = audio.initialPadding && audio.initialPadding > 1024;
          return {
            passed: !hasDelay,
            message: hasDelay ? `Audio has initial padding: ${audio.initialPadding} samples` : undefined,
          };
        },
      },
    ];
  }

  /**
   * Create container rules
   */
  private createContainerRules(): QualityRule[] {
    return [
      {
        id: 'container-modern',
        name: 'Modern container format',
        description: 'Should use MKV or MP4',
        category: 'container',
        severity: 'info',
        enabled: true,
        check: (m) => {
          const modern = ['matroska', 'webm', 'mp4', 'mov'];
          const passed = modern.some(f => m.format.toLowerCase().includes(f));
          return {
            passed,
            message: passed ? undefined : `Legacy container format: ${m.format}`,
            actual: m.format,
          };
        },
      },
    ];
  }

  /**
   * Create general rules
   */
  private createGeneralRules(): QualityRule[] {
    return [
      {
        id: 'duration-valid',
        name: 'Valid duration',
        description: 'File should have reasonable duration',
        category: 'general',
        severity: 'error',
        enabled: true,
        check: (m) => {
          const passed = m.duration > 0 && m.duration < 86400; // Max 24 hours
          return {
            passed,
            message: passed ? undefined : `Invalid duration: ${m.duration}s`,
            actual: m.duration + 's',
          };
        },
      },
      {
        id: 'multiple-video-streams',
        name: 'Single video stream',
        description: 'Should have exactly one video stream',
        category: 'general',
        severity: 'warning',
        enabled: true,
        check: (m) => ({
          passed: m.videoStreams.length === 1,
          message: m.videoStreams.length !== 1 
            ? `Found ${m.videoStreams.length} video streams` 
            : undefined,
        }),
      },
    ];
  }

  /**
   * Create 4K HDR specific rules
   */
  private create4KHDRRules(): QualityRule[] {
    return [
      ...this.getAllRules(),
      {
        id: '4k-resolution-required',
        name: '4K resolution required',
        description: 'Must be at least 3840x2160',
        category: 'video',
        severity: 'error',
        enabled: true,
        check: (m) => {
          const video = m.videoStreams[0];
          if (!video) return { passed: false, message: 'No video stream' };

          const is4k = video.width >= 3840 && video.height >= 2160;
          return {
            passed: is4k,
            message: is4k ? undefined : 'Not 4K resolution',
            actual: `${video.width}x${video.height}`,
          };
        },
      },
      {
        id: 'hdr-required',
        name: 'HDR required',
        description: 'Content must be HDR',
        category: 'video',
        severity: 'error',
        enabled: true,
        check: (m) => {
          const video = m.videoStreams[0];
          if (!video) return { passed: false, message: 'No video stream' };

          return {
            passed: video.isHDR,
            message: video.isHDR ? undefined : 'Content is not HDR',
          };
        },
      },
    ];
  }

  /**
   * Create streaming optimized rules
   */
  private createStreamingRules(): QualityRule[] {
    return [
      ...this.getAllRules().filter(r => r.id !== 'video-bitrate-minimum'),
      {
        id: 'streaming-bitrate-max',
        name: 'Streaming bitrate limit',
        description: 'Bitrate should be reasonable for streaming',
        category: 'video',
        severity: 'warning',
        enabled: true,
        check: (m) => {
          const video = m.videoStreams[0];
          if (!video || !video.bitRate) return { passed: true };

          const maxBitrate = 20_000_000; // 20 Mbps max
          const passed = video.bitRate <= maxBitrate;

          return {
            passed,
            message: passed ? undefined : 'Bitrate too high for streaming',
            actual: Math.round(video.bitRate / 1000) + ' kbps',
            expected: Math.round(maxBitrate / 1000) + ' kbps max',
          };
        },
      },
    ];
  }

  /**
   * Get resolution label from dimensions
   */
  private getResolutionLabel(width: number, height: number): string {
    if (height >= 2160 || width >= 3840) return '2160p';
    if (height >= 1080 || width >= 1920) return '1080p';
    if (height >= 720 || width >= 1280) return '720p';
    if (height >= 576) return '576p';
    return '480p';
  }

  /**
   * Assess overall video quality
   */
  private assessVideoQuality(
    metadata: MediaMetadata,
    results: { rule: QualityRule; result: QualityCheckResult }[]
  ): 'excellent' | 'good' | 'acceptable' | 'poor' {
    const video = metadata.videoStreams[0];
    if (!video) return 'poor';

    const videoResults = results.filter(r => r.rule.category === 'video');
    const failedErrors = videoResults.filter(r => !r.result.passed && r.rule.severity === 'error');
    const failedWarnings = videoResults.filter(r => !r.result.passed && r.rule.severity === 'warning');

    if (failedErrors.length > 0) return 'poor';
    if (failedWarnings.length > 2) return 'acceptable';
    if (failedWarnings.length > 0) return 'good';
    return 'excellent';
  }

  /**
   * Assess overall audio quality
   */
  private assessAudioQuality(
    metadata: MediaMetadata,
    results: { rule: QualityRule; result: QualityCheckResult }[]
  ): 'excellent' | 'good' | 'acceptable' | 'poor' {
    if (metadata.audioStreams.length === 0) return 'poor';

    const audioResults = results.filter(r => r.rule.category === 'audio');
    const failedErrors = audioResults.filter(r => !r.result.passed && r.rule.severity === 'error');
    const failedWarnings = audioResults.filter(r => !r.result.passed && r.rule.severity === 'warning');

    if (failedErrors.length > 0) return 'poor';
    if (failedWarnings.length > 1) return 'acceptable';
    if (failedWarnings.length > 0) return 'good';
    return 'excellent';
  }
}

// Singleton instance
export const qualityRulesEngine = new QualityRulesEngine();