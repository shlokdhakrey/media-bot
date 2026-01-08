/**
 * Job Routes
 * 
 * CRUD operations for processing jobs.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '@media-bot/core';
import { JobState, JobType, Priority, Prisma } from '@prisma/client';

// Validation schemas
const createJobSchema = z.object({
  type: z.nativeEnum(JobType),
  source: z.string(),
  priority: z.nativeEnum(Priority).default(Priority.NORMAL),
  options: z.record(z.unknown()).optional(),
});

const jobQuerySchema = z.object({
  state: z.nativeEnum(JobState).optional(),
  type: z.nativeEnum(JobType).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  sort: z.enum(['createdAt', 'updatedAt', 'priority']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const jobRoutes: FastifyPluginAsync = async (fastify) => {
  // Require authentication for all job routes
  fastify.addHook('onRequest', fastify.authenticate);

  /**
   * List jobs
   */
  fastify.get('/', {
    schema: {
      description: 'List all jobs with pagination and filtering',
      tags: ['Jobs'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async (request) => {
    const query = jobQuerySchema.parse(request.query);

    const where: { state?: JobState; type?: JobType } = {};
    if (query.state) where.state = query.state;
    if (query.type) where.type = query.type;

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        take: query.limit,
        skip: query.offset,
        orderBy: { [query.sort]: query.order },
        include: {
          user: { select: { id: true, username: true } },
          mediaAssets: { select: { id: true, fileName: true, type: true } },
        },
      }),
      prisma.job.count({ where }),
    ]);

    return {
      jobs,
      pagination: {
        total,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + jobs.length < total,
      },
    };
  });

  /**
   * Get job by ID
   */
  fastify.get<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Get a specific job by ID',
      tags: ['Jobs'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true } },
        mediaAssets: true,
        downloads: true,
        syncDecisions: true,
        processingSteps: true,
        auditLogs: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });

    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    return job;
  });

  /**
   * Create a new job
   */
  fastify.post('/', {
    schema: {
      description: 'Create a new processing job',
      tags: ['Jobs'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async (request, reply) => {
    const input = createJobSchema.parse(request.body);
    const user = request.user as { id: string };

    const job = await prisma.job.create({
      data: {
        type: input.type,
        source: input.source,
        priority: input.priority,
        options: (input.options ?? {}) as Prisma.InputJsonValue,
        state: JobState.PENDING,
        stateHistory: [],
        userId: user.id,
      },
    });

    return reply.status(201).send(job);
  });

  /**
   * Cancel a job
   */
  fastify.post<{ Params: { id: string } }>('/:id/cancel', {
    schema: {
      description: 'Cancel a running or pending job',
      tags: ['Jobs'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const job = await prisma.job.findUnique({ where: { id } });

    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    if (job.state !== JobState.PENDING && job.state !== JobState.DOWNLOADING && job.state !== JobState.PROCESSING) {
      return reply.status(400).send({ error: 'Job cannot be cancelled in current state' });
    }

    const updatedJob = await prisma.job.update({
      where: { id },
      data: { state: JobState.CANCELLED },
    });

    return updatedJob;
  });

  /**
   * Retry a failed job
   */
  fastify.post<{ Params: { id: string } }>('/:id/retry', {
    schema: {
      description: 'Retry a failed job',
      tags: ['Jobs'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const job = await prisma.job.findUnique({ where: { id } });

    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    if (job.state !== JobState.FAILED) {
      return reply.status(400).send({ error: 'Only failed jobs can be retried' });
    }

    const updatedJob = await prisma.job.update({
      where: { id },
      data: {
        state: JobState.PENDING,
        error: null,
        progress: 0,
      },
    });

    return updatedJob;
  });

  /**
   * Get job statistics
   */
  fastify.get('/stats', {
    schema: {
      description: 'Get job statistics',
      tags: ['Jobs'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async () => {
    const stats = await prisma.job.groupBy({
      by: ['state'],
      _count: { id: true },
    });

    const byState = stats.reduce((acc: Record<string, number>, s) => {
      acc[s.state] = s._count.id;
      return acc;
    }, {});

    const typeStats = await prisma.job.groupBy({
      by: ['type'],
      _count: { id: true },
    });

    const byType = typeStats.reduce((acc: Record<string, number>, t) => {
      acc[t.type] = t._count.id;
      return acc;
    }, {});

    return {
      byState,
      byType,
      total: Object.values(byState).reduce((a, b) => a + b, 0),
    };
  });

  /**
   * Delete a job
   */
  fastify.delete<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Delete a job',
      tags: ['Jobs'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const job = await prisma.job.findUnique({ where: { id } });

    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    await prisma.job.delete({ where: { id } });

    return { success: true };
  });
};
