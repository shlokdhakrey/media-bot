/**
 * Path Mapper
 * 
 * Maps paths between different systems and environments.
 * Handles path translation for:
 * - Local to remote (Docker volumes, network shares)
 * - Cross-platform (Windows <-> Linux)
 * - Relative path resolution
 * - Virtual path namespaces
 * 
 * Essential for:
 * - Download clients on different machines
 * - Docker-based services
 * - Mixed Windows/Linux environments
 */

import { join, normalize, parse, sep, posix, win32 } from 'node:path';

export interface PathMapping {
  // Unique identifier for this mapping
  id: string;
  
  // Human-readable name
  name: string;
  
  // Source path prefix (what the external system uses)
  source: string;
  
  // Target path prefix (what the local system uses)
  target: string;
  
  // Optional: source is a different platform
  sourcePlatform?: 'windows' | 'posix';
  
  // Optional: only apply to specific services
  services?: string[];
  
  // Whether mapping is bidirectional
  bidirectional?: boolean;
  
  // Priority (higher = checked first)
  priority?: number;
}

export interface PathMapperConfig {
  // Base path for all operations
  basePath: string;
  
  // Platform of the local system
  platform?: 'windows' | 'posix';
  
  // Path mappings
  mappings: PathMapping[];
  
  // Default behavior for unmapped paths
  fallbackBehavior?: 'passthrough' | 'error' | 'relative';
}

export interface MappedPath {
  original: string;
  mapped: string;
  mappingId: string | null;
  normalized: boolean;
}

export class PathMapper {
  private config: Required<PathMapperConfig>;
  private sortedMappings: PathMapping[];

  constructor(config: PathMapperConfig) {
    this.config = {
      basePath: config.basePath,
      platform: config.platform ?? (sep === '\\' ? 'windows' : 'posix'),
      mappings: config.mappings,
      fallbackBehavior: config.fallbackBehavior ?? 'passthrough',
    };

    // Sort mappings by priority (descending) and source length (descending)
    // This ensures more specific mappings are checked first
    this.sortedMappings = [...config.mappings].sort((a, b) => {
      const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return b.source.length - a.source.length;
    });
  }

  /**
   * Map a path from external system to local
   */
  mapToLocal(externalPath: string, service?: string): MappedPath {
    const normalized = this.normalizePath(externalPath);
    
    for (const mapping of this.sortedMappings) {
      // Check service filter
      if (mapping.services && service && !mapping.services.includes(service)) {
        continue;
      }

      // Normalize source for comparison
      const normalizedSource = this.normalizePath(mapping.source, mapping.sourcePlatform);
      
      if (this.pathStartsWith(normalized, normalizedSource)) {
        const relativePart = normalized.slice(normalizedSource.length);
        const mappedPath = this.joinPaths(mapping.target, relativePart);
        
        return {
          original: externalPath,
          mapped: this.toLocalPath(mappedPath),
          mappingId: mapping.id,
          normalized: true,
        };
      }
    }

    // No mapping found
    return this.handleUnmappedPath(externalPath);
  }

  /**
   * Map a path from local to external system
   */
  mapToExternal(localPath: string, mappingId: string): MappedPath {
    const mapping = this.sortedMappings.find(m => m.id === mappingId);
    
    if (!mapping || !mapping.bidirectional) {
      return {
        original: localPath,
        mapped: localPath,
        mappingId: null,
        normalized: false,
      };
    }

    const normalized = this.normalizePath(localPath);
    const normalizedTarget = this.normalizePath(mapping.target);
    
    if (this.pathStartsWith(normalized, normalizedTarget)) {
      const relativePart = normalized.slice(normalizedTarget.length);
      const mappedPath = this.joinPaths(mapping.source, relativePart);
      
      return {
        original: localPath,
        mapped: this.toExternalPath(mappedPath, mapping.sourcePlatform),
        mappingId: mapping.id,
        normalized: true,
      };
    }

    return {
      original: localPath,
      mapped: localPath,
      mappingId: null,
      normalized: false,
    };
  }

  /**
   * Get the relative path from base
   */
  getRelativePath(absolutePath: string): string {
    const normalized = this.normalizePath(absolutePath);
    const normalizedBase = this.normalizePath(this.config.basePath);
    
    if (this.pathStartsWith(normalized, normalizedBase)) {
      return normalized.slice(normalizedBase.length).replace(/^[\\/]/, '');
    }
    
    return absolutePath;
  }

  /**
   * Resolve a relative path to absolute
   */
  resolveRelative(relativePath: string): string {
    return join(this.config.basePath, relativePath);
  }

  /**
   * Add a new path mapping
   */
  addMapping(mapping: PathMapping): void {
    this.config.mappings.push(mapping);
    this.sortedMappings = [...this.config.mappings].sort((a, b) => {
      const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return b.source.length - a.source.length;
    });
  }

  /**
   * Remove a path mapping
   */
  removeMapping(id: string): boolean {
    const index = this.config.mappings.findIndex(m => m.id === id);
    if (index === -1) return false;
    
    this.config.mappings.splice(index, 1);
    this.sortedMappings = this.sortedMappings.filter(m => m.id !== id);
    return true;
  }

  /**
   * Get all mappings
   */
  getMappings(): PathMapping[] {
    return [...this.config.mappings];
  }

