/**
 * Encoding Presets
 * 
 * Predefined encoding configurations for various use cases.
 * All presets prioritize quality and compatibility.
 * 
 * REMEMBER: Prefer stream copy when possible!
 */

import type { VideoCodecOptions, AudioCodecOptions } from './commandBuilder.js';

export interface EncodingPreset {
  name: string;
  description: string;
  category: 'archive' | 'streaming' | 'mobile' | 'web' | 'broadcast' | 'custom';
  
  video: VideoCodecOptions;
  audio: AudioCodecOptions;
  
  // Container recommendation
  container: 'mkv' | 'mp4' | 'webm' | 'mov';
  
  // Estimated output size factor (1.0 = same as input)
  sizeFactor?: number;
  
  // Hardware acceleration support
  hwAccelVariants?: {
    nvidia?: VideoCodecOptions;
    intel?: VideoCodecOptions;
    amd?: VideoCodecOptions;
    apple?: VideoCodecOptions;
  };
}

// Quality levels for CRF-based encoding
export const CRF_LEVELS = {
  lossless: { x264: 0, x265: 0, svtav1: 0 },
  nearLossless: { x264: 14, x265: 14, svtav1: 15 },
  highQuality: { x264: 18, x265: 20, svtav1: 25 },
  balanced: { x264: 22, x265: 24, svtav1: 30 },
  efficient: { x264: 26, x265: 28, svtav1: 35 },
  small: { x264: 30, x265: 32, svtav1: 40 },
};

/**
 * Archive presets - Maximum quality, larger files
 */
export const ARCHIVE_PRESETS: Record<string, EncodingPreset> = {
  'archive-x265-10bit': {
    name: 'Archive x265 10-bit',
    description: 'High quality x265 10-bit for archival. Very slow encoding.',
    category: 'archive',
    video: {
      codec: 'libx265',
      preset: 'slow',
      crf: CRF_LEVELS.highQuality.x265,
      pixFmt: 'yuv420p10le',
      extraArgs: ['-x265-params', 'aq-mode=3:rd=4:psy-rd=1.0:psy-rdoq=1.0'],
    },
    audio: {
      codec: 'flac',
    },
    container: 'mkv',
    sizeFactor: 0.5,
  },

  'archive-av1': {
    name: 'Archive AV1',
    description: 'Best compression with AV1. Extremely slow encoding.',
    category: 'archive',
    video: {
      codec: 'libsvtav1',
      preset: '4', // SVT-AV1 preset (0-13, lower = slower/better)
      crf: CRF_LEVELS.highQuality.svtav1,
      pixFmt: 'yuv420p10le',
      extraArgs: ['-svtav1-params', 'tune=0:film-grain=8'],
    },
    audio: {
      codec: 'flac',
    },
    container: 'mkv',
    sizeFactor: 0.35,
  },

  'archive-x264-hi444': {
    name: 'Archive x264 Hi444PP',
    description: 'Maximum compatibility x264 with high quality 4:4:4.',
    category: 'archive',
    video: {
      codec: 'libx264',
      preset: 'slow',
      crf: CRF_LEVELS.nearLossless.x264,
      profile: 'high444',
      pixFmt: 'yuv444p',
      tune: 'film',
    },
    audio: {
      codec: 'flac',
    },
    container: 'mkv',
    sizeFactor: 0.8,
  },
};

/**
 * Streaming presets - Optimized for online delivery
 */
export const STREAMING_PRESETS: Record<string, EncodingPreset> = {
  'stream-4k-hdr': {
    name: '4K HDR Streaming',
    description: 'Premium 4K HDR for high-bandwidth streaming.',
    category: 'streaming',
    video: {
      codec: 'libx265',
      preset: 'medium',
      crf: CRF_LEVELS.balanced.x265,
      pixFmt: 'yuv420p10le',
      colorPrimaries: 'bt2020',
      colorTransfer: 'smpte2084',
      colorSpace: 'bt2020nc',
      extraArgs: ['-x265-params', 'hdr-opt=1:repeat-headers=1'],
    },
    audio: {
      codec: 'eac3',
      bitrate: '640k',
    },
    container: 'mp4',
    sizeFactor: 0.6,
    hwAccelVariants: {
      nvidia: {
        codec: 'hevc_nvenc',
        preset: 'p5', // quality preset
        crf: 23,
        profile: 'main10',
        extraArgs: ['-rc', 'vbr', '-cq', '23'],
      },
    },
  },

  'stream-1080p': {
    name: '1080p Streaming',
    description: 'Standard 1080p for most streaming platforms.',
    category: 'streaming',
    video: {
      codec: 'libx264',
      preset: 'medium',
      crf: CRF_LEVELS.balanced.x264,
      profile: 'high',
      level: '4.1',
      pixFmt: 'yuv420p',
    },
    audio: {
      codec: 'aac',
      bitrate: '192k',
      channels: 2,
    },
    container: 'mp4',
    sizeFactor: 0.4,
    hwAccelVariants: {
      nvidia: {
        codec: 'h264_nvenc',
        preset: 'p5',
        profile: 'high',
        level: '4.1',
        extraArgs: ['-rc', 'vbr', '-cq', '22'],
      },
      intel: {
        codec: 'h264_qsv',
        preset: 'medium',
        profile: 'high',
        extraArgs: ['-global_quality', '22'],
      },
      apple: {
        codec: 'h264_videotoolbox',
        profile: 'high',
        extraArgs: ['-q:v', '60'],
      },
    },
  },

  'stream-720p': {
    name: '720p Streaming',
    description: 'Efficient 720p for bandwidth-limited streaming.',
    category: 'streaming',
    video: {
      codec: 'libx264',
      preset: 'medium',
      crf: CRF_LEVELS.balanced.x264,
      profile: 'main',
      level: '3.1',
      pixFmt: 'yuv420p',
    },
    audio: {
      codec: 'aac',
      bitrate: '128k',
      channels: 2,
    },
    container: 'mp4',
    sizeFactor: 0.25,
  },
};

