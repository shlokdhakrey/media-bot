/**
 * @media-bot/media
 * 
 * Media analysis layer.
 * 
 * Responsibilities:
 * - Probe files with ffprobe and mediainfo
 * - Extract detailed metadata (FPS, duration, timebase, etc.)
 * - Detect codec delays and edit lists
 * - Analyze bitrate, loudness, and scene changes
 * - Store results as JSON in database
 * 
 * IMPORTANT: Duration differences do NOT imply sync issues!
 * Same FPS does NOT guarantee sync!
 */

// Probing
export { FFProbe, type FFProbeResult } from './probes/ffprobe.js';
export { MediaInfoProbe, type MediaInfoResult } from './probes/mediainfo.js';

// Scene detection
export {
  SceneDetector,
  sceneDetector,
  type SceneChange,
  type SceneDetectionResult,
  type SceneDetectorOptions,
} from './probes/sceneDetector.js';

// Bitrate analysis
export {
  BitrateAnalyzer,
  bitrateAnalyzer,
  type FrameInfo,
  type GOPInfo,
  type BitrateStats,
  type BitrateAnalysisResult,
  type BitrateAnalyzerOptions,
} from './probes/bitrateAnalyzer.js';

// Audio analysis
export {
  AudioAnalyzer,
  audioAnalyzer,
  type LoudnessInfo,
  type DynamicsInfo,
  type SilenceInfo,
  type AudioQualityInfo,
  type AudioAnalysisResult,
  type AudioAnalyzerOptions,
} from './probes/audioAnalyzer.js';

// Combined analyzer
export { MediaAnalyzer, type AnalysisResult } from './analyzer.js';

// Types
export type {
  VideoStream,
  AudioStream,
  SubtitleStream,
  ChapterInfo,
  MediaMetadata,
} from './types.js';
