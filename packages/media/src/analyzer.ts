/**
 * Media Analyzer
 * 
 * Combines ffprobe and mediainfo results into a unified analysis.
 */

import { FFProbe, type FFProbeResult } from './probes/ffprobe.js';
import { MediaInfoProbe, type MediaInfoResult } from './probes/mediainfo.js';
import type { MediaMetadata, VideoStream, AudioStream, SubtitleStream, ChapterInfo } from './types.js';
import { basename } from 'node:path';
import { stat } from 'node:fs/promises';

export interface AnalysisResult {
  metadata: MediaMetadata;
  warnings: string[];
  errors: string[];
}

export class MediaAnalyzer {
  private ffprobe: FFProbe;
  private mediainfo: MediaInfoProbe;

  constructor(
    ffprobePath: string = 'ffprobe',
    mediainfoPath: string = 'mediainfo'
  ) {
    this.ffprobe = new FFProbe(ffprobePath);
    this.mediainfo = new MediaInfoProbe(mediainfoPath);
  }

  /**
   * Perform complete analysis of a media file
   */
  async analyze(filePath: string): Promise<AnalysisResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Get file stats
    const fileStats = await stat(filePath);

    // Run both probes
    const [ffprobeResult, mediainfoResult] = await Promise.all([
      this.ffprobe.probe(filePath),
      this.mediainfo.probe(filePath).catch(err => {
        warnings.push(`MediaInfo failed: ${err.message}`);
        return null;
      }),
    ]);

    // Parse video streams
    const videoStreams = this.parseVideoStreams(ffprobeResult, mediainfoResult, warnings);
    
    // Parse audio streams
    const audioStreams = this.parseAudioStreams(ffprobeResult, mediainfoResult, warnings);
    
    // Parse subtitle streams
    const subtitleStreams = this.parseSubtitleStreams(ffprobeResult);
    
    // Parse chapters
    const chapters = this.parseChapters(ffprobeResult);

    // Build metadata object
    const metadata: MediaMetadata = {
      filePath,
      fileName: basename(filePath),
      fileSize: fileStats.size,
      
      format: ffprobeResult.format.format_name,
      formatLongName: ffprobeResult.format.format_long_name,
      duration: parseFloat(ffprobeResult.format.duration),
      bitRate: parseInt(ffprobeResult.format.bit_rate, 10),
      
      videoStreams,
      audioStreams,
      subtitleStreams,
      chapters,
      
      rawFFProbe: ffprobeResult as unknown as Record<string, unknown>,
      rawMediaInfo: (mediainfoResult ?? {}) as unknown as Record<string, unknown>,
      
      analyzedAt: new Date(),
    };

    // Check for potential issues
    this.checkForIssues(metadata, warnings);

