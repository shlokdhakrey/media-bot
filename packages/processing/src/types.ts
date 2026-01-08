/**
 * Processing Types
 */

export interface ProcessingJob {
  id: string;
  inputFiles: {
    video: string;
    audio?: string;
    subtitles?: string[];
  };
  outputFile: string;
  options: {
    preserveVideo: boolean;       // Copy video stream (no re-encode)
    preserveMetadata: boolean;    // Copy metadata
    preserveChapters: boolean;    // Copy chapters
    audioFilters?: string;        // Audio filter chain
    subtitleMode?: 'embed' | 'external' | 'none';
  };
}

export interface ProcessingResult {
  success: boolean;
  outputFile: string;
  duration: number;
  ffmpegCommand: string;
  ffmpegOutput: string;
  error?: string;
}
