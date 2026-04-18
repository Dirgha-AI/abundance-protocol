import type { Hono } from 'hono';
import type { CoreServices } from '../services/core.js';
import { globalBus } from '../shared/event-bus.js';
import { createVMRouter } from '../routes/vm.js';
import { createCodeRegistryRouter } from '../routes/code-registry.js';
import { createGovernanceRouter } from '../routes/governance.js';

export function setupEventHandlers(services: CoreServices): void {
  // Persist discovered peers
  services.node.onPeerDiscovered((peer) => {
    if (peer.peerId && peer.addresses?.length) {
      services.peerStore.savePeer(peer.peerId, peer.addresses, peer.capabilities);
    }
  });

  // Handle task completion
  globalBus.subscribe('task.completed', async (event) => {
    try {
      const { taskId, workerId, output } = event.payload as { taskId: string; workerId: string; output?: string };
      const task = services.taskManager.getTaskById(taskId);
      if (!task) return;

      const sats = task.budget;
      const workerInv = await services.lightning.createInvoice(Math.floor(sats * 0.7), 'worker-' + taskId);
      const treasuryInv = await services.lightning.createInvoice(Math.floor(sats * 0.1), 'treasury-' + taskId);
      await services.lightning.executePaymentSplit(taskId, sats, workerInv?.paymentRequest ?? '', [], treasuryInv?.paymentRequest ?? '');
      console.log('[Bucky] Payment split for task', taskId);

      if (output) {
        const audit = await services.arniko.onTaskOutput(taskId, output);
        if (audit.maturityScore > 0.92) {
          await services.dedupEngine.register(task.description, output, workerId, audit.maturityScore);
        }
      }
    } catch (err) {
      console.error('[Bucky] Task completion failed:', err);
    }
  });
}

export function registerDaemonRoutes(app: Hono, services: CoreServices, config: { nodeId: string; stakeAmount: number }): void {
  const { nodeId, stakeAmount } = config;

  // Chat completions
  app.post('/v1/chat/completions', async (c) => {
    try {
      const body = await c.req.json();
      const intent = body.messages[0].content;
      const userId = c.req.header('X-User-ID') || 'anonymous';

      const cachedBlock = await services.dedupEngine.lookup(intent);
      if (cachedBlock) {
        return c.json({
          id: `sota-${cachedBlock.id}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'sota-registry-v1',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: `[SOTA HIT] Block ${cachedBlock.id}` },
            finish_reason: 'stop'
          }]
        });
      }

      const result = await services.meshProvider.distributedChat(intent, userId);
      return c.json({
        id: 'mesh-' + Math.random().toString(36).slice(2, 9),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model || 'distributed-moe',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: result },
          finish_reason: 'stop'
        }]
      });
    } catch {
      return c.json({ error: 'Mesh inference failed' }, 500);
    }
  });

  // Basic routes
  app.get('/health', (c) => c.json({ status: 'healthy', nodeId, peers: services.node.getPeers().length }));
  app.get('/peers', (c) => c.json(services.node.getPeers()));
  app.get('/tasks', (c) => c.json(services.taskManager.getActiveTasks()));
  app.get('/balance', async (c) => {
    try { return c.json({ balance: await services.lightning.getBalance() }); }
    catch { return c.json({ error: 'Lightning not configured' }, 503); }
  });
  app.get('/stake', (c) => c.json({ nodeId, stakeAmount }));

  // Sub-routers
  app.route('/', createVMRouter(services.firecracker));
  app.route('/', createCodeRegistryRouter(services.codeRegistry));
  app.route('/', createGovernanceRouter(services.governance));
}