/**
 * Web presets - Browser compatible
 */
export const WEB_PRESETS: Record<string, EncodingPreset> = {
  'web-h264': {
    name: 'Web H.264',
    description: 'Maximum browser compatibility with H.264.',
    category: 'web',
    video: {
      codec: 'libx264',
      preset: 'medium',
      crf: CRF_LEVELS.balanced.x264,
      profile: 'high',
      level: '4.0',
      pixFmt: 'yuv420p',
    },
    audio: {
      codec: 'aac',
      bitrate: '128k',
      channels: 2,
    },
    container: 'mp4',
    sizeFactor: 0.4,
  },

  'web-vp9': {
    name: 'Web VP9',
    description: 'Modern browsers with VP9 support.',
    category: 'web',
    video: {
      codec: 'libvpx-vp9' as any,
      crf: 31,
      bitrate: '0', // Use CRF
      extraArgs: ['-row-mt', '1', '-tile-columns', '2'],
    },
    audio: {
      codec: 'libopus',
      bitrate: '128k',
    },
    container: 'webm',
    sizeFactor: 0.35,
  },

  'web-av1': {
    name: 'Web AV1',
    description: 'Cutting-edge browsers with AV1 support.',
    category: 'web',
    video: {
      codec: 'libsvtav1',
      preset: '6',
      crf: CRF_LEVELS.balanced.svtav1,
    },
    audio: {
      codec: 'libopus',
      bitrate: '128k',
    },
    container: 'webm',
    sizeFactor: 0.3,
  },
};

/**
 * Mobile presets - Device compatibility
 */
export const MOBILE_PRESETS: Record<string, EncodingPreset> = {
  'mobile-efficient': {
    name: 'Mobile Efficient',
    description: 'Small files for mobile devices.',
    category: 'mobile',
    video: {
      codec: 'libx264',
      preset: 'medium',
      crf: CRF_LEVELS.efficient.x264,
      profile: 'main',
      level: '3.1',
      pixFmt: 'yuv420p',
    },
    audio: {
      codec: 'aac',
      bitrate: '96k',
      channels: 2,
      sampleRate: 44100,
    },
    container: 'mp4',
    sizeFactor: 0.2,
  },

  'mobile-hevc': {
    name: 'Mobile HEVC',
    description: 'HEVC for modern iOS/Android devices.',
    category: 'mobile',
    video: {
      codec: 'libx265',
      preset: 'medium',
      crf: CRF_LEVELS.efficient.x265,
      profile: 'main',
      level: '4.0',
      pixFmt: 'yuv420p',
    },
    audio: {
      codec: 'aac',
      bitrate: '128k',
      channels: 2,
    },
    container: 'mp4',
    sizeFactor: 0.15,
  },
};

/**
 * Broadcast presets - Professional standards
 */
export const BROADCAST_PRESETS: Record<string, EncodingPreset> = {
  'broadcast-prores': {
    name: 'Broadcast ProRes',
    description: 'Apple ProRes for broadcast/editing.',
    category: 'broadcast',
    video: {
      codec: 'prores_ks' as any,
      profile: '3', // ProRes 422 HQ
      pixFmt: 'yuv422p10le',
    },
    audio: {
      codec: 'pcm_s24le',
    },
    container: 'mov',
    sizeFactor: 5.0,
  },

  'broadcast-dnxhd': {
    name: 'Broadcast DNxHD',
    description: 'Avid DNxHD for broadcast/editing.',
    category: 'broadcast',
    video: {
      codec: 'dnxhd' as any,
      bitrate: '185M',
      pixFmt: 'yuv422p10le',
    },
    audio: {
      codec: 'pcm_s24le',
    },
    container: 'mov',
    sizeFactor: 5.0,
  },
};