  /**
   * Update base path
   */
  setBasePath(basePath: string): void {
    this.config.basePath = basePath;
  }

  /**
   * Check if a path is within the base path
   */
  isWithinBase(path: string): boolean {
    const normalized = this.normalizePath(path);
    const normalizedBase = this.normalizePath(this.config.basePath);
    return this.pathStartsWith(normalized, normalizedBase);
  }

  /**
   * Get common path mappings for Docker
   */
  static createDockerMappings(config: {
    hostPath: string;
    containerPath: string;
    services?: string[];
  }): PathMapping[] {
    return [
      {
        id: 'docker-volume',
        name: 'Docker Volume',
        source: config.containerPath,
        target: config.hostPath,
        sourcePlatform: 'posix',
        services: config.services,
        bidirectional: true,
        priority: 10,
      },
    ];
  }

  /**
   * Create mappings for common download client configurations
   */
  static createDownloadClientMappings(config: {
    qbittorrentPath?: { container: string; host: string };
    aria2Path?: { container: string; host: string };
    nzbgetPath?: { container: string; host: string };
  }): PathMapping[] {
    const mappings: PathMapping[] = [];

    if (config.qbittorrentPath) {
      mappings.push({
        id: 'qbittorrent',
        name: 'qBittorrent Downloads',
        source: config.qbittorrentPath.container,
        target: config.qbittorrentPath.host,
        sourcePlatform: 'posix',
        services: ['qbittorrent'],
        bidirectional: true,
        priority: 10,
      });
    }

    if (config.aria2Path) {
      mappings.push({
        id: 'aria2',
        name: 'aria2 Downloads',
        source: config.aria2Path.container,
        target: config.aria2Path.host,
        sourcePlatform: 'posix',
        services: ['aria2'],
        bidirectional: true,
        priority: 10,
      });
    }

    if (config.nzbgetPath) {
      mappings.push({
        id: 'nzbget',
        name: 'NZBGet Downloads',
        source: config.nzbgetPath.container,
        target: config.nzbgetPath.host,
        sourcePlatform: 'posix',
        services: ['nzbget'],
        bidirectional: true,
        priority: 10,
      });
    }

    return mappings;
  }

  // Private helpers

  private normalizePath(path: string, platform?: 'windows' | 'posix'): string {
    // Convert to forward slashes
    let normalized = path.replace(/\\/g, '/');
    
    // Remove trailing slash
    if (normalized.endsWith('/') && normalized.length > 1) {
      normalized = normalized.slice(0, -1);
    }
    
    // Handle Windows drive letters
    if (platform === 'windows' || (platform === undefined && /^[a-zA-Z]:/.test(normalized))) {
      normalized = normalized.toLowerCase();
    }
    
    return normalized;
  }

  private pathStartsWith(path: string, prefix: string): boolean {
    // Ensure prefix ends without slash for consistent comparison
    const cleanPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    const cleanPath = path.endsWith('/') ? path.slice(0, -1) : path;
    
    return cleanPath.toLowerCase() === cleanPrefix.toLowerCase() ||
           cleanPath.toLowerCase().startsWith(cleanPrefix.toLowerCase() + '/');
  }

  private joinPaths(base: string, relative: string): string {
    // Remove leading slash from relative
    const cleanRelative = relative.replace(/^[\\/]/, '');
    
    if (!cleanRelative) {
      return base;
    }
    
    return `${base}/${cleanRelative}`;
  }

  private toLocalPath(path: string): string {
    if (this.config.platform === 'windows') {
      return path.replace(/\//g, '\\');
    }
    return path;
  }

  private toExternalPath(path: string, platform?: 'windows' | 'posix'): string {
    if (platform === 'windows') {
      return path.replace(/\//g, '\\');
    }
    return path.replace(/\\/g, '/');
  }

  private handleUnmappedPath(path: string): MappedPath {
    switch (this.config.fallbackBehavior) {
      case 'passthrough':
        return {
          original: path,
          mapped: this.toLocalPath(this.normalizePath(path)),
          mappingId: null,
          normalized: true,
        };
        
      case 'relative':
        return {
          original: path,
          mapped: join(this.config.basePath, parse(path).base),
          mappingId: null,
          normalized: true,
        };
        
      case 'error':
        throw new Error(`No mapping found for path: ${path}`);
    }
  }
}

/**
 * Create a path mapper for Docker environments
 */
export function createDockerPathMapper(
  hostBasePath: string,
  containerBasePath: string = '/data'
): PathMapper {
  return new PathMapper({
    basePath: hostBasePath,
    mappings: PathMapper.createDockerMappings({
      hostPath: hostBasePath,
      containerPath: containerBasePath,
    }),
  });
}

/**
 * Create a path mapper with common download client mappings
 */
export function createDownloadPathMapper(
  hostBasePath: string,
  containerDownloadsPath: string = '/downloads'
): PathMapper {
  return new PathMapper({
    basePath: hostBasePath,
    mappings: [
      {
        id: 'downloads',
        name: 'Downloads Directory',
        source: containerDownloadsPath,
        target: hostBasePath,
        sourcePlatform: 'posix',
        bidirectional: true,
        priority: 10,
      },
    ],
  });
}