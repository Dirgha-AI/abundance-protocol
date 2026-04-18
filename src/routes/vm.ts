import { Hono } from 'hono';
import { FirecrackerClient, VMConfig } from '../vm/firecracker-client.js';

export function createVMRouter(firecracker: FirecrackerClient): Hono {
  const app = new Hono();

  app.get('/vm', (c) => {
    return c.json({ message: 'Firecracker VM manager', status: 'operational' });
  });

  app.post('/vm/create', async (c) => {
    try {
      const { cpuCount, memoryMB } = await c.req.json();
      const config: VMConfig = { cpuCount, memoryMB };
      const vmId = await firecracker.createVM(config);
      await firecracker.startVM(vmId);
      return c.json({ vmId, status: 'started' });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  app.delete('/vm/:vmId', async (c) => {
    try {
      const vmId = c.req.param('vmId');
      await firecracker.stopVM(vmId);
      return c.json({ vmId, status: 'stopped' });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  return app;
}
