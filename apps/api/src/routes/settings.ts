/**
 * Settings Routes
 * 
 * Application settings and configuration endpoints.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

// In-memory settings store (in production, use database or config service)
const settings: Record<string, Record<string, unknown>> = {
  general: {
    appName: 'Media Bot',
    timezone: 'UTC',
    logLevel: 'info',
  },
  downloads: {
    maxConcurrent: 3,
    defaultDownloader: 'aria2',
    tempDir: '/tmp/downloads',
  },
  processing: {
    maxConcurrent: 2,
    defaultPreset: 'balanced',
    gpuAcceleration: true,
  },
  upload: {
    defaultTarget: 'minio',
    autoUpload: true,
  },
};

const updateSettingsSchema = z.record(z.unknown());

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.authenticate);

  /**
   * List all settings categories
   */
  fastify.get('/', {
    schema: {
      description: 'List all settings categories',
      tags: ['Settings'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async () => {
    return {
      categories: Object.keys(settings),
    };
  });

  /**
   * Get settings by category
   */
  fastify.get<{ Params: { category: string } }>('/:category', {
    schema: {
      description: 'Get settings for a category',
      tags: ['Settings'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async (request, reply) => {
    const { category } = request.params;

    if (!(category in settings)) {
      return reply.status(404).send({ error: 'Category not found' });
    }

    return settings[category];
  });

  /**
   * Update settings
   */
  fastify.put<{ Params: { category: string } }>('/:category', {
    schema: {
      description: 'Update settings for a category',
      tags: ['Settings'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async (request, reply) => {
    const { category } = request.params;
    const updates = updateSettingsSchema.parse(request.body);

    if (!(category in settings)) {
      return reply.status(404).send({ error: 'Category not found' });
    }

    settings[category] = { ...settings[category], ...updates };

    return settings[category];
  });

  /**
   * Get all settings
   */
  fastify.get('/all', {
    schema: {
      description: 'Get all settings',
      tags: ['Settings'],
      security: [{ bearerAuth: [] }, { apiKey: [] }],
    },
  }, async () => {
    return settings;
  });
};
