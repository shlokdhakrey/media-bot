/**
 * Authentication Routes
 * 
 * Login, logout, token refresh, and user management.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { config } from '../config/index.js';

// Validation schemas
const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  expiresIn: z.string().optional(), // e.g., '30d', '1y', 'never'
});

// In-memory store for refresh tokens (use Redis in production)
const refreshTokens = new Map<string, { userId: string; expiresAt: Date }>();

// In-memory store for API keys (use database in production)
const apiKeys = new Map<string, { name: string; userId: string; createdAt: Date }>();

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Login
   */
  fastify.post('/login', {
    schema: {
      description: 'Authenticate and get JWT token',
      tags: ['Authentication'],
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            expiresIn: { type: 'number' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                username: { type: 'string' },
                role: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const body = loginSchema.parse(request.body);

    // Check against admin credentials (expand to database in production)
    if (body.username !== config.adminUsername) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid username or password',
      });
    }

    // Verify password
    const validPassword = body.password === config.adminPassword ||
      await bcrypt.compare(body.password, config.adminPassword).catch(() => false);

    if (!validPassword) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid username or password',
      });
    }

    // Generate tokens
    const user = {
      id: 'admin-1',
      username: body.username,
      role: 'admin' as const,
    };

    const accessToken = fastify.jwt.sign(user);
    const refreshToken = generateRefreshToken();

    // Store refresh token
    refreshTokens.set(refreshToken, {
      userId: user.id,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: parseExpiry(config.jwtExpiresIn),
      user,
    };
  });

  /**
   * Refresh token
   */
  fastify.post('/refresh', {
    schema: {
      description: 'Refresh access token',
      tags: ['Authentication'],
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const body = refreshSchema.parse(request.body);

    const tokenData = refreshTokens.get(body.refreshToken);
    if (!tokenData || tokenData.expiresAt < new Date()) {
      refreshTokens.delete(body.refreshToken);
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or expired refresh token',
      });
    }

    // Get user (from database in production)
    const user = {
      id: tokenData.userId,
      username: 'admin',
      role: 'admin' as const,
    };

    const accessToken = fastify.jwt.sign(user);

    return {
      accessToken,
      expiresIn: parseExpiry(config.jwtExpiresIn),
    };
  });

  /**
   * Logout
   */
  fastify.post('/logout', {
    onRequest: [fastify.authenticate],
    schema: {
      description: 'Logout and invalidate refresh token',
      tags: ['Authentication'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          refreshToken: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as { refreshToken?: string };
    
    if (body.refreshToken) {
      refreshTokens.delete(body.refreshToken);
    }

    return { message: 'Logged out successfully' };
  });

  /**
   * Get current user
   */
  fastify.get('/me', {
    onRequest: [fastify.authenticate],
    schema: {
      description: 'Get current authenticated user',
      tags: ['Authentication'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            username: { type: 'string' },
            role: { type: 'string' },
          },
        },
      },
    },
  }, async (request) => {
    return request.authUser;
  });

  /**
   * Change password
   */
  fastify.post('/change-password', {
    onRequest: [fastify.authenticate],
    schema: {
      description: 'Change user password',
      tags: ['Authentication'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string' },
          newPassword: { type: 'string', minLength: 8 },
        },
      },
    },
  }, async (request, reply) => {
    const body = changePasswordSchema.parse(request.body);

    // Verify current password
    if (body.currentPassword !== config.adminPassword) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Current password is incorrect',
      });
    }

    // In production, update password in database
    // For now, just return success
    return { message: 'Password changed successfully' };
  });

  /**
   * Create API key
   */
  fastify.post('/api-keys', {
    onRequest: [fastify.authenticate],
    schema: {
      description: 'Create a new API key',
      tags: ['Authentication'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          expiresIn: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const body = createApiKeySchema.parse(request.body);
    const user = request.authUser!;

    const apiKey = generateApiKey();
    
    apiKeys.set(apiKey, {
      name: body.name,
      userId: user.id,
      createdAt: new Date(),
    });

    return {
      apiKey,
      name: body.name,
      message: 'Store this API key securely. It will not be shown again.',
    };
  });

  /**
   * List API keys
   */
  fastify.get('/api-keys', {
    onRequest: [fastify.authenticate],
    schema: {
      description: 'List all API keys for current user',
      tags: ['Authentication'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request) => {
    const user = request.authUser!;
    const keys: Array<{ id: string; name: string; createdAt: string }> = [];

    for (const [key, data] of apiKeys.entries()) {
      if (data.userId === user.id) {
        keys.push({
          id: key.substring(0, 8) + '...',
          name: data.name,
          createdAt: data.createdAt.toISOString(),
        });
      }
    }

    return { keys };
  });

  /**
   * Revoke API key
   */
  fastify.delete('/api-keys/:keyPrefix', {
    onRequest: [fastify.authenticate],
    schema: {
      description: 'Revoke an API key',
      tags: ['Authentication'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          keyPrefix: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { keyPrefix } = request.params as { keyPrefix: string };
    const user = request.authUser!;

    for (const [key, data] of apiKeys.entries()) {
      if (key.startsWith(keyPrefix) && data.userId === user.id) {
        apiKeys.delete(key);
        return { message: 'API key revoked' };
      }
    }

    return reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: 'API key not found',
    });
  });
};

function generateRefreshToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'mb_'; // media-bot prefix
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 3600;

  const value = parseInt(match[1]!, 10);
  const unit = match[2];

  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return 3600;
  }
}
