/**
 * MediaInfo Wrapper
 * 
 * Safe wrapper for mediainfo command execution.
 * Provides additional metadata not available from ffprobe.
 */

import { executeCommand } from '@media-bot/utils';

export interface MediaInfoResult {
  media: {
    '@ref': string;
    track: Array<{
      '@type': 'General' | 'Video' | 'Audio' | 'Text' | 'Menu';
      // General
      Format?: string;
      Format_Profile?: string;
      CodecID?: string;
      FileSize?: string;
      Duration?: string;
      OverallBitRate?: string;
      Encoded_Date?: string;
      Tagged_Date?: string;
      // Video
      Width?: string;
      Height?: string;
      DisplayAspectRatio?: string;
      FrameRate?: string;
      FrameRate_Mode?: string;
      ColorSpace?: string;
      ChromaSubsampling?: string;
      BitDepth?: string;
      HDR_Format?: string;
      // Audio
      Channels?: string;
      ChannelLayout?: string;
      SamplingRate?: string;
      Compression_Mode?: string;
      Delay?: string;
      Delay_Source?: string;
      // Additional
      Language?: string;
      Title?: string;
      Default?: string;
      Forced?: string;
    }>;
  };
}

export class MediaInfoProbe {
  private mediainfoPath: string;

  constructor(mediainfoPath: string = 'mediainfo') {
    this.mediainfoPath = mediainfoPath;
  }

  /**
   * Probe a media file with mediainfo
   */
  async probe(filePath: string): Promise<MediaInfoResult> {
    const args = [
      '--Output=JSON',
      filePath,
    ];

    const result = await executeCommand(this.mediainfoPath, args, {
      timeout: 60000,
    });

    if (result.exitCode !== 0) {
      throw new Error(`mediainfo failed: ${result.stderr}`);
    }

    try {
      return JSON.parse(result.stdout) as MediaInfoResult;
    } catch {
      throw new Error(`Failed to parse mediainfo output: ${result.stdout.substring(0, 200)}`);
    }
  }

  /**
   * Check if mediainfo is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await executeCommand(this.mediainfoPath, ['--version'], {
        timeout: 5000,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }
}
