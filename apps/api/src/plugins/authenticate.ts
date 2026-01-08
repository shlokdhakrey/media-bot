/**
 * Authentication Plugin
 * 
 * JWT and API key authentication decorators.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config/index.js';

export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'user' | 'api';
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
  
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateOptional: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateApiKey: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const authenticatePlugin: FastifyPluginAsync = async (fastify) => {
  // JWT authentication (required)
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    // Dev mode bypass - skip auth in development
    if (config.nodeEnv === 'development') {
      request.authUser = {
        id: 'dev-user',
        username: 'developer',
        role: 'admin',
      };
      return;
    }

    // Check for API key first
    const apiKey = request.headers['x-api-key'] as string;
    if (apiKey === config.apiSecretKey) {
      request.authUser = {
        id: 'api-key',
        username: 'api',
        role: 'api',
      };
      return;
    }

    // Fall back to JWT
    try {
      const payload = await request.jwtVerify() as AuthUser;
      request.authUser = payload;
    } catch (err) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Valid authentication required',
      });
    }
  });

  // JWT authentication (optional - sets user if present)
  fastify.decorate('authenticateOptional', async (request: FastifyRequest, _reply: FastifyReply) => {
    // Check for API key first
    const apiKey = request.headers['x-api-key'] as string;
    if (apiKey === config.apiSecretKey) {
      request.authUser = {
        id: 'api-key',
        username: 'api',
        role: 'api',
      };
      return;
    }

    // Try JWT but don't fail
    try {
      const payload = await request.jwtVerify() as AuthUser;
      request.authUser = payload;
    } catch {
      // No auth, that's fine
    }
  });

  // API key only authentication
  fastify.decorate('authenticateApiKey', async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = request.headers['x-api-key'] as string;
    
    if (!apiKey || apiKey !== config.apiSecretKey) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Valid API key required',
      });
    }

    request.authUser = {
      id: 'api-key',
      username: 'api',
      role: 'api',
    };
  });
};

export const authenticate = fp(authenticatePlugin, {
  name: 'authenticate',
  dependencies: ['@fastify/jwt'],
});
