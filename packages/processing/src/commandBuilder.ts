/**
 * FFmpeg Command Builder
 * 
 * Fluent API for building complex FFmpeg commands.
 * Supports encoding, filtering, muxing, and stream manipulation.
 * 
 * CRITICAL: Prefer stream copy over encoding when possible!
 */

import { logger } from '@media-bot/utils';

export interface InputOptions {
  seekTo?: number;        // -ss before input (fast seek)
  duration?: number;      // -t duration
  format?: string;        // -f format
  hwaccel?: string;       // -hwaccel
  hwaccelDevice?: string; // -hwaccel_device
  extraArgs?: string[];   // Additional input args
}

export interface OutputOptions {
  format?: string;        // -f format
  movflags?: string;      // -movflags for mp4
  extraArgs?: string[];   // Additional output args
}

export interface StreamMapping {
  inputIndex: number;
  streamSpec: string;     // e.g., 'v:0', 'a:1', 's'
  optional?: boolean;     // Add ? for optional
}

export interface VideoCodecOptions {
  codec: 'copy' | 'libx264' | 'libx265' | 'libsvtav1' | 'h264_nvenc' | 'hevc_nvenc' | 'h264_qsv' | 'hevc_qsv' | 'h264_videotoolbox' | 'hevc_videotoolbox';
  preset?: string;
  crf?: number;
  bitrate?: string;
  maxrate?: string;
  bufsize?: string;
  profile?: string;
  level?: string;
  tune?: string;
  pixFmt?: string;
  colorPrimaries?: string;
  colorTransfer?: string;
  colorSpace?: string;
  extraArgs?: string[];
}

export interface AudioCodecOptions {
  codec: 'copy' | 'aac' | 'libfdk_aac' | 'ac3' | 'eac3' | 'libopus' | 'flac' | 'pcm_s16le' | 'pcm_s24le';
  bitrate?: string;
  sampleRate?: number;
  channels?: number;
  channelLayout?: string;
  extraArgs?: string[];
}

export interface SubtitleOptions {
  codec: 'copy' | 'srt' | 'ass' | 'webvtt' | 'mov_text';
  charenc?: string;
}

export interface FilterGraph {
  video?: string[];
  audio?: string[];
  complex?: string;
}

export interface MetadataEntry {
  key: string;
  value: string;
  stream?: string;  // e.g., 's:a:0' for first audio stream
}

export class FFmpegCommandBuilder {
  private inputs: { file: string; options: InputOptions }[] = [];
  private mappings: StreamMapping[] = [];
  private videoCodec: VideoCodecOptions | null = null;
  private audioCodec: AudioCodecOptions | null = null;
  private subtitleCodec: SubtitleOptions | null = null;
  private filters: FilterGraph = {};
  private metadata: MetadataEntry[] = [];
  private outputOpts: OutputOptions = {};
  private outputFile: string = '';
  private globalArgs: string[] = [];
  private mapChapters: number | null = null;
  private mapMetadata: number | null = null;
  private dispositions: { stream: string; disposition: string }[] = [];

  /**
   * Add global arguments (before inputs)
   */
  addGlobalArg(...args: string[]): this {
    this.globalArgs.push(...args);
    return this;
  }

  /**
   * Enable hardware acceleration
   */
  useHardwareAccel(type: 'cuda' | 'qsv' | 'videotoolbox' | 'vaapi', device?: string): this {
    this.globalArgs.push('-hwaccel', type);
    if (device) {
      this.globalArgs.push('-hwaccel_device', device);
    }
    return this;
  }

  /**
   * Add input file
   */
  addInput(file: string, options: InputOptions = {}): this {
    this.inputs.push({ file, options });
    return this;
  }

  /**
   * Add input with seeking
   */
  addInputWithSeek(file: string, seekSeconds: number, duration?: number): this {
    return this.addInput(file, { seekTo: seekSeconds, duration });
  }

  /**
   * Map a stream from an input
   */
  map(inputIndex: number, streamSpec: string, optional: boolean = false): this {
    this.mappings.push({ inputIndex, streamSpec, optional });
    return this;
  }

  /**
   * Map all video streams from input
   */
  mapVideo(inputIndex: number = 0, streamIndex?: number, optional: boolean = true): this {
    const spec = streamIndex !== undefined ? `v:${streamIndex}` : 'v';
    return this.map(inputIndex, spec, optional);
  }