/**
 * All presets combined
 */
export const ALL_PRESETS: Record<string, EncodingPreset> = {
  ...ARCHIVE_PRESETS,
  ...STREAMING_PRESETS,
  ...WEB_PRESETS,
  ...MOBILE_PRESETS,
  ...BROADCAST_PRESETS,
};

/**
 * Get a preset by name
 */
export function getPreset(name: string): EncodingPreset | undefined {
  return ALL_PRESETS[name];
}

/**
 * Get presets by category
 */
export function getPresetsByCategory(category: EncodingPreset['category']): EncodingPreset[] {
  return Object.values(ALL_PRESETS).filter(p => p.category === category);
}

/**
 * Get hardware-accelerated variant if available
 */
export function getHwAccelPreset(
  preset: EncodingPreset,
  hwType: 'nvidia' | 'intel' | 'amd' | 'apple'
): EncodingPreset | null {
  const hwVariant = preset.hwAccelVariants?.[hwType];
  if (!hwVariant) return null;

  return {
    ...preset,
    name: `${preset.name} (${hwType.toUpperCase()})`,
    video: hwVariant,
  };
}

/**
 * Resolution-based bitrate recommendations (kbps)
 */
export const BITRATE_RECOMMENDATIONS = {
  '2160p': { min: 15000, target: 25000, max: 50000 },
  '1440p': { min: 8000, target: 16000, max: 30000 },
  '1080p': { min: 3000, target: 8000, max: 15000 },
  '720p': { min: 1500, target: 4000, max: 8000 },
  '480p': { min: 500, target: 1500, max: 3000 },
  '360p': { min: 300, target: 800, max: 1500 },
};

/**
 * Calculate recommended bitrate for resolution
 */
export function getRecommendedBitrate(
  width: number,
  height: number,
  quality: 'low' | 'medium' | 'high' = 'medium'
): number {
  let resolution: keyof typeof BITRATE_RECOMMENDATIONS;
  
  if (height >= 2160 || width >= 3840) resolution = '2160p';
  else if (height >= 1440 || width >= 2560) resolution = '1440p';
  else if (height >= 1080 || width >= 1920) resolution = '1080p';
  else if (height >= 720 || width >= 1280) resolution = '720p';
  else if (height >= 480 || width >= 720) resolution = '480p';
  else resolution = '360p';

  const rec = BITRATE_RECOMMENDATIONS[resolution];
  
  switch (quality) {
    case 'low': return rec.min;
    case 'high': return rec.max;
    default: return rec.target;
  }
}

/**
 * Preset builder for custom configurations
 */
export class PresetBuilder {
  private preset: Partial<EncodingPreset> = {
    category: 'custom',
    container: 'mkv',
  };

  setName(name: string, description?: string): this {
    this.preset.name = name;
    if (description) this.preset.description = description;
    return this;
  }

  setCategory(category: EncodingPreset['category']): this {
    this.preset.category = category;
    return this;
  }

  setContainer(container: EncodingPreset['container']): this {
    this.preset.container = container;
    return this;
  }

  setVideoCodec(options: VideoCodecOptions): this {
    this.preset.video = options;
    return this;
  }

  setAudioCodec(options: AudioCodecOptions): this {
    this.preset.audio = options;
    return this;
  }

  useX264(crf: number = 22, preset: string = 'medium'): this {
    return this.setVideoCodec({
      codec: 'libx264',
      preset,
      crf,
      profile: 'high',
      pixFmt: 'yuv420p',
    });
  }

  useX265(crf: number = 24, preset: string = 'medium'): this {
    return this.setVideoCodec({
      codec: 'libx265',
      preset,
      crf,
      pixFmt: 'yuv420p10le',
    });
  }

  useAV1(crf: number = 30, preset: string = '6'): this {
    return this.setVideoCodec({
      codec: 'libsvtav1',
      preset,
      crf,
    });
  }

  useCopy(): this {
    return this.setVideoCodec({ codec: 'copy' }).setAudioCodec({ codec: 'copy' });
  }

  useAAC(bitrate: string = '192k'): this {
    return this.setAudioCodec({
      codec: 'aac',
      bitrate,
    });
  }

  useFLAC(): this {
    return this.setAudioCodec({ codec: 'flac' });
  }

  build(): EncodingPreset {
    if (!this.preset.name) throw new Error('Preset name required');
    if (!this.preset.video) throw new Error('Video codec required');
    if (!this.preset.audio) throw new Error('Audio codec required');

    return this.preset as EncodingPreset;
  }
}

/**
 * Create a custom preset
 */
export function createPreset(): PresetBuilder {
  return new PresetBuilder();
}