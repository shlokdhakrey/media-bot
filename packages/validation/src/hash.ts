/**
 * Hash Generator
 * 
 * Generates file hashes for integrity verification.
 */

import { calculateFileHash, getFileSizeBytes } from '@media-bot/utils';

export interface HashResult {
  filePath: string;
  fileSize: number;
  md5: string;
  sha1: string;
  sha256: string;
  generatedAt: Date;
}

export class HashGenerator {
  /**
   * Generate all hashes for a file
   */
  async generate(filePath: string): Promise<HashResult> {
    const [fileSize, md5, sha1, sha256] = await Promise.all([
      getFileSizeBytes(filePath),
      calculateFileHash(filePath, 'md5'),
      calculateFileHash(filePath, 'sha1'),
      calculateFileHash(filePath, 'sha256'),
    ]);

    return {
      filePath,
      fileSize,
      md5,
      sha1,
      sha256,
      generatedAt: new Date(),
    };
  }

  /**
   * Verify a file against expected hashes
   */
  async verify(
    filePath: string,
    expected: Partial<Pick<HashResult, 'md5' | 'sha1' | 'sha256'>>
  ): Promise<{ valid: boolean; mismatches: string[] }> {
    const actual = await this.generate(filePath);
    const mismatches: string[] = [];

    if (expected.md5 && actual.md5 !== expected.md5) {
      mismatches.push(`MD5 mismatch: expected ${expected.md5}, got ${actual.md5}`);
    }
    if (expected.sha1 && actual.sha1 !== expected.sha1) {
      mismatches.push(`SHA1 mismatch: expected ${expected.sha1}, got ${actual.sha1}`);
    }
    if (expected.sha256 && actual.sha256 !== expected.sha256) {
      mismatches.push(`SHA256 mismatch: expected ${expected.sha256}, got ${actual.sha256}`);
    }

    return {
      valid: mismatches.length === 0,
      mismatches,
    };
  }
}
