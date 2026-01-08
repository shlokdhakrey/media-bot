/**
 * Link Type Detection
 * 
 * Automatically detect the type of download link and route to
 * the appropriate downloader.
 */

export enum LinkType {
  MAGNET = 'magnet',
  TORRENT = 'torrent',
  HTTP = 'http',
  HTTPS = 'https',
  GDRIVE = 'gdrive',
  NZB = 'nzb',
  UNKNOWN = 'unknown',
}

/**
 * Detect the type of a download link
 */
export function detectLinkType(link: string): LinkType {
  const trimmed = link.trim().toLowerCase();

  // Magnet links
  if (trimmed.startsWith('magnet:')) {
    return LinkType.MAGNET;
  }

  // Torrent files
  if (trimmed.endsWith('.torrent')) {
    return LinkType.TORRENT;
  }

  // NZB files
  if (trimmed.endsWith('.nzb') || trimmed.startsWith('nzb://')) {
    return LinkType.NZB;
  }

  // Google Drive
  if (
    trimmed.includes('drive.google.com') ||
    trimmed.startsWith('gdrive://') ||
    trimmed.startsWith('gdrive:')
  ) {
    return LinkType.GDRIVE;
  }

  // HTTP/HTTPS
  if (trimmed.startsWith('https://')) {
    return LinkType.HTTPS;
  }
  if (trimmed.startsWith('http://')) {
    return LinkType.HTTP;
  }

  return LinkType.UNKNOWN;
}

/**
 * Get the appropriate downloader name for a link type
 */
export function getDownloaderForType(type: LinkType): string {
  switch (type) {
    case LinkType.MAGNET:
    case LinkType.TORRENT:
      return 'qbittorrent';
    case LinkType.HTTP:
    case LinkType.HTTPS:
      return 'aria2';
    case LinkType.GDRIVE:
      return 'rclone';
    case LinkType.NZB:
      return 'nzbget';
    default:
      throw new Error(`Unsupported link type: ${type}`);
  }
}
