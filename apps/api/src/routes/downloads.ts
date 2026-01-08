/**
 * Downloads Routes
 * 
 * Download management and client status endpoints.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '@media-bot/core';
import { DownloadStatus, LinkType } from '@prisma/client';

const downloadQuerySchema = z.object({
  jobId: z.string().uuid().optional(),
  status: z.nativeEnum(DownloadStatus).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

import { DownloaderType } from '@prisma/client';

const createDownloadSchema = z.object({
  jobId: z.string().uuid(),
  source: z.string().url(),
  linkType: z.nativeEnum(LinkType).optional(),
  downloader: z.nativeEnum(DownloaderType).optional(),
});

export const downloadRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate);

  /**
   * List downloads
   */
  fastify.get('/', {
    schema: {
      description: 'List downloads',
      tags: ['Downloads'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async (request) => {
    const query = downloadQuerySchema.parse(request.query);

    const where: { jobId?: string; status?: DownloadStatus } = {};
    if (query.jobId) where.jobId = query.jobId;
    if (query.status) where.status = query.status;

    const [downloads, total] = await Promise.all([
      prisma.download.findMany({
        where,
        take: query.limit,
        skip: query.offset,
        orderBy: { createdAt: 'desc' },
        include: {
          job: { select: { id: true, type: true, state: true } },
        },
      }),
      prisma.download.count({ where }),
    ]);

    return {
      downloads,
      pagination: {
        total,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + downloads.length < total,
      },
    };
  });

  /**
   * Get download by ID
   */
  fastify.get<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Get download details',
      tags: ['Downloads'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const download = await prisma.download.findUnique({
      where: { id },
      include: { job: true },
    });

    if (!download) {
      return reply.status(404).send({ error: 'Download not found' });
    }

    return download;
  });

  /**
   * Create download
   */
  fastify.post('/', {
    schema: {
      description: 'Create a new download',
      tags: ['Downloads'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async (request, reply) => {
    const input = createDownloadSchema.parse(request.body);

    const download = await prisma.download.create({
      data: {
        jobId: input.jobId,
        source: input.source,
        linkType: input.linkType ?? LinkType.DIRECT,
        downloader: input.downloader ?? DownloaderType.ARIA2,
        status: DownloadStatus.PENDING,
      },
    });

    return reply.status(201).send(download);
  });

  /**
   * Cancel download
   */
  fastify.post<{ Params: { id: string } }>('/:id/cancel', {
    schema: {
      description: 'Cancel a download',
      tags: ['Downloads'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const download = await prisma.download.findUnique({ where: { id } });

    if (!download) {
      return reply.status(404).send({ error: 'Download not found' });
    }

    const updated = await prisma.download.update({
      where: { id },
      data: { status: DownloadStatus.CANCELLED },
    });

    return updated;
  });

  /**
   * Delete download
   */
  fastify.delete<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Delete a download',
      tags: ['Downloads'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const download = await prisma.download.findUnique({ where: { id } });

    if (!download) {
      return reply.status(404).send({ error: 'Download not found' });
    }

    await prisma.download.delete({ where: { id } });

    return { success: true };
  });
};
