/**
 * Tests for Bucky Core Agents: DAO, Security, Treasury, Routing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DAOAgent, type Proposal } from '../src/agents/dao-agent.js';
import { SecurityAgent } from '../src/agents/security-agent.js';
import { TreasuryAgent } from '../src/agents/treasury-agent.js';
import { RoutingAgent, type WorkerProfile, type JobRequest } from '../src/agents/routing-agent.js';

// ─── DAOAgent ─────────────────────────────────────────────────────────────────

describe('DAOAgent', () => {
  let agent: DAOAgent;

  beforeEach(() => {
    agent = new DAOAgent('test-dao', 'Test DAO Agent', { pollIntervalMs: 999_999 });
  });

  afterEach(() => agent.stop());

  it('starts in idle status', () => {
    expect(agent.status()).toBe('idle');
  });

  it('transitions to working on start', () => {
    agent.start();
    expect(agent.status()).toBe('working');
  });

  it('can be paused and resumed', () => {
    agent.start();
    agent.pause();
    expect(agent.status()).toBe('paused');
    agent.resume();
    expect(agent.status()).toBe('working');
  });

  it('evaluates proposal that has reached threshold', async () => {
    const onQuorum = vi.fn(async () => {});
    const a = new DAOAgent('q-test', 'Quorum Agent', { onQuorum, pollIntervalMs: 999_999 });
    a.start();

    const proposal: Proposal = {
      id: 'p1',
      daoId: 'd1',
      title: 'Test proposal',
      type: 'config',
      votesYes: 4,
      votesNo: 1,
      quorum: 3,
      threshold: 0.6,
      expiresAt: new Date(Date.now() - 1000), // already expired
      status: 'active',
    };

    await a.evaluate(proposal);
    expect(proposal.status).toBe('passed');
    expect(onQuorum).toHaveBeenCalledWith(proposal);
    a.stop();
  });

  it('triggers HITL gate for large payments', async () => {
    const onHITL = vi.fn(async () => {});
    const a = new DAOAgent('hitl-test', 'HITL Agent', {
      hitlThresholdSats: 100_000,
      onHITL,
      pollIntervalMs: 999_999,
    });
    a.start();

    const proposal: Proposal = {
      id: 'p2',
      daoId: 'd1',
      title: 'Large payment',
      type: 'payment',
      amountSats: 200_000,
      votesYes: 4,
      votesNo: 0,
      quorum: 1,
      threshold: 0.5,
      expiresAt: new Date(Date.now() - 1000),
      status: 'passed',
    };

    await a.evaluate(proposal);
    expect(onHITL).toHaveBeenCalledWith(proposal);
    a.stop();
  });

  it('voting increments yes/no counts', async () => {
    agent.start();
    const proposal: Proposal = {
      id: 'v1', daoId: 'd1', title: 'Vote test', type: 'config',
      votesYes: 0, votesNo: 0, quorum: 10, threshold: 0.9,
      expiresAt: new Date(Date.now() + 86_400_000), status: 'active',
    };
    const updated = await agent.vote('v1', 'user1', 'yes', [proposal]);
    expect(updated?.votesYes).toBe(1);
    expect(updated?.votesNo).toBe(0);
  });
});

// ─── SecurityAgent ────────────────────────────────────────────────────────────

describe('SecurityAgent', () => {
  it('detects large payment anomaly', async () => {
    const onThreat = vi.fn(async () => {});
    const agent = new SecurityAgent('sec1', 'Sec Agent', {
      largePaymentThresholdSats: 500_000,
      scanIntervalMs: 999_999,
      getRecentTransactions: async () => [
        { id: 'tx1', sats: 1_000_000, nodeId: 'node-A' },
        { id: 'tx2', sats: 100, nodeId: 'node-B' },
      ],
      getNodeReputations: async () => [],
      onThreat,
    });
    agent.start();
    const threats = await agent.scan();
    expect(threats.length).toBe(1);
    expect(threats[0].type).toBe('payment_anomaly');
    expect(threats[0].severity).toBe('high');
    expect(onThreat).toHaveBeenCalledTimes(1);
    agent.stop();
  });

  it('detects reputation drop', async () => {
    const onThreat = vi.fn(async () => {});
    const agent = new SecurityAgent('sec2', 'Rep Agent', {
      reputationDropThreshold: 0.2,
      scanIntervalMs: 999_999,
      getRecentTransactions: async () => [],
      getNodeReputations: async () => [
        { nodeId: 'node-X', score: 0.3, prevScore: 0.9 },
      ],
      onThreat,
    });
    agent.start();
    const threats = await agent.scan();
    expect(threats.length).toBe(1);
    expect(threats[0].type).toBe('reputation_drop');
    agent.stop();
  });

  it('can resolve a threat', async () => {
    const agent = new SecurityAgent('sec3', 'Resolve Agent', {
      scanIntervalMs: 999_999,
      getRecentTransactions: async () => [{ id: 'tx', sats: 2_000_000, nodeId: 'n1' }],
      getNodeReputations: async () => [],
    });
    agent.start();
    await agent.scan();
    const active = agent.activeThreats();
    expect(active.length).toBeGreaterThan(0);
    const resolved = agent.resolve(active[0].id);
    expect(resolved).toBe(true);
    expect(agent.activeThreats().length).toBe(0);
    agent.stop();
  });
});

// ─── TreasuryAgent ────────────────────────────────────────────────────────────

describe('TreasuryAgent', () => {
  it('computes correct 70/20/10 split', () => {
    const agent = new TreasuryAgent('t1', 'Treasury Agent');
    const breakdown = agent.getSplitBreakdown(100_000);
    expect(breakdown.worker).toBe(70_000);
    expect(breakdown.platform).toBe(20_000);
    expect(breakdown.daoTreasury).toBe(10_000);
    expect(breakdown.worker + breakdown.platform + breakdown.daoTreasury).toBe(100_000);
  });

  it('processes a split and settles it', async () => {
    const onPersist = vi.fn(async () => {});
    const onUpdateTreasury = vi.fn(async () => {});
    const agent = new TreasuryAgent('t2', 'Split Agent', {
      persistSplit: onPersist,
      updateTreasury: onUpdateTreasury,
    });
    agent.start();

    const split = await agent.queueSplit({
      totalSats: 50_000,
      workerId: 'worker-1',
      daoId: 'dao-1',
    });

    expect(split.workerSats).toBe(35_000);
    expect(split.platformSats).toBe(10_000);
    expect(split.daoTreasurySats).toBe(5_000);
    expect(split.status).toBe('settled');
    expect(onPersist).toHaveBeenCalledWith(expect.objectContaining({ totalSats: 50_000 }));
    expect(onUpdateTreasury).toHaveBeenCalledWith('dao-1', 5_000);

    const ledger = agent.getLedger();
    expect(ledger.length).toBe(1);
    expect(ledger[0].id).toBe(split.id);
    agent.stop();
  });

  it('accumulates DAO treasury balance across multiple splits', async () => {
    const agent = new TreasuryAgent('t3', 'Accum Agent');
    agent.start();
    await agent.queueSplit({ totalSats: 100_000, daoId: 'dao-A' });
    await agent.queueSplit({ totalSats: 200_000, daoId: 'dao-A' });
    expect(agent.getTreasuryBalance('dao-A')).toBe(10_000 + 20_000);
    agent.stop();
  });
});

// ─── RoutingAgent ─────────────────────────────────────────────────────────────

describe('RoutingAgent', () => {
  const workers: WorkerProfile[] = [
    { id: 'w1', name: 'Alice', type: 'human', skills: ['React', 'TypeScript'], reputationScore: 4.8, availableSats: 100_000, acceptsRemote: true, status: 'available' },
    { id: 'w2', name: 'Bob', type: 'human', skills: ['Python', 'ML'], reputationScore: 4.2, availableSats: 100_000, acceptsRemote: true, status: 'available' },
    { id: 'w3', name: 'Agent-X', type: 'agent', skills: ['Rust', 'Bitcoin', 'Lightning'], reputationScore: 5.0, availableSats: 500_000, acceptsRemote: true, status: 'available' },
  ];

  const job: JobRequest = {
    id: 'j1', title: 'Lightning escrow', requiredSkills: ['Bitcoin', 'Lightning'],
    budgetSats: 80_000, priority: 'high', postedAt: new Date(), attempts: 0,
  };

  it('routes job to best-matching worker', async () => {
    const onMatch = vi.fn(async () => {});
    const agent = new RoutingAgent('r1', 'Router', {
      routeCycleMs: 999_999,
      getAvailableWorkers: async () => [...workers],
      onMatch,
    });

    const result = await agent.route(job);
    expect(result).not.toBeNull();
    expect(result?.workerId).toBe('w3'); // best skill match for Bitcoin+Lightning
    expect(result?.matchScore).toBeGreaterThan(0.5);
    expect(onMatch).toHaveBeenCalledOnce();
  });

  it('returns null when no workers available', async () => {
    const agent = new RoutingAgent('r2', 'Empty Router', {
      routeCycleMs: 999_999,
      getAvailableWorkers: async () => [],
    });
    const result = await agent.route(job);
    expect(result).toBeNull();
  });

  it('runs a full routing cycle matching multiple jobs', async () => {
    const matched: string[] = [];
    const jobs: JobRequest[] = [
      { id: 'j1', title: 'React app', requiredSkills: ['React'], budgetSats: 50_000, priority: 'medium', postedAt: new Date(), attempts: 0 },
      { id: 'j2', title: 'ML model', requiredSkills: ['Python', 'ML'], budgetSats: 80_000, priority: 'high', postedAt: new Date(), attempts: 0 },
    ];

    const agent = new RoutingAgent('r3', 'Cycle Router', {
      routeCycleMs: 999_999,
      getAvailableWorkers: async () => JSON.parse(JSON.stringify(workers)), // deep copy
      getPendingJobs: async () => jobs,
      onMatch: async (r) => { matched.push(r.jobId); },
    });
    agent.start();
    const results = await agent.routeCycle();
    expect(results.length).toBe(2);
    expect(matched).toContain('j1');
    expect(matched).toContain('j2');
    agent.stop();
  });
});
