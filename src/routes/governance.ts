import { Hono, Context } from 'hono';
import { GovernanceEngine, ExecutionData, Proposal } from '../governance/engine.js';

export function createGovernanceRouter(engine: GovernanceEngine): Hono {
  const app = new Hono();

  app.post('/governance/propose', async (c: Context) => {
    try {
      const { proposer, title, description, type, deposit, executionData } = await c.req.json();
      const proposalId = engine.createProposal(proposer, title, description, type as Proposal['type'], deposit, executionData);
      return c.json({ proposalId });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post('/governance/vote', async (c: Context) => {
    try {
      const { proposalId, voterId, balance, direction } = await c.req.json();
      engine.castVote(proposalId, voterId, direction, balance);
      return c.json({ success: true });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.get('/governance/proposals', async (c: Context) => {
    try {
      const active = engine.getActiveProposals();
      const history = engine.getProposalHistory();
      const map = new Map();
      [...active, ...history].forEach(p => map.set(p.id, p));
      return c.json([...map.values()]);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  });

  app.get('/governance/proposals/:id', async (c: Context) => {
    try {
      const id = c.req.param('id') ?? '';
      const proposal = engine.getProposal(id);
      return c.json(proposal);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 404);
    }
  });

  return app;
}
