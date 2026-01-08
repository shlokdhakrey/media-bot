/**
 * Conflict Resolver
 * 
 * Handles file conflicts during sync operations.
 * Supports multiple resolution strategies and custom rules.
 * 
 * Strategies:
 * - skip: Don't copy conflicting files
 * - overwrite: Replace destination with source
 * - rename: Rename source file to avoid conflict
 * - newer: Keep the newer file
 * - larger: Keep the larger file
 * - ask: Emit event and wait for resolution
 * - custom: Apply custom rules
 */

import { EventEmitter } from 'node:events';
import { stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

export type ConflictStrategy = 
  | 'skip' 
  | 'overwrite' 
  | 'rename' 
  | 'newer' 
  | 'larger'
  | 'ask'
  | 'custom';

export type ConflictAction = 'skip' | 'overwrite' | 'rename' | 'merge';

export interface FileConflict {
  sourcePath: string;
  destPath: string;
  sourceSize: number;
  destSize: number;
  sourceModified: Date;
  destModified: Date;
  sourceHash?: string;
  destHash?: string;
}

export interface ConflictResolution {
  action: ConflictAction;
  newPath?: string;  // For rename action
  reason: string;
  strategy: ConflictStrategy;
}

export interface ConflictRule {
  // Rule identifier
  id: string;
  
  // Rule priority (higher = checked first)
  priority: number;
  
  // Match condition
  condition: ConflictCondition;
  
  // Resolution action
  action: ConflictAction;
  
  // Optional rename pattern for rename action
  renamePattern?: string;
}

export interface ConflictCondition {
  // File extension filter
  extensions?: string[];
  
  // Path pattern (glob)
  pathPattern?: string;
  
  // Size comparison
  sizeComparison?: 'source-larger' | 'dest-larger' | 'equal' | 'any';
  
  // Age comparison
  ageComparison?: 'source-newer' | 'dest-newer' | 'equal' | 'any';
  
  // Hash comparison
  hashMatch?: boolean;
  
  // Custom function
  custom?: (conflict: FileConflict) => boolean;
}

export interface ConflictResolverConfig {
  // Default strategy when no rules match
  defaultStrategy: ConflictStrategy;
  
  // Custom rules
  rules?: ConflictRule[];
  
  // Rename pattern for rename strategy
  renamePattern?: string;
  
  // Whether to calculate hashes for comparison
  useHashes?: boolean;
  
  // Timeout for 'ask' strategy (ms)
  askTimeoutMs?: number;
}

export class ConflictResolver extends EventEmitter {
  private config: Required<ConflictResolverConfig>;
  private sortedRules: ConflictRule[];
  private pendingResolutions: Map<string, {
    conflict: FileConflict;
    resolve: (resolution: ConflictResolution) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  constructor(config: ConflictResolverConfig) {
    super();
    
    this.config = {
      defaultStrategy: config.defaultStrategy,
      rules: config.rules ?? [],
      renamePattern: config.renamePattern ?? '{name}_{timestamp}{ext}',
      useHashes: config.useHashes ?? false,
      askTimeoutMs: config.askTimeoutMs ?? 30000,
    };

    // Sort rules by priority (descending)
    this.sortedRules = [...this.config.rules].sort(
      (a, b) => b.priority - a.priority
    );
  }

  /**
   * Resolve a file conflict
   */
  async resolve(conflict: FileConflict): Promise<ConflictResolution> {
    // Check custom rules first
    for (const rule of this.sortedRules) {
      if (this.matchesCondition(conflict, rule.condition)) {
        return this.applyAction(conflict, rule.action, 'custom', rule.renamePattern);
      }
    }

    // Apply default strategy
    return this.applyStrategy(conflict, this.config.defaultStrategy);
  }

  /**
   * Manually resolve a pending conflict
   */
  resolveManual(conflictId: string, action: ConflictAction, newPath?: string): boolean {
    const pending = this.pendingResolutions.get(conflictId);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    this.pendingResolutions.delete(conflictId);

    pending.resolve({
      action,
      newPath,
      reason: 'Manual resolution',
      strategy: 'ask',
    });

    return true;
  }

  /**
   * Get pending conflicts waiting for manual resolution
   */
  getPendingConflicts(): FileConflict[] {
    return Array.from(this.pendingResolutions.values()).map(p => p.conflict);
  }

  /**
   * Add a conflict rule
   */
  addRule(rule: ConflictRule): void {
    this.config.rules.push(rule);
    this.sortedRules = [...this.config.rules].sort(
      (a, b) => b.priority - a.priority
    );
  }

  /**
   * Remove a conflict rule
   */
  removeRule(id: string): boolean {
    const index = this.config.rules.findIndex(r => r.id === id);
    if (index === -1) return false;

    this.config.rules.splice(index, 1);
    this.sortedRules = this.sortedRules.filter(r => r.id !== id);
    return true;
  }

  /**
   * Set default strategy
   */
  setDefaultStrategy(strategy: ConflictStrategy): void {
    this.config.defaultStrategy = strategy;
  }

  // Private methods

  private async applyStrategy(
    conflict: FileConflict,
    strategy: ConflictStrategy
  ): Promise<ConflictResolution> {
    switch (strategy) {
      case 'skip':
        return {
          action: 'skip',
          reason: 'Skip strategy applied',
          strategy,
        };

      case 'overwrite':
        return {
          action: 'overwrite',
          reason: 'Overwrite strategy applied',
          strategy,
        };

      case 'rename':
        return this.applyRename(conflict, strategy);

      case 'newer':
        return this.applyNewer(conflict);

      case 'larger':
        return this.applyLarger(conflict);

      case 'ask':
        return this.applyAsk(conflict);

      case 'custom':
        // Fall through to skip if no rules matched
        return {
          action: 'skip',
          reason: 'No matching custom rules, defaulting to skip',
          strategy,
        };
    }
  }

  private applyAction(
    conflict: FileConflict,
    action: ConflictAction,
    strategy: ConflictStrategy,
    renamePattern?: string
  ): ConflictResolution {
    if (action === 'rename') {
      const newPath = this.generateRenamePath(
        conflict.destPath,
        renamePattern ?? this.config.renamePattern
      );
      return {
        action: 'rename',
        newPath,
        reason: `Custom rule applied: rename to ${newPath}`,
        strategy,
      };
    }

    return {
      action,
      reason: `Custom rule applied: ${action}`,
      strategy,
    };
  }

  private applyRename(
    conflict: FileConflict,
    strategy: ConflictStrategy
  ): ConflictResolution {
    const newPath = this.generateRenamePath(
      conflict.destPath,
      this.config.renamePattern
    );

    return {
      action: 'rename',
      newPath,
      reason: `Renamed to avoid conflict: ${newPath}`,
      strategy,
    };
  }

  private applyNewer(conflict: FileConflict): ConflictResolution {
    if (conflict.sourceModified > conflict.destModified) {
      return {
        action: 'overwrite',
        reason: 'Source file is newer',
        strategy: 'newer',
      };
    }

    return {
      action: 'skip',
      reason: 'Destination file is newer or same age',
      strategy: 'newer',
    };
  }

  private applyLarger(conflict: FileConflict): ConflictResolution {
    if (conflict.sourceSize > conflict.destSize) {
      return {
        action: 'overwrite',
        reason: 'Source file is larger',
        strategy: 'larger',
      };
    }

    return {
      action: 'skip',
      reason: 'Destination file is larger or same size',
      strategy: 'larger',
    };
  }

  private async applyAsk(conflict: FileConflict): Promise<ConflictResolution> {
    const conflictId = `${conflict.sourcePath}:${conflict.destPath}:${Date.now()}`;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingResolutions.delete(conflictId);
        resolve({
          action: 'skip',
          reason: 'Ask timeout expired, defaulting to skip',
          strategy: 'ask',
        });
      }, this.config.askTimeoutMs);

      this.pendingResolutions.set(conflictId, {
        conflict,
        resolve,
        timeout,
      });

      this.emit('conflict', {
        id: conflictId,
        conflict,
      });
    });
  }

  private matchesCondition(
    conflict: FileConflict,
    condition: ConflictCondition
  ): boolean {
    // Check extension
    if (condition.extensions && condition.extensions.length > 0) {
      const ext = extname(conflict.sourcePath).toLowerCase();
      if (!condition.extensions.includes(ext)) {
        return false;
      }
    }

    // Check path pattern
    if (condition.pathPattern) {
      if (!this.matchGlob(conflict.sourcePath, condition.pathPattern)) {
        return false;
      }
    }

    // Check size comparison
    if (condition.sizeComparison) {
      switch (condition.sizeComparison) {
        case 'source-larger':
          if (conflict.sourceSize <= conflict.destSize) return false;
          break;
        case 'dest-larger':
          if (conflict.destSize <= conflict.sourceSize) return false;
          break;
        case 'equal':
          if (conflict.sourceSize !== conflict.destSize) return false;
          break;
      }
    }

    // Check age comparison
    if (condition.ageComparison) {
      const sourceMtime = conflict.sourceModified.getTime();
      const destMtime = conflict.destModified.getTime();

      switch (condition.ageComparison) {
        case 'source-newer':
          if (sourceMtime <= destMtime) return false;
          break;
        case 'dest-newer':
          if (destMtime <= sourceMtime) return false;
          break;
        case 'equal':
          // Allow 1 second tolerance
          if (Math.abs(sourceMtime - destMtime) > 1000) return false;
          break;
      }
    }

    // Check hash match
    if (condition.hashMatch !== undefined) {
      if (conflict.sourceHash && conflict.destHash) {
        const hashesMatch = conflict.sourceHash === conflict.destHash;
        if (hashesMatch !== condition.hashMatch) return false;
      }
    }

    // Check custom condition
    if (condition.custom) {
      if (!condition.custom(conflict)) return false;
    }

    return true;
  }

  private generateRenamePath(originalPath: string, pattern: string): string {
    const dir = dirname(originalPath);
    const ext = extname(originalPath);
    const name = basename(originalPath, ext);
    const timestamp = Date.now().toString(36);
    const counter = Math.floor(Math.random() * 1000).toString().padStart(3, '0');

    const newName = pattern
      .replace('{name}', name)
      .replace('{ext}', ext)
      .replace('{timestamp}', timestamp)
      .replace('{counter}', counter)
      .replace('{date}', new Date().toISOString().split('T')[0] ?? '');

    return join(dir, newName);
  }

  private matchGlob(path: string, pattern: string): boolean {
    const regex = new RegExp(
      '^' + pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/\\\\]*')
        .replace(/\?/g, '.') + '$',
      'i'
    );
    return regex.test(path);
  }
}

/**
 * Create a media-focused conflict resolver
 */
export function createMediaConflictResolver(): ConflictResolver {
  return new ConflictResolver({
    defaultStrategy: 'newer',
    rules: [
      {
        id: 'same-hash-skip',
        priority: 100,
        condition: { hashMatch: true },
        action: 'skip',
      },
      {
        id: 'larger-video-overwrite',
        priority: 50,
        condition: {
          extensions: ['.mkv', '.mp4', '.avi'],
          sizeComparison: 'source-larger',
        },
        action: 'overwrite',
      },
      {
        id: 'subtitle-overwrite',
        priority: 30,
        condition: {
          extensions: ['.srt', '.ass', '.ssa', '.sub'],
        },
        action: 'overwrite',
      },
    ],
    useHashes: true,
  });
}

/**
 * Create a safe conflict resolver (never overwrites)
 */
export function createSafeConflictResolver(): ConflictResolver {
  return new ConflictResolver({
    defaultStrategy: 'rename',
    renamePattern: '{name}_{timestamp}{ext}',
  });
}