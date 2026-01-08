/**
 * Media Types
 * 
 * Detailed type definitions for media metadata.
 */

export interface VideoStream {
  index: number;
  codec: string;
  codecLongName: string;
  profile?: string;
  level?: number;
  width: number;
  height: number;
  displayAspectRatio: string;
  pixelFormat: string;
  colorSpace?: string;
  colorRange?: string;
  colorPrimaries?: string;
  colorTransfer?: string;
  
  // Frame rate (critical for sync!)
  fps: number;
  avgFrameRate: string;
  rFrameRate: string; // Real frame rate from container
  
  // Timing (critical for sync!)
  timeBase: string;
  startTime: number;
  duration: number;
  durationTs: number;
  
  // Bitrate
  bitRate?: number;
  
  // HDR/DV
  isHDR: boolean;
  isDolbyVision: boolean;
  hdrFormat?: string;
  
  // Edit lists (can cause sync issues!)
  hasEditList: boolean;
  editListDelay?: number;
}

export interface AudioStream {
  index: number;
  codec: string;
  codecLongName: string;
  profile?: string;
  
  // Audio properties
  sampleRate: number;
  channels: number;
  channelLayout: string;
  bitDepth?: number;
  bitRate?: number;
  
  // Timing (critical for sync!)
  timeBase: string;
  startTime: number;
  duration: number;
  durationTs: number;
  
  // Codec delay (critical for sync!)
  codecDelay?: number;
  initialPadding?: number;
  
  // Language
  language?: string;
  title?: string;
  isDefault: boolean;
  isForced: boolean;
}

export interface SubtitleStream {
  index: number;
  codec: string;
  language?: string;
  title?: string;
  isDefault: boolean;
  isForced: boolean;
  isTextBased: boolean;
}

export interface ChapterInfo {
  id: number;
  startTime: number;
  endTime: number;
  title?: string;
}

export interface MediaMetadata {
  // File info
  filePath: string;
  fileName: string;
  fileSize: number;
  
  // Container
  format: string;
  formatLongName: string;
  duration: number;
  bitRate: number;
  
  // Streams
  videoStreams: VideoStream[];
  audioStreams: AudioStream[];
  subtitleStreams: SubtitleStream[];
  
  // Chapters
  chapters: ChapterInfo[];
  
  // Raw data for reference
  rawFFProbe: Record<string, unknown>;
  rawMediaInfo: Record<string, unknown>;
  
  // Analysis timestamp
  analyzedAt: Date;
}
