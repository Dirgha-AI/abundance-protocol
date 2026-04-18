import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ConsensusEngine } from '../src/consensus/engine.js';
import { TaskManager } from '../src/tasks/manager.js';
import { ReputationManager } from '../src/reputation/manager.js';
import { GovernanceEngine } from '../src/governance/engine.js';
import { LightningService } from '../src/payments/lightning.js';
import { TrainingCoordinator } from '../src/training/coordinator.js';

describe('Project Bucky Mesh - Core Modules', () => {
  
  describe('ConsensusEngine', () => {
    let engine;
    let mockConfig;
    let mockNodes;

    beforeEach(() => {
      mockNodes = [
        { id: 'node1', publicKey: 'pk1' },
        { id: 'node2', publicKey: 'pk2' },
        { id: 'node3', publicKey: 'pk3' },
        { id: 'node4', publicKey: 'pk4' },
        { id: 'node5', publicKey: 'pk5' }
      ];
      mockConfig = {
        nodeId: 'node1',
        consensusTimeout: 30000,
        nodes: mockNodes
      };
      engine = new ConsensusEngine(mockConfig);
    });

    it('creates consensus round with correct quorum (5 nodes → f=1, quorum=3)', () => {
      const round = engine.createRound('task-123', 'result-hash-abc');
      expect(round.totalNodes).toBe(5);
      expect(round.f).toBe(1);
      expect(round.quorum).toBe(3); // 2f + 1
      expect(round.status).toBe('pending');
    });

    it('proposeResult returns pending round', () => {
      const result = engine.proposeResult('task-456', 'result-hash-def');
      expect(result).toHaveProperty('roundId');
      expect(result.status).toBe('pending');
      expect(result.proposal).toBe('result-hash-def');
    });

    it('receiveVote adds to round votes', () => {
      const round = engine.createRound('task-789', 'result-hash-ghi');
      engine.receiveVote(round.roundId, 'node2', true);
      engine.receiveVote(round.roundId, 'node3', true);
      
      const currentRound = engine.getRound(round.roundId);
      expect(currentRound.votes).toHaveLength(2);
      expect(currentRound.votes[0].nodeId).toBe('node2');
      expect(currentRound.votes[0].approve).toBe(true);
    });

    it('isQuorumReached returns true at 2f+1 votes', () => {
      const round = engine.createRound('task-999', 'result-hash-xyz');
      // f=1, quorum=3, need 3 votes to reach quorum
      expect(engine.isQuorumReached(round.roundId)).toBe(false);
      
      engine.receiveVote(round.roundId, 'node2', true);
      expect(engine.isQuorumReached(round.roundId)).toBe(false);
      
      engine.receiveVote(round.roundId, 'node3', true);
      expect(engine.isQuorumReached(round.roundId)).toBe(true);
    });

    it('round fails after 30s timeout', () => {
      vi.useFakeTimers();
      const round = engine.createRound('task-timeout', 'result-hash-timeout');
      
      engine.receiveVote(round.roundId, 'node2', true);
      expect(round.status).toBe('pending');
      
      // Advance time by 30 seconds
      vi.advanceTimersByTime(30000);
      
      const updatedRound = engine.getRound(round.roundId);
      expect(updatedRound.status).toBe('failed');
      expect(updatedRound.failureReason).toBe('timeout');
      
      vi.useRealTimers();
    });
  });

  describe('TaskManager', () => {
    let manager;
    let mockConfig;

    beforeEach(() => {
      mockConfig = {
        nodeId: 'worker-1',
        defaultTimeout: 3600,
        platformFeePercent: 20,
        treasuryPercent: 10
      };
      manager = new TaskManager(mockConfig);
    });

    it('posts task with correct defaults', () => {
      const task = manager.postTask({
        owner: 'user-1',
        requirements: { cpu: 2, memory: 4096, gpu: false }
      });
      
      expect(task.id).toBeDefined();
      expect(task.status).toBe('open');
      expect(task.createdAt).toBeInstanceOf(Date);
      expect(task.requirements.cpu).toBe(2);
      expect(task.payment).toBeDefined();
    });

    it('calculates cost: CPU 1 sat/s + GPU 5 sat/s', () => {
      const cpuTask = manager.calculateCost({ cpu: 4, duration: 60, gpu: false });
      expect(cpuTask).toBe(240); // 4 cores * 60s * 1 sat/s = 240 sats
      
      const gpuTask = manager.calculateCost({ cpu: 2, gpu: 1, duration: 60 });
      expect(gpuTask).toBe(420); // (2*1 + 1*5) * 60 = 420 sats
    });

    it('calculates 70/20/10 split correctly', () => {
      const total = 1000;
      const split = manager.calculatePaymentSplit(total);
      
      expect(split.worker).toBe(700); // 70%
      expect(split.platform).toBe(200); // 20%
      expect(split.treasury).toBe(100); // 10%
      expect(split.worker + split.platform + split.treasury).toBe(total);
    });

    it('full lifecycle: post → assign → start → complete → verify', () => {
      // Post
      const task = manager.postTask({
        owner: 'user-1',
        requirements: { cpu: 2, gpu: false },
        budget: 1000
      });
      expect(task.status).toBe('open');
      
      // Assign
      const assigned = manager.assignTask(task.id, 'worker-1');
      expect(assigned.status).toBe('assigned');
      expect(assigned.assignedTo).toBe('worker-1');
      
      // Start
      const started = manager.startTask(task.id);
      expect(started.status).toBe('running');
      expect(started.startedAt).toBeInstanceOf(Date);
      
      // Complete
      const completed = manager.completeTask(task.id, 'result-hash-123');
      expect(completed.status).toBe('completed');
      expect(completed.resultHash).toBe('result-hash-123');
      
      // Verify
      const verified = manager.verifyTask(task.id, true);
      expect(verified.status).toBe('verified');
      expect(verified.verifiedAt).toBeInstanceOf(Date);
    });

    it('bidOnTask checks capabilities against requirements', () => {
      const task = manager.postTask({
        requirements: { cpu: 4, memory: 8192, gpu: true, gpuMemory: 4096 }
      });
      
      const capableWorker = { cpu: 8, memory: 16384, gpu: true, gpuMemory: 8192 };
      const bid = manager.bidOnTask(task.id, capableWorker);
      expect(bid.accepted).toBe(true);
    });

    it('rejects bid when GPU requirement not met', () => {
      const task = manager.postTask({
        requirements: { cpu: 2, gpu: true, gpuMemory: 4096 }
      });
      
      const incapableWorker = { cpu: 4, memory: 8192, gpu: false, gpuMemory: 0 };
      const bid = manager.bidOnTask(task.id, incapableWorker);
      expect(bid.accepted).toBe(false);
      expect(bid.reason).toContain('GPU');
    });
  });

  describe('ReputationManager', () => {
    let manager;
    let mockConfig;

    beforeEach(() => {
      mockConfig = {
        initialReputation: 0.5,
        maxReputation: 1.0,
        minReputation: 0.0,
        slashThreshold: 3
      };
      manager = new ReputationManager(mockConfig);
    });

    it('new node starts at 0.5 reputation', () => {
      const rep = manager.getReputation('new-node-1');
      expect(rep.overall).toBe(0.5);
      expect(rep.stake).toBe(0);
      expect(rep.slashCount).toBe(0);
    });

    it('recordTaskCompletion increases reputation', () => {
      const nodeId = 'worker-good';
      manager.initializeNode(nodeId);
      
      const initial = manager.getReputation(nodeId).overall;
      manager.recordTaskCompletion(nodeId, 1000); // 1000 sats earned
      
      const updated = manager.getReputation(nodeId);
      expect(updated.overall).toBeGreaterThan(initial);
      expect(updated.tasksCompleted).toBe(1);
    });

    it('recordTaskFailure decreases reputation', () => {
      const nodeId = 'worker-bad';
      manager.initializeNode(nodeId);
      
      const initial = manager.getReputation(nodeId).overall;
      manager.recordTaskFailure(nodeId, 'timeout');
      
      const updated = manager.getReputation(nodeId);
      expect(updated.overall).toBeLessThan(initial);
      expect(updated.tasksFailed).toBe(1);
    });

    it('slash reduces stake and increments slashCount', () => {
      const nodeId = 'worker-malicious';
      manager.initializeNode(nodeId);
      manager.stakeNode(nodeId, 5000);
      
      manager.slash(nodeId, 1000, 'malicious behavior');
      
      const rep = manager.getReputation(nodeId);
      expect(rep.stake).toBe(4000);
      expect(rep.slashCount).toBe(1);
      expect(rep.overall).toBeLessThan(0.5);
    });

    it('3 slashes results in ban (overall = 0)', () => {
      const nodeId = 'worker-banned';
      manager.initializeNode(nodeId);
      manager.stakeNode(nodeId, 10000);
      
      // First slash
      manager.slash(nodeId, 1000, 'violation 1');
      expect(manager.getReputation(nodeId).status).not.toBe('banned');
      
      // Second slash
      manager.slash(nodeId, 1000, 'violation 2');
      expect(manager.getReputation(nodeId).status).not.toBe('banned');
      
      // Third slash
      manager.slash(nodeId, 1000, 'violation 3');
      
      const final = manager.getReputation(nodeId);
      expect(final.slashCount).toBe(3);
      expect(final.overall).toBe(0);
      expect(final.status).toBe('banned');
    });
  });

  describe('GovernanceEngine', () => {
    let engine;
    let mockConfig;

    beforeEach(() => {
      mockConfig = {
        minDeposit: 1000,
        votingPeriod: 604800, // 1 week
        quadraticVoting: true,
        antiWhaleCap: 0.10 // 10%
      };
      engine = new GovernanceEngine(mockConfig);
    });

    it('creates proposal with discussion status', () => {
      const proposal = engine.createProposal({
        title: 'Test Proposal',
        description: 'Increase block size',
        deposit: 1500,
        proposer: 'user-1'
      });
      
      expect(proposal.id).toBeDefined();
      expect(proposal.status).toBe('discussion');
      expect(proposal.deposit).toBe(1500);
      expect(proposal.createdAt).toBeInstanceOf(Date);
    });

    it('castVote applies quadratic voting (sqrt of balance)', () => {
      const proposal = engine.createProposal({
        title: 'Quadratic Test',
        deposit: 1000,
        proposer: 'user-1'
      });
      
      // Move to voting phase
      engine.startVoting(proposal.id);
      
      // User with 10000 tokens should get sqrt(10000) = 100 voting power
      const vote = engine.castVote(proposal.id, 'voter-1', true, 10000);
      expect(vote.votingPower).toBe(100); // sqrt(10000)
      expect(vote.rawBalance).toBe(10000);
    });

    it('anti-whale: max 10% voting power regardless of balance', () => {
      const proposal = engine.createProposal({
        title: 'Anti-Whale Test',
        deposit: 1000,
        proposer: 'user-1'
      });
      
      engine.startVoting(proposal.id);
      
      // Calculate total voting power in system (assume 100000 for test)
      const totalVotingPower = 100000;
      
      // Whale with 50000 tokens would normally get 223.6 votes (sqrt)
      // But capped at 10% of total = 10000 votes
      const whaleVote = engine.castVote(proposal.id, 'whale-1', true, 50000, totalVotingPower);
      
      // Without cap: sqrt(50000) ≈ 223.6
      // With 10% cap of 100000 = 10000 max
      // But sqrt(50000) < 10000, so cap doesn't apply here
      // Let's test with bigger numbers
      const massiveWhaleVote = engine.castVote(proposal.id, 'mega-whale', true, 1000000, totalVotingPower);
      expect(massiveWhaleVote.votingPower).toBeLessThanOrEqual(10000); // 10% of 100000
      expect(massiveWhaleVote.capped).toBe(true);
    });

    it('tallyVotes correctly determines pass/fail', () => {
      const proposal = engine.createProposal({
        title: 'Tally Test',
        deposit: 1000,
        proposer: 'user-1',
        threshold: 0.5 // 50% to pass
      });
      
      engine.startVoting(proposal.id);
      
      // Add votes: 60% yes, 40% no
      engine.castVote(proposal.id, 'voter-1', true, 3600); // 60 votes
      engine.castVote(proposal.id, 'voter-2', true, 3600); // 60 votes  
      engine.castVote(proposal.id, 'voter-3', false, 1600); // 40 votes
      engine.castVote(proposal.id, 'voter-4', false, 1600); // 40 votes
      
      const result = engine.tallyVotes(proposal.id);
      expect(result.passed).toBe(true);
      expect(result.yesPower).toBe(120); // 60 + 60
      expect(result.noPower).toBe(80);   // 40 + 40
    });

    it('rejects proposal below 1000 sats deposit', () => {
      expect(() => {
        engine.createProposal({
          title: 'Cheap Proposal',
          deposit: 999,
          proposer: 'user-1'
        });
      }).toThrow('Insufficient deposit');
      
      // Should work with exactly 1000
      const valid = engine.createProposal({
        title: 'Valid Proposal',
        deposit: 1000,
        proposer: 'user-1'
      });
      expect(valid.id).toBeDefined();
    });
  });

  describe('LightningService', () => {
    let service;
    let mockConfig;

    beforeEach(() => {
      mockConfig = {
        nodeUri: 'localhost:10009',
        macaroon: 'test-macaroon',
        tlsCert: 'test-cert'
      };
      service = new LightningService(mockConfig);
    });

    it('createInvoice returns null when LND not configured', async () => {
      // In test env LND_SOCKET/LND_MACAROON are not set, so service returns null (credit-only mode)
      const invoice = await service.createInvoice({
        amount: 5000,
        memo: 'Task payment',
        expiry: 3600
      });
      expect(invoice).toBeNull();
    });

    it('executePaymentSplit divides correctly: 70/20/10', async () => {
      const recipients = {
        worker: 'worker-node-pubkey',
        platform: 'platform-node-pubkey', 
        treasury: 'treasury-node-pubkey'
      };
      
      const result = await service.executePaymentSplit(1000, recipients);
      
      expect(result.worker.amount).toBe(700);
      expect(result.platform.amount).toBe(200);
      expect(result.treasury.amount).toBe(100);
      expect(result.total).toBe(1000);
      expect(result.worker.paymentHash).toBeDefined();
      expect(result.platform.paymentHash).toBeDefined();
      expect(result.treasury.paymentHash).toBeDefined();
    });

    it('getBalance returns 0 when LND not configured', async () => {
      const balance = await service.getBalance();
      expect(typeof balance).toBe('number');
      expect(balance).toBe(0);
    });
  });

  describe('TrainingCoordinator', () => {
    let coordinator;
    let mockConfig;

    beforeEach(() => {
      mockConfig = {
        modelId: 'gpt-small',
        maxWorkers: 4,
        gradientThreshold: 3.0, // 3x median norm
        compressionRatio: 0.1 // top 10% (90% reduction)
      };
      coordinator = new TrainingCoordinator(mockConfig);
    });

    it('starts training job with correct initial state', () => {
      const job = coordinator.startTrainingJob({
        dataset: 'dataset-123',
        epochs: 5,
        batchSize: 32
      });
      
      expect(job.id).toBeDefined();
      expect(job.status).toBe('initializing');
      expect(job.workers).toHaveLength(0);
      expect(job.currentEpoch).toBe(0);
      expect(job.globalStep).toBe(0);
    });

    it('validateGradient rejects outlier gradients (>3x median norm)', () => {
      const gradients = [
        { workerId: 'w1', norm: 1.0, data: [0.1, 0.2] },
        { workerId: 'w2', norm: 1.1, data: [0.11, 0.22] },
        { workerId: 'w3', norm: 0.9, data: [0.09, 0.18] },
        { workerId: 'w4', norm: 5.0, data: [0.5, 1.0] } // Outlier: 5.0 > 3*1.0
      ];
      
      const median = 1.0; // Median of [0.9, 1.0, 1.1] (excluding outlier for median calc)
      const validation = coordinator.validateGradient(gradients[3], gradients, median);
      
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('outlier');
      expect(validation.ratio).toBeGreaterThan(3.0);
    });

    it('compressGradients reduces size by >90% with topk', () => {
      const originalSize = 10000; // 10000 floats
      const gradient = {
        values: new Array(originalSize).fill(0).map(() => Math.random()),
        indices: Array.from({ length: originalSize }, (_, i) => i)
      };
      
      const compressed = coordinator.compressGradients(gradient, 0.1); // top 10%
      
      expect(compressed.values.length).toBe(1000); // 10% of original
      expect(compressed.compressionRatio).toBe(0.1);
      expect(originalSize / compressed.values.length).toBeGreaterThanOrEqual(10); // >90% reduction
    });

    it('handles worker failure gracefully', () => {
      const job = coordinator.startTrainingJob({
        dataset: 'dataset-123',
        epochs: 5
      });
      
      // Add workers
      coordinator.addWorker(job.id, 'worker-1');
      coordinator.addWorker(job.id, 'worker-2');
      coordinator.addWorker(job.id, 'worker-3');
      
      // Simulate failure
      const result = coordinator.handleWorkerFailure(job.id, 'worker-2', 'connection_timeout');
      
      expect(result.failedWorker).toBe('worker-2');
      expect(result.job.status).toBe('recovering');
      expect(result.remainingWorkers).toBe(2);
      expect(result.checkpointSaved).toBe(true);
      
      // Verify job continues with remaining workers
      const updatedJob = coordinator.getJob(job.id);
      expect(updatedJob.workers).not.toContain('worker-2');
      expect(updatedJob.status).toBe('running');
    });
  });
});
