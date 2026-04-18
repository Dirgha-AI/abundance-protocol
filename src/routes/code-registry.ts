import { Hono } from 'hono';
import { CodeRegistry, CodeBlock } from '../code/registry.js';

export function createCodeRegistryRouter(registry: CodeRegistry): Hono {
  const app = new Hono();

  app.post('/code/register', async (c) => {
    try {
      const { code, language } = await c.req.json();
      const block = await registry.register(code, language);
      return c.json(block);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  app.get('/code/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const block = await registry.getBlock(id);
      if (!block) {
        return c.json({ error: 'Not found' }, 404);
      }
      return c.json(block);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  app.get('/code', async (c) => {
    try {
      const blocks = await registry.getAllBlocks();
      return c.json({ blocks, count: blocks.length });
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  return app;
}