  /**
   * Map all audio streams from input
   */
  mapAudio(inputIndex: number = 0, streamIndex?: number, optional: boolean = true): this {
    const spec = streamIndex !== undefined ? `a:${streamIndex}` : 'a';
    return this.map(inputIndex, spec, optional);
  }

  /**
   * Map all subtitle streams from input
   */
  mapSubtitles(inputIndex: number = 0, streamIndex?: number, optional: boolean = true): this {
    const spec = streamIndex !== undefined ? `s:${streamIndex}` : 's';
    return this.map(inputIndex, spec, optional);
  }

  /**
   * Set video codec (copy = no re-encode)
   */
  setVideoCodec(options: VideoCodecOptions | 'copy'): this {
    this.videoCodec = options === 'copy' ? { codec: 'copy' } : options;
    return this;
  }

  /**
   * Set audio codec (copy = no re-encode)
   */
  setAudioCodec(options: AudioCodecOptions | 'copy'): this {
    this.audioCodec = options === 'copy' ? { codec: 'copy' } : options;
    return this;
  }

  /**
   * Set subtitle codec
   */
  setSubtitleCodec(options: SubtitleOptions | 'copy'): this {
    this.subtitleCodec = options === 'copy' ? { codec: 'copy' } : options;
    return this;
  }

  /**
   * Add video filter
   */
  addVideoFilter(filter: string): this {
    if (!this.filters.video) this.filters.video = [];
    this.filters.video.push(filter);
    return this;
  }

  /**
   * Add audio filter
   */
  addAudioFilter(filter: string): this {
    if (!this.filters.audio) this.filters.audio = [];
    this.filters.audio.push(filter);
    return this;
  }

  /**
   * Set complex filter graph
   */
  setComplexFilter(filterGraph: string): this {
    this.filters.complex = filterGraph;
    return this;
  }

  /**
   * Add adelay filter for audio sync
   */
  addAudioDelay(delayMs: number): this {
    return this.addAudioFilter(`adelay=${delayMs}|${delayMs}`);
  }

  /**
   * Add atempo filter for speed adjustment
   */
  addAudioTempo(factor: number): this {
    // atempo only supports 0.5-2.0, chain for larger adjustments
    const filters: string[] = [];
    let remaining = factor;
    
    while (remaining > 2.0) {
      filters.push('atempo=2.0');
      remaining /= 2.0;
    }
    while (remaining < 0.5) {
      filters.push('atempo=0.5');
      remaining /= 0.5;
    }
    filters.push(`atempo=${remaining.toFixed(6)}`);
    
    return this.addAudioFilter(filters.join(','));
  }

  /**
   * Add loudnorm filter for audio normalization
   */
  addLoudnessNorm(
    integratedLoudness: number = -14,
    truePeak: number = -1,
    loudnessRange: number = 11
  ): this {
    return this.addAudioFilter(
      `loudnorm=I=${integratedLoudness}:TP=${truePeak}:LRA=${loudnessRange}`
    );
  }

  /**
   * Copy chapters from input
   */
  copyChapters(inputIndex: number = 0): this {
    this.mapChapters = inputIndex;
    return this;
  }

  /**
   * Copy metadata from input
   */
  copyMetadata(inputIndex: number = 0): this {
    this.mapMetadata = inputIndex;
    return this;
  }

  /**
   * Add custom metadata
   */
  addMetadata(key: string, value: string, stream?: string): this {
    this.metadata.push({ key, value, stream });
    return this;
  }

  /**
   * Set stream disposition
   */
  setDisposition(stream: string, disposition: string): this {
    this.dispositions.push({ stream, disposition });
    return this;
  }

  /**
   * Set output options
   */
  setOutputOptions(options: OutputOptions): this {
    this.outputOpts = { ...this.outputOpts, ...options };
    return this;
  }

  /**
   * Set output file
   */
  setOutput(file: string): this {
    this.outputFile = file;
    return this;
  }

