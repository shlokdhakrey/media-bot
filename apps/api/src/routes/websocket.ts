/**
 * WebSocket Routes
 * 
 * Real-time communication for job updates and system events.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { SocketStream } from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';

// Global event bus for broadcasting events
const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

// Connected clients registry
const clients = new Map<string, {
  socket: WebSocket;
  userId?: string;
  subscriptions: Set<string>;
  lastPing: number;
}>();

// Message types
interface WsMessage {
  type: string;
  payload?: unknown;
  id?: string;
}

interface JobUpdateEvent {
  jobId: string;
  status: string;
  progress?: number;
  message?: string;
  error?: string;
}

interface SystemEvent {
  type: 'info' | 'warning' | 'error';
  message: string;
  timestamp: string;
}

export const websocketRoutes: FastifyPluginAsync = async (fastify) => {
  // WebSocket connection handler
  fastify.get('/', { websocket: true }, (connection: SocketStream, request) => {
    const socket = connection.socket;
    const clientId = generateClientId();
    const clientIp = request.ip;

    request.log.info({ clientId, ip: clientIp }, 'WebSocket client connected');

    // Register client
    clients.set(clientId, {
      socket,
      subscriptions: new Set(['system']), // Default subscription
      lastPing: Date.now(),
    });

    // Send welcome message
    sendMessage(socket, {
      type: 'connected',
      payload: {
        clientId,
        message: 'Connected to Media Bot WebSocket',
        timestamp: new Date().toISOString(),
      },
    });

    // Handle incoming messages
    socket.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString()) as WsMessage;
        await handleMessage(clientId, message, request);
      } catch (error) {
        request.log.error({ err: error, clientId }, 'Failed to parse WebSocket message');
        sendMessage(socket, {
          type: 'error',
          payload: { message: 'Invalid message format' },
        });
      }
    });

    // Handle pong responses
    socket.on('pong', () => {
      const client = clients.get(clientId);
      if (client) {
        client.lastPing = Date.now();
      }
    });

    // Handle client disconnect
    socket.on('close', () => {
      request.log.info({ clientId }, 'WebSocket client disconnected');
      clients.delete(clientId);
    });

    // Handle errors
    socket.on('error', (error) => {
      request.log.error({ err: error, clientId }, 'WebSocket error');
      clients.delete(clientId);
    });
  });

  // Event listeners for broadcasting
  eventBus.on('job:update', (event: JobUpdateEvent) => {
    broadcast('jobs', {
      type: 'job:update',
      payload: event,
    });
  });

  eventBus.on('job:created', (event: { jobId: string; type: string }) => {
    broadcast('jobs', {
      type: 'job:created',
      payload: event,
    });
  });

  eventBus.on('job:completed', (event: { jobId: string; result?: unknown }) => {
    broadcast('jobs', {
      type: 'job:completed',
      payload: event,
    });
  });

  eventBus.on('job:failed', (event: { jobId: string; error: string }) => {
    broadcast('jobs', {
      type: 'job:failed',
      payload: event,
    });
  });

  eventBus.on('system', (event: SystemEvent) => {
    broadcast('system', {
      type: 'system',
      payload: event,
    });
  });

  eventBus.on('download:progress', (event: {
    client: string;
    id: string;
    progress: number;
    speed: number;
  }) => {
    broadcast('downloads', {
      type: 'download:progress',
      payload: event,
    });
  });

  // Ping interval to keep connections alive
  const pingInterval = setInterval(() => {
    const now = Date.now();
    const timeout = 30000; // 30 seconds

    for (const [clientId, client] of clients) {
      if (now - client.lastPing > timeout) {
        fastify.log.warn({ clientId }, 'WebSocket client timed out');
        client.socket.terminate();
        clients.delete(clientId);
      } else if (client.socket.readyState === 1) { // OPEN
        client.socket.ping();
      }
    }
  }, 10000);

  // Cleanup on server shutdown
  fastify.addHook('onClose', () => {
    clearInterval(pingInterval);
    for (const [_, client] of clients) {
      client.socket.close(1001, 'Server shutting down');
    }
    clients.clear();
    eventBus.removeAllListeners();
  });
};

/**
 * Handle incoming WebSocket message
 */
async function handleMessage(
  clientId: string,
  message: WsMessage,
  request: { log: { info: (...args: unknown[]) => void } }
): Promise<void> {
  const client = clients.get(clientId);
  if (!client) return;

  switch (message.type) {
    case 'ping':
      sendMessage(client.socket, { type: 'pong', id: message.id });
      break;

    case 'subscribe':
      if (typeof message.payload === 'string') {
        client.subscriptions.add(message.payload);
        sendMessage(client.socket, {
          type: 'subscribed',
          payload: { channel: message.payload },
          id: message.id,
        });
        request.log.info({ clientId, channel: message.payload }, 'Client subscribed');
      } else if (Array.isArray(message.payload)) {
        for (const channel of message.payload) {
          client.subscriptions.add(channel);
        }
        sendMessage(client.socket, {
          type: 'subscribed',
          payload: { channels: message.payload },
          id: message.id,
        });
      }
      break;

    case 'unsubscribe':
      if (typeof message.payload === 'string') {
        client.subscriptions.delete(message.payload);
        sendMessage(client.socket, {
          type: 'unsubscribed',
          payload: { channel: message.payload },
          id: message.id,
        });
        request.log.info({ clientId, channel: message.payload }, 'Client unsubscribed');
      }
      break;

    case 'auth':
      // Authenticate WebSocket connection
      if (typeof message.payload === 'object' && message.payload !== null) {
        const { token } = message.payload as { token?: string };
        if (token) {
          // TODO: Validate JWT token
          client.userId = 'authenticated-user';
          sendMessage(client.socket, {
            type: 'authenticated',
            id: message.id,
          });
        }
      }
      break;

    case 'get:stats':
      // Return current stats
      const stats = {
        connectedClients: clients.size,
        timestamp: new Date().toISOString(),
      };
      sendMessage(client.socket, {
        type: 'stats',
        payload: stats,
        id: message.id,
      });
      break;

    default:
      sendMessage(client.socket, {
        type: 'error',
        payload: { message: `Unknown message type: ${message.type}` },
        id: message.id,
      });
  }
}

/**
 * Send message to a WebSocket client
 */
function sendMessage(socket: WebSocket, message: WsMessage): void {
  if (socket.readyState === 1) { // OPEN
    socket.send(JSON.stringify(message));
  }
}

/**
 * Broadcast message to all clients subscribed to a channel
 */
function broadcast(channel: string, message: WsMessage): void {
  for (const [_, client] of clients) {
    if (client.subscriptions.has(channel) && client.socket.readyState === 1) {
      client.socket.send(JSON.stringify(message));
    }
  }
}

/**
 * Generate unique client ID
 */
function generateClientId(): string {
  return `ws_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

// Export event bus for other parts of the application to emit events
export { eventBus };

// Export types
export type { JobUpdateEvent, SystemEvent, WsMessage };
