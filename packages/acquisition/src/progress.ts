/**
 * Progress Tracker
 * 
 * Tracks download progress via Redis for real-time updates.
 */

import { Redis } from 'ioredis';

export interface ProgressData {
  jobId: string;
  downloader: string;
  progress: number;
  speed: number;
  eta: number;
  status: 'downloading' | 'paused' | 'completed' | 'failed';
  error?: string;
  updatedAt: Date;
}

export class ProgressTracker {
  private redis: Redis;
  private keyPrefix = 'media-bot:progress:';

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  async update(data: ProgressData): Promise<void> {
    const key = `${this.keyPrefix}${data.jobId}`;
    await this.redis.set(
      key,
      JSON.stringify({ ...data, updatedAt: new Date() }),
      'EX',
      3600 // Expire after 1 hour
    );
  }

  async get(jobId: string): Promise<ProgressData | null> {
    const key = `${this.keyPrefix}${jobId}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async delete(jobId: string): Promise<void> {
    const key = `${this.keyPrefix}${jobId}`;
    await this.redis.del(key);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
