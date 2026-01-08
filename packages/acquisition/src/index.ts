/**
 * @media-bot/acquisition
 * 
 * Download acquisition layer.
 * 
 * Responsibilities:
 * - Detect link type (magnet, http, gdrive, nzb)
 * - Route to appropriate downloader
 * - Track download progress via Redis
 * - Handle retries and resumption
 * - Save files to storage/incoming/<job_id>/
 */

// Link detection
export { detectLinkType, LinkType, getDownloaderForType } from './detection.js';
export { 
  LinkDetector, 
  linkDetector,
  type LinkType as DetailedLinkType,
  type DetectedLink,
  type LinkMetadata,
} from './linkDetector.js';

// Downloader routing
export { DownloaderRouter } from './router.js';

// Individual downloaders
export { 
  QBittorrentClient, 
  qbittorrentClient,
  type QBittorrentConfig,
  type TorrentInfo,
  type TorrentFile,
  type AddTorrentOptions,
} from './clients/qbittorrent.js';

export { 
  Aria2Client, 
  aria2Client,
  type Aria2Config,
  type Aria2Status,
  type Aria2File,
  type Aria2DownloadOptions,
} from './clients/aria2.js';

export { 
  RcloneClient, 
  rcloneClient,
  type RcloneConfig,
  type RcloneProgress,
  type RcloneTransfer,
  type RcloneFileInfo,
} from './clients/rclone.js';

export { 
  NzbgetClient, 
  nzbgetClient,
  type NzbgetConfig,
  type NzbgetStatus,
  type NzbgetGroup,
  type NzbgetHistory,
  type AddNzbOptions,
} from './clients/nzbget.js';

// Google Drive API Client
export {
  GDriveApiClient,
  createGDriveClient,
  downloadFromGDrive,
  type GDriveConfig,
  type GDriveFileMetadata,
  type GDriveProgress,
  type GDriveDownloadResult,
} from './clients/gdrive.js';

// Download manager (unified interface)
export {
  DownloadManager,
  downloadManager,
  type DownloaderType,
  type DownloadProgress,
  type DownloadResult,
  type DownloadOptions,
  type ActiveDownload,
} from './clients/downloadManager.js';

// Progress tracking
export { ProgressTracker } from './progress.js';