    return { metadata, warnings, errors };
  }

  private parseVideoStreams(
    ffprobe: FFProbeResult,
    _mediainfo: MediaInfoResult | null,
    warnings: string[]
  ): VideoStream[] {
    return ffprobe.streams
      .filter(s => s.codec_type === 'video')
      .map(s => {
        // Check for edit lists
        const hasEditList = s.side_data_list?.some(
          sd => sd['side_data_type'] === 'Edit list'
        ) ?? false;

        if (hasEditList) {
          warnings.push(`Video stream ${s.index} has edit list - may affect sync`);
        }

        // Parse frame rate
        const fps = this.parseFrameRate(s.r_frame_rate ?? '0/1');

        return {
          index: s.index,
          codec: s.codec_name,
          codecLongName: s.codec_long_name,
          profile: s.profile,
          level: s.level,
          width: s.width ?? 0,
          height: s.height ?? 0,
          displayAspectRatio: s.display_aspect_ratio ?? 'N/A',
          pixelFormat: s.pix_fmt ?? 'unknown',
          colorSpace: s.color_space,
          colorRange: s.color_range,
          colorPrimaries: s.color_primaries,
          colorTransfer: s.color_transfer,
          
          fps,
          avgFrameRate: s.avg_frame_rate ?? '0/1',
          rFrameRate: s.r_frame_rate ?? '0/1',
          
          timeBase: s.time_base,
          startTime: parseFloat(s.start_time ?? '0'),
          duration: parseFloat(s.duration ?? '0'),
          durationTs: s.duration_ts ?? 0,
          
          bitRate: s.bit_rate ? parseInt(s.bit_rate, 10) : undefined,
          
          isHDR: this.detectHDR(s),
          isDolbyVision: this.detectDolbyVision(s),
          hdrFormat: this.getHDRFormat(s),
          
          hasEditList,
          editListDelay: undefined, // TODO: Parse from side_data
        };
      });
  }

  private parseAudioStreams(
    ffprobe: FFProbeResult,
    _mediainfo: MediaInfoResult | null,
    warnings: string[]
  ): AudioStream[] {
    return ffprobe.streams
      .filter(s => s.codec_type === 'audio')
      .map(s => {
        // Check for initial padding (codec delay)
        if (s.initial_padding && s.initial_padding > 0) {
          warnings.push(`Audio stream ${s.index} has initial padding of ${s.initial_padding} samples`);
        }

        return {
          index: s.index,
          codec: s.codec_name,
          codecLongName: s.codec_long_name,
          profile: s.profile,
          
          sampleRate: parseInt(s.sample_rate ?? '0', 10),
          channels: s.channels ?? 0,
          channelLayout: s.channel_layout ?? 'unknown',
          bitDepth: s.bits_per_sample,
          bitRate: s.bit_rate ? parseInt(s.bit_rate, 10) : undefined,
          
          timeBase: s.time_base,
          startTime: parseFloat(s.start_time ?? '0'),
          duration: parseFloat(s.duration ?? '0'),
          durationTs: s.duration_ts ?? 0,
          
          codecDelay: undefined, // Calculated from initial_padding and sample_rate
          initialPadding: s.initial_padding,
          
          language: s.tags?.language,
          title: s.tags?.title,
          isDefault: s.disposition?.default === 1,
          isForced: s.disposition?.forced === 1,
        };
      });
  }

  private parseSubtitleStreams(ffprobe: FFProbeResult): SubtitleStream[] {
    return ffprobe.streams
      .filter(s => s.codec_type === 'subtitle')
      .map(s => ({
        index: s.index,
        codec: s.codec_name,
        language: s.tags?.language,
        title: s.tags?.title,
        isDefault: s.disposition?.default === 1,
        isForced: s.disposition?.forced === 1,
        isTextBased: ['srt', 'ass', 'ssa', 'subrip', 'webvtt'].includes(s.codec_name),
      }));
  }

  private parseChapters(ffprobe: FFProbeResult): ChapterInfo[] {
    return (ffprobe.chapters ?? []).map(c => ({
      id: c.id,
      startTime: parseFloat(c.start_time),
      endTime: parseFloat(c.end_time),
      title: c.tags?.title,
    }));
  }

  private parseFrameRate(frameRate: string): number {
    const parts = frameRate.split('/');
    if (parts.length !== 2) return 0;
    const num = parseInt(parts[0] ?? '0', 10);
    const den = parseInt(parts[1] ?? '1', 10);
    return den === 0 ? 0 : num / den;
  }

  private detectHDR(stream: FFProbeResult['streams'][0]): boolean {
    const hdrTransfers = ['smpte2084', 'arib-std-b67'];
    return hdrTransfers.includes(stream.color_transfer ?? '');
  }

  private detectDolbyVision(stream: FFProbeResult['streams'][0]): boolean {
    // Check side data for Dolby Vision configuration
    return stream.side_data_list?.some(
      sd => sd['side_data_type']?.toString().includes('DOVI')
    ) ?? false;
  }

  private getHDRFormat(stream: FFProbeResult['streams'][0]): string | undefined {
    if (this.detectDolbyVision(stream)) return 'Dolby Vision';
    if (stream.color_transfer === 'smpte2084') return 'HDR10';
    if (stream.color_transfer === 'arib-std-b67') return 'HLG';
    return undefined;
  }

  private checkForIssues(metadata: MediaMetadata, warnings: string[]): void {
    // Check for multiple video streams
    if (metadata.videoStreams.length > 1) {
      warnings.push('Multiple video streams detected');
    }

    // Check for variable frame rate indicators
    for (const video of metadata.videoStreams) {
      if (video.avgFrameRate !== video.rFrameRate) {
        warnings.push(`Video stream ${video.index} may have variable frame rate`);
      }
    }

    // Check for start time offsets
    for (const audio of metadata.audioStreams) {
      if (audio.startTime !== 0) {
        warnings.push(`Audio stream ${audio.index} has non-zero start time: ${audio.startTime}s`);
      }
    }
  }
}
