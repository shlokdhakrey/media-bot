/**
 * @media-bot/processing
 * 
 * Media processing and muxing layer.
 * 
 * CRITICAL RULES:
 * - NEVER re-encode video unless explicitly instructed
 * - Always preserve metadata
 * - Always preserve chapters
 * - Preserve HDR/Dolby Vision when present
 * - Log every FFmpeg command executed
 */

// FFmpeg wrapper
export { FFmpeg, type FFmpegProgress } from './ffmpeg.js';

// Muxer
export { Muxer, type MuxOptions, type MuxResult } from './muxer.js';

// Types
export type { ProcessingJob, ProcessingResult } from './types.js';

// Command Builder
export {
  FFmpegCommandBuilder,
  createRemuxCommand,
  createAudioExtractCommand,
  createSampleCommand,
  type VideoCodecOptions,
  type AudioCodecOptions,
  type InputOptions,
  type OutputOptions,
  type StreamMapping,
  type FilterGraph,
  type MetadataEntry,
  type SubtitleOptions,
} from './commandBuilder.js';

// Encoding Presets
export {
  // Constants
  CRF_LEVELS,
  BITRATE_RECOMMENDATIONS,
  ARCHIVE_PRESETS,
  STREAMING_PRESETS,
  WEB_PRESETS,
  MOBILE_PRESETS,
  BROADCAST_PRESETS,
  ALL_PRESETS,
  
  // Functions
  getPreset,
  getPresetsByCategory,
  getHwAccelPreset,
  getRecommendedBitrate,
  createPreset,
  
  // Builder
  PresetBuilder,
  
  // Types
  type EncodingPreset,
} from './presets.js';

// Job Executor
export {
  JobExecutor,
  jobExecutor,
  type JobProgress,
  type JobConfig,
  type JobResult,
} from './jobExecutor.js';

// Progress Parser
export {
  FFmpegProgressParser,
  parseProgressLine,
  formatProgress,
  formatBytes,
  formatDuration,
  formatFFmpegTime,
  parseFFmpegTime,
  type ProgressStats,
  type ProgressEstimate,
  type ProgressEvent,
} from './progressParser.js';

// Packaging
export {
  // MKV Muxer
  MkvMuxer,
  generateSegmentUid,
  type TrackInfo,
  type InputFile,
  type Attachment,
  type MkvMuxerConfig,
  type MuxOptions as MkvMuxOptions,
  type SplitOptions,
  type MuxResult as MkvMuxResult,
  type ExtractOptions,
  type ExtractResult,
  
  // Subtitle Embedder
  SubtitleEmbedder,
  findSubtitlesForVideo,
  parseSubtitleLanguage,
  type SubtitleTrack,
  type SubtitleFormat,
  type FontInfo,
  type SubtitleEmbedderConfig,
  type EmbedOptions,
  type EmbedResult,
  type SubtitleInfo,
  
  // Chapter Manager
  ChapterManager,
  createChaptersFromTimestamps,
  createChaptersAtIntervals,
  type Chapter,
  type ChapterEdition,
  type ChapterFormat,
  type ChapterManagerConfig,
  type GenerateOptions as ChapterGenerateOptions,
  type ThumbnailOptions,
  
  // Tag Injector
  TagInjector,
  CONTENT_RATINGS,
  VIDEO_SOURCES,
  type MediaTag,
  type TagTarget,
  type TagSet,
  type TagInjectorConfig,
  type TagResult,
} from './packaging/index.js';