  /**
   * Build the command arguments array
   */
  build(): string[] {
    const args: string[] = [];

    // Global args
    args.push(...this.globalArgs);

    // Inputs
    for (const input of this.inputs) {
      if (input.options.hwaccel) {
        args.push('-hwaccel', input.options.hwaccel);
        if (input.options.hwaccelDevice) {
          args.push('-hwaccel_device', input.options.hwaccelDevice);
        }
      }
      if (input.options.seekTo !== undefined) {
        args.push('-ss', input.options.seekTo.toString());
      }
      if (input.options.duration !== undefined) {
        args.push('-t', input.options.duration.toString());
      }
      if (input.options.format) {
        args.push('-f', input.options.format);
      }
      if (input.options.extraArgs) {
        args.push(...input.options.extraArgs);
      }
      args.push('-i', input.file);
    }

    // Complex filter (before mappings)
    if (this.filters.complex) {
      args.push('-filter_complex', this.filters.complex);
    }

    // Mappings
    for (const mapping of this.mappings) {
      const opt = mapping.optional ? '?' : '';
      args.push('-map', `${mapping.inputIndex}:${mapping.streamSpec}${opt}`);
    }

    // Video codec
    if (this.videoCodec) {
      args.push('-c:v', this.videoCodec.codec);
      
      if (this.videoCodec.codec !== 'copy') {
        if (this.videoCodec.preset) args.push('-preset', this.videoCodec.preset);
        if (this.videoCodec.crf !== undefined) args.push('-crf', this.videoCodec.crf.toString());
        if (this.videoCodec.bitrate) args.push('-b:v', this.videoCodec.bitrate);
        if (this.videoCodec.maxrate) args.push('-maxrate', this.videoCodec.maxrate);
        if (this.videoCodec.bufsize) args.push('-bufsize', this.videoCodec.bufsize);
        if (this.videoCodec.profile) args.push('-profile:v', this.videoCodec.profile);
        if (this.videoCodec.level) args.push('-level', this.videoCodec.level);
        if (this.videoCodec.tune) args.push('-tune', this.videoCodec.tune);
        if (this.videoCodec.pixFmt) args.push('-pix_fmt', this.videoCodec.pixFmt);
        if (this.videoCodec.colorPrimaries) args.push('-color_primaries', this.videoCodec.colorPrimaries);
        if (this.videoCodec.colorTransfer) args.push('-color_trc', this.videoCodec.colorTransfer);
        if (this.videoCodec.colorSpace) args.push('-colorspace', this.videoCodec.colorSpace);
        if (this.videoCodec.extraArgs) args.push(...this.videoCodec.extraArgs);
      }
    }

    // Video filters (only if not copying)
    if (this.filters.video && this.filters.video.length > 0) {
      if (this.videoCodec?.codec === 'copy') {
        logger.warn('Video filters specified but codec is copy - filters will be ignored');
      } else {
        args.push('-vf', this.filters.video.join(','));
      }
    }

    // Audio codec
    if (this.audioCodec) {
      args.push('-c:a', this.audioCodec.codec);
      
      if (this.audioCodec.codec !== 'copy') {
        if (this.audioCodec.bitrate) args.push('-b:a', this.audioCodec.bitrate);
        if (this.audioCodec.sampleRate) args.push('-ar', this.audioCodec.sampleRate.toString());
        if (this.audioCodec.channels) args.push('-ac', this.audioCodec.channels.toString());
        if (this.audioCodec.channelLayout) args.push('-channel_layout', this.audioCodec.channelLayout);
        if (this.audioCodec.extraArgs) args.push(...this.audioCodec.extraArgs);
      }
    }

    // Audio filters (only if not copying)
    if (this.filters.audio && this.filters.audio.length > 0) {
      if (this.audioCodec?.codec === 'copy') {
        logger.warn('Audio filters specified but codec is copy - filters will be ignored');
      } else {
        args.push('-af', this.filters.audio.join(','));
      }
    }

    // Subtitle codec
    if (this.subtitleCodec) {
      args.push('-c:s', this.subtitleCodec.codec);
      if (this.subtitleCodec.charenc) {
        args.push('-sub_charenc', this.subtitleCodec.charenc);
      }
    }

    // Chapters
    if (this.mapChapters !== null) {
      args.push('-map_chapters', this.mapChapters.toString());
    }

    // Metadata
    if (this.mapMetadata !== null) {
      args.push('-map_metadata', this.mapMetadata.toString());
    }
    for (const meta of this.metadata) {
      if (meta.stream) {
        args.push(`-metadata:${meta.stream}`, `${meta.key}=${meta.value}`);
      } else {
        args.push('-metadata', `${meta.key}=${meta.value}`);
      }
    }

    // Dispositions
    for (const disp of this.dispositions) {
      args.push(`-disposition:${disp.stream}`, disp.disposition);
    }

    // Output options
    if (this.outputOpts.format) {
      args.push('-f', this.outputOpts.format);
    }
    if (this.outputOpts.movflags) {
      args.push('-movflags', this.outputOpts.movflags);
    }
    if (this.outputOpts.extraArgs) {
      args.push(...this.outputOpts.extraArgs);
    }

    // Output file
    if (!this.outputFile) {
      throw new Error('Output file not specified');
    }
    args.push(this.outputFile);

    return args;
  }

