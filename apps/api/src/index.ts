/**
 * API Server Entry Point
 * 
 * Production-grade Fastify server with:
 * - JWT authentication
 * - Rate limiting
 * - WebSocket support
 * - OpenAPI documentation
 * - Request validation with Zod
 */

import { createServer } from './server.js';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';

async function main(): Promise<void> {
  try {
    const server = await createServer();

    // Graceful shutdown
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    
    for (const signal of signals) {
      process.on(signal, async () => {
        logger.info({ signal }, 'Received shutdown signal');
        
        try {
          await server.close();
          logger.info('Server closed gracefully');
          process.exit(0);
        } catch (err) {
          logger.error({ err }, 'Error during shutdown');
          process.exit(1);
        }
      });
    }

    // Start server
    await server.listen({
      host: config.host,
      port: config.port,
    });

    logger.info({
      port: config.port,
      env: config.nodeEnv,
    }, 'API server started');

  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

main();

// Re-export server factory for testing
export { createServer } from './server.js';
export { config } from './config/index.js';
export { eventBus } from './routes/websocket.js';

