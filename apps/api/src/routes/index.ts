/**
 * Routes Index
 * 
 * Barrel export for all API routes.
 */

export { healthRoutes } from './health.js';
export { authRoutes } from './auth.js';
export { jobRoutes } from './jobs.js';
export { mediaRoutes } from './media.js';
export { downloadRoutes } from './downloads.js';
export { settingsRoutes } from './settings.js';
export { websocketRoutes, eventBus } from './websocket.js';

// Export types
export type { JobUpdateEvent, SystemEvent, WsMessage } from './websocket.js';
