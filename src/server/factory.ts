import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import type { ServiceContainer } from '../services/index.js';

export interface ServerInstance {
  app: Hono;
  server: ServerType;
  port: number;
}

export function createServer(services: ServiceContainer, port: number): ServerInstance {
  const app = new Hono();

  // Health check
  app.get('/health', (c) => c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  }));

  // Service status
  app.get('/status', (c) => c.json({
    status: 'healthy',
    nodeId: services.mesh?.nodeId || 'unknown',
    peers: services.mesh?.getPeers?.() || [],
    uptime: Math.floor(process.uptime())
  }));

  return { app, server: serve({ fetch: app.fetch, port }), port };
}
