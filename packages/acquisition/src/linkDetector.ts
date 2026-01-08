/**
 * Link Detector
 * 
 * Enhanced link detection with metadata extraction.
 * Wraps the basic detection with additional context.
 */

import { LinkType as EnumLinkType } from './detection.js';

export type LinkType = 'magnet' | 'torrent' | 'http' | 'https' | 'ftp' | 'gdrive' | 'nzb' | 'unknown';

export interface DetectedLink {
  url: string;
  type: LinkType;
  metadata: LinkMetadata;
}

export interface LinkMetadata {
  // Magnet link info
  infoHash?: string;
  name?: string;
  trackers?: string[];
  
  // Google Drive info
  fileId?: string;
  folderId?: string;
  
  // HTTP info
  domain?: string;
  path?: string;
  
  // NZB info
  nzbName?: string;
}

export class LinkDetector {
  /**
   * Detect link type and extract metadata
   */
  detect(url: string): DetectedLink | null {
    const trimmed = url.trim();
    
    if (!trimmed) {
      return null;
    }

    // Check magnet
    if (trimmed.toLowerCase().startsWith('magnet:')) {
      return this.parseMagnet(trimmed);
    }

    // Check torrent file
    if (trimmed.toLowerCase().endsWith('.torrent')) {
      return {
        url: trimmed,
        type: 'torrent',
        metadata: {},
      };
    }

    // Check NZB
    if (trimmed.toLowerCase().endsWith('.nzb') || trimmed.toLowerCase().startsWith('nzb://')) {
      return this.parseNzb(trimmed);
    }

    // Check Google Drive
    if (this.isGoogleDrive(trimmed)) {
      return this.parseGoogleDrive(trimmed);
    }

    // Check FTP
    if (trimmed.toLowerCase().startsWith('ftp://')) {
      return this.parseFtp(trimmed);
    }

    // Check HTTPS
    if (trimmed.toLowerCase().startsWith('https://')) {
      return this.parseHttp(trimmed, 'https');
    }

    // Check HTTP
    if (trimmed.toLowerCase().startsWith('http://')) {
      return this.parseHttp(trimmed, 'http');
    }

    return null;
  }

  /**
   * Parse magnet link
   */
  private parseMagnet(url: string): DetectedLink {
    const metadata: LinkMetadata = {};

    // Extract info hash
    const hashMatch = url.match(/btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
    if (hashMatch?.[1]) {
      metadata.infoHash = hashMatch[1].toLowerCase();
    }

    // Extract display name
    const nameMatch = url.match(/dn=([^&]+)/);
    if (nameMatch?.[1]) {
      metadata.name = decodeURIComponent(nameMatch[1]);
    }

    // Extract trackers
    const trackerMatches = url.matchAll(/tr=([^&]+)/g);
    const trackers: string[] = [];
    for (const match of trackerMatches) {
      if (match[1]) {
        trackers.push(decodeURIComponent(match[1]));
      }
    }
    if (trackers.length > 0) {
      metadata.trackers = trackers;
    }

    return {
      url,
      type: 'magnet',
      metadata,
    };
  }

  /**
   * Check if URL is Google Drive
   */
  private isGoogleDrive(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      lower.includes('drive.google.com') ||
      lower.startsWith('gdrive://') ||
      lower.startsWith('gdrive:')
    );
  }

  /**
   * Parse Google Drive link
   */
  private parseGoogleDrive(url: string): DetectedLink {
    const metadata: LinkMetadata = {};

    // File ID patterns
    const patterns = [
      /\/file\/d\/([a-zA-Z0-9_-]+)/,
      /id=([a-zA-Z0-9_-]+)/,
      /\/d\/([a-zA-Z0-9_-]+)/,
      /gdrive:\/\/([a-zA-Z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match?.[1]) {
        metadata.fileId = match[1];
        break;
      }
    }

    // Folder ID pattern
    const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch?.[1]) {
      metadata.folderId = folderMatch[1];
    }

    return {
      url,
      type: 'gdrive',
      metadata,
    };
  }

  /**
   * Parse HTTP/HTTPS link
   */
  private parseHttp(url: string, type: 'http' | 'https'): DetectedLink {
    const metadata: LinkMetadata = {};

    try {
      const parsed = new URL(url);
      metadata.domain = parsed.hostname;
      metadata.path = parsed.pathname;
    } catch {
      // Invalid URL, but still return it
    }

    return {
      url,
      type,
      metadata,
    };
  }

  /**
   * Parse FTP link
   */
  private parseFtp(url: string): DetectedLink {
    const metadata: LinkMetadata = {};

    try {
      const parsed = new URL(url);
      metadata.domain = parsed.hostname;
      metadata.path = parsed.pathname;
    } catch {
      // Invalid URL
    }

    return {
      url,
      type: 'ftp',
      metadata,
    };
  }

  /**
   * Parse NZB link
   */
  private parseNzb(url: string): DetectedLink {
    const metadata: LinkMetadata = {};

    // Extract filename if it's a URL ending in .nzb
    const nameMatch = url.match(/\/([^/]+\.nzb)$/i);
    if (nameMatch?.[1]) {
      metadata.nzbName = decodeURIComponent(nameMatch[1]);
    }

    return {
      url,
      type: 'nzb',
      metadata,
    };
  }

  /**
   * Convert our type to enum type for compatibility
   */
  static toEnumType(type: LinkType): EnumLinkType {
    switch (type) {
      case 'magnet': return EnumLinkType.MAGNET;
      case 'torrent': return EnumLinkType.TORRENT;
      case 'http': return EnumLinkType.HTTP;
      case 'https': return EnumLinkType.HTTPS;
      case 'gdrive': return EnumLinkType.GDRIVE;
      case 'nzb': return EnumLinkType.NZB;
      default: return EnumLinkType.UNKNOWN;
    }
  }
}

// Singleton instance
export const linkDetector = new LinkDetector();