/**
 * Packaging Module
 * 
 * Advanced container operations and metadata management.
 */

export {
  MkvMuxer,
  generateSegmentUid,
  type TrackInfo,
  type InputFile,
  type Attachment,
  type MkvMuxerConfig,
  type MuxOptions,
  type SplitOptions,
  type MuxResult,
  type ExtractOptions,
  type ExtractResult,
} from './mkvMuxer.js';

export {
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
} from './subtitleEmbedder.js';

export {
  ChapterManager,
  createChaptersFromTimestamps,
  createChaptersAtIntervals,
  type Chapter,
  type ChapterEdition,
  type ChapterFormat,
  type ChapterManagerConfig,
  type GenerateOptions,
  type ThumbnailOptions,
} from './chapterManager.js';

export {
  TagInjector,
  CONTENT_RATINGS,
  VIDEO_SOURCES,
  type MediaTag,
  type TagTarget,
  type TagSet,
  type TagInjectorConfig,
  type TagResult,
} from './tagInjector.js';
