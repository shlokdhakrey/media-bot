/**
 * Media Routes
 * 
 * Media asset management and metadata endpoints.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '@media-bot/core';
import { MediaAnalyzer } from '@media-bot/media';
import { AssetType, AssetStatus } from '@prisma/client';
import { existsSync } from 'node:fs';

const mediaQuerySchema = z.object({
  jobId: z.string().uuid().optional(),
  type: z.nativeEnum(AssetType).optional(),
  status: z.nativeEnum(AssetStatus).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Analyze a media file (PUBLIC - no auth required)
   */
  const analyzeSchema = z.object({
    path: z.string().min(1),
    save: z.boolean().optional().default(false),
  });

  fastify.post('/analyze', {
    schema: {
      description: 'Analyze a media file and return metadata',
      tags: ['Media'],
    },
  }, async (request, reply) => {
    const body = analyzeSchema.parse(request.body);
    const { path } = body;

    // Check if file exists
    if (!existsSync(path)) {
      return reply.status(404).send({ error: 'File not found', path });
    }

    try {
      const analyzer = new MediaAnalyzer();
      const result = await analyzer.analyze(path);

      // Transform to CLI-expected format
      const analysis = {
        format: {
          formatName: result.metadata.format,
          duration: result.metadata.duration,
          bitrate: result.metadata.bitRate,
          size: result.metadata.fileSize,
        },
        video: result.metadata.videoStreams.map(v => ({
          codec: v.codec,
          width: v.width,
          height: v.height,
          frameRate: v.fps,
          bitrate: v.bitRate,
        })),
        audio: result.metadata.audioStreams.map(a => ({
          codec: a.codec,
          channels: a.channels,
          sampleRate: a.sampleRate,
          language: a.language,
        })),
        subtitles: result.metadata.subtitleStreams.map(s => ({
          codec: s.codec,
          language: s.language,
          title: s.title,
        })),
      };

      return { analysis, warnings: result.warnings, errors: result.errors, saved: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed';
      return reply.status(500).send({ error: message });
    }
  });

  // Apply auth hook to remaining routes
  fastify.addHook('onRequest', fastify.authenticate);

  /**
   * List media assets
   */
  fastify.get('/', {
    schema: {
      description: 'List media assets',
      tags: ['Media'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async (request) => {
    const query = mediaQuerySchema.parse(request.query);

    const where: { jobId?: string; type?: AssetType; status?: AssetStatus } = {};
    if (query.jobId) where.jobId = query.jobId;
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;

    const [assets, total] = await Promise.all([
      prisma.mediaAsset.findMany({
        where,
        take: query.limit,
        skip: query.offset,
        orderBy: { createdAt: 'desc' },
        include: {
          job: { select: { id: true, type: true, state: true } },
        },
      }),
      prisma.mediaAsset.count({ where }),
    ]);

    return {
      assets,
      pagination: {
        total,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + assets.length < total,
      },
    };
  });

  /**
   * Get media asset by ID
   */
  fastify.get<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Get media asset details',
      tags: ['Media'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const asset = await prisma.mediaAsset.findUnique({
      where: { id },
      include: {
        job: true,
        parent: true,
        derivedAssets: true,
      },
    });

    if (!asset) {
      return reply.status(404).send({ error: 'Asset not found' });
    }

    return asset;
  });

  /**
   * Delete media asset
   */
  fastify.delete<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Delete a media asset',
      tags: ['Media'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const asset = await prisma.mediaAsset.findUnique({ where: { id } });

    if (!asset) {
      return reply.status(404).send({ error: 'Asset not found' });
    }

    await prisma.mediaAsset.delete({ where: { id } });

    return { success: true };
  });

  /**
   * Get asset statistics
   */
  fastify.get('/stats', {
    schema: {
      description: 'Get media asset statistics',
      tags: ['Media'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async () => {
    const byType = await prisma.mediaAsset.groupBy({
      by: ['type'],
      _count: { id: true },
      _sum: { fileSize: true },
    });

    const byStatus = await prisma.mediaAsset.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    return {
      byType: byType.map(t => ({
        type: t.type,
        count: t._count.id,
        totalSize: t._sum.fileSize ?? 0,
      })),
      byStatus: byStatus.map(s => ({
        status: s.status,
        count: s._count.id,
      })),
    };
  });
};
