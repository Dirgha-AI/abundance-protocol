import { Hono } from 'hono';
import type { ServiceContainer } from '../services/index.js';

export function registerRoutes(app: Hono, services: ServiceContainer): void {
  // DAO routes
  app.get('/api/dao/teams', async (c) => {
    try {
      const teams = await services.dao.listTeamDAOs();
      return c.json(teams);
    } catch {
      return c.json({ error: 'Failed to list teams' }, 500);
    }
  });

  app.get('/api/dao/teams/:id', async (c) => {
    try {
      const team = await services.dao.loadTeamDAO(c.req.param('id'));
      return c.json(team);
    } catch {
      return c.json({ error: 'Team not found' }, 404);
    }
  });

  // Mesh routes
  app.get('/api/mesh/status', (c) => {
    const peers = services.mesh?.getConnectedPeers?.() || [];
    return c.json({
      peers: peers.length,
      peerIds: peers.map((p: any) => p.id),
      multiaddrs: services.mesh?.getMultiaddrs?.() || []
    });
  });

  // Lightning routes
  app.get('/api/lightning/balance', async (c) => {
    try {
      const balance = await services.lightning.getBalance();
      return c.json(balance);
    } catch {
      return c.json({ error: 'Failed to get balance' }, 500);
    }
  });

  // Reputation routes
  app.get('/api/reputation/:userId', async (c) => {
    try {
      const score = await services.reputation.getScore(c.req.param('userId'));
      return c.json({ userId: c.req.param('userId'), score });
    } catch {
      return c.json({ error: 'Failed to get reputation' }, 500);
    }
  });

  // Task routes
  app.get('/api/tasks', async (c) => {
    try {
      const tasks = await services.taskManager.getActiveTasks?.();
      return c.json(tasks || []);
    } catch {
      return c.json({ error: 'Failed to list tasks' }, 500);
    }
  });

  app.post('/api/tasks', async (c) => {
    try {
      const data = await c.req.json();
      const taskId = services.taskManager.createTask?.(data);
      return c.json({ taskId, status: 'posted' }, 201);
    } catch {
      return c.json({ error: 'Failed to create task' }, 500);
    }
  });
}