  /**
   * Build command as string for logging
   */
  buildString(): string {
    return `ffmpeg ${this.build().map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`;
  }

  /**
   * Reset the builder for reuse
   */
  reset(): this {
    this.inputs = [];
    this.mappings = [];
    this.videoCodec = null;
    this.audioCodec = null;
    this.subtitleCodec = null;
    this.filters = {};
    this.metadata = [];
    this.outputOpts = {};
    this.outputFile = '';
    this.globalArgs = [];
    this.mapChapters = null;
    this.mapMetadata = null;
    this.dispositions = [];
    return this;
  }

  /**
   * Clone the builder
   */
  clone(): FFmpegCommandBuilder {
    const cloned = new FFmpegCommandBuilder();
    cloned.inputs = [...this.inputs];
    cloned.mappings = [...this.mappings];
    cloned.videoCodec = this.videoCodec ? { ...this.videoCodec } : null;
    cloned.audioCodec = this.audioCodec ? { ...this.audioCodec } : null;
    cloned.subtitleCodec = this.subtitleCodec ? { ...this.subtitleCodec } : null;
    cloned.filters = { ...this.filters };
    cloned.metadata = [...this.metadata];
    cloned.outputOpts = { ...this.outputOpts };
    cloned.outputFile = this.outputFile;
    cloned.globalArgs = [...this.globalArgs];
    cloned.mapChapters = this.mapChapters;
    cloned.mapMetadata = this.mapMetadata;
    cloned.dispositions = [...this.dispositions];
    return cloned;
  }
}

/**
 * Create a command for simple stream copy (remux)
 */
export function createRemuxCommand(
  inputFile: string,
  outputFile: string,
  options: {
    videoStream?: number;
    audioStream?: number;
    copyChapters?: boolean;
    copyMetadata?: boolean;
  } = {}
): FFmpegCommandBuilder {
  const builder = new FFmpegCommandBuilder()
    .addInput(inputFile)
    .mapVideo(0, options.videoStream, true)
    .mapAudio(0, options.audioStream, true)
    .mapSubtitles(0, undefined, true)
    .setVideoCodec('copy')
    .setAudioCodec('copy')
    .setSubtitleCodec('copy')
    .setOutput(outputFile);

  if (options.copyChapters !== false) {
    builder.copyChapters(0);
  }
  if (options.copyMetadata !== false) {
    builder.copyMetadata(0);
  }

  return builder;
}

/**
 * Create a command for audio extraction
 */
export function createAudioExtractCommand(
  inputFile: string,
  outputFile: string,
  options: {
    audioStream?: number;
    codec?: 'copy' | 'flac' | 'aac' | 'mp3';
    bitrate?: string;
  } = {}
): FFmpegCommandBuilder {
  const builder = new FFmpegCommandBuilder()
    .addInput(inputFile)
    .mapAudio(0, options.audioStream)
    .addGlobalArg('-vn') // No video
    .setOutput(outputFile);

  if (options.codec === 'copy' || !options.codec) {
    builder.setAudioCodec('copy');
  } else {
    builder.setAudioCodec({
      codec: options.codec === 'mp3' ? 'libmp3lame' as any : options.codec,
      bitrate: options.bitrate,
    });
  }

  return builder;
}

/**
 * Create a command for sample extraction
 */
export function createSampleCommand(
  inputFile: string,
  outputFile: string,
  startTime: number,
  duration: number = 60
): FFmpegCommandBuilder {
  return new FFmpegCommandBuilder()
    .addInputWithSeek(inputFile, startTime, duration)
    .mapVideo(0, 0)
    .mapAudio(0, 0, true)
    .setVideoCodec('copy')
    .setAudioCodec('copy')
    .copyChapters(0)
    .copyMetadata(0)
    .setOutput(outputFile);
}