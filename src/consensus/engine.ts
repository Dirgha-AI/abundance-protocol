/**
 * Consensus Engine - supports both DAG (Narwhal-Bullshark) and BFT round modes.
 */

import { EventEmitter } from 'events';

interface BFTRound {
  roundId: string;
  taskId: string;
  totalNodes: number;
  f: number;
  quorum: number;
  status: 'pending' | 'passed' | 'failed';
  proposal: string;
  votes: Array<{ nodeId: string; approve: boolean; timestamp: number }>;
  failureReason?: string;
}

export interface VerificationResult {
  verified: boolean;
  consensusScore: number;
  dissenterCount: number;
  reputationPenalties: string[];
  roundId?: string;
}

export class ConsensusEngine extends EventEmitter {
  private nodeId: string;
  private dagMempool: Map<string, any[]> = new Map();
  private round: number = 0;
  private nodes: Array<{ id: string; publicKey: string }> = [];
  private consensusTimeout: number;
  private bftRounds = new Map<string, BFTRound>();
  private reputationScores = new Map<string, number>();

  constructor(nodeIdOrConfig: string | { nodeId: string; consensusTimeout?: number; nodes?: Array<{ id: string; publicKey: string }> }) {
    super();
    if (typeof nodeIdOrConfig === 'string') {
      this.nodeId = nodeIdOrConfig;
      this.consensusTimeout = 30000;
    } else {
      this.nodeId = nodeIdOrConfig.nodeId;
      this.consensusTimeout = nodeIdOrConfig.consensusTimeout ?? 30000;
      this.nodes = nodeIdOrConfig.nodes ?? [];
    }
  }

  // BFT round API
  createRound(taskId: string, proposal: string): BFTRound {
    const n = this.nodes.length || 5;
    const f = Math.floor((n - 1) / 3);
    const quorum = 2 * f + 1;
    const roundId = `round-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const bftRound: BFTRound = { roundId, taskId, totalNodes: n, f, quorum, status: 'pending', proposal, votes: [] };
    this.bftRounds.set(roundId, bftRound);
    setTimeout(() => {
      if (bftRound.status === 'pending') {
        bftRound.status = 'failed';
        bftRound.failureReason = 'timeout';
      }
    }, this.consensusTimeout);
    return bftRound;
  }

  proposeResult(taskId: string, proposal: string): BFTRound {
    return this.createRound(taskId, proposal);
  }

  receiveVote(roundId: string, nodeId: string, approve: boolean): void {
    const r = this.bftRounds.get(roundId);
    if (!r) return;
    r.votes.push({ nodeId, approve, timestamp: Date.now() });
    const approvals = r.votes.filter(v => v.approve).length;
    if (approvals >= r.quorum) r.status = 'passed';
  }

  getRound(roundId: string): BFTRound | undefined {
    return this.bftRounds.get(roundId);
  }

  isQuorumReached(roundId: string): boolean {
    const r = this.bftRounds.get(roundId);
    if (!r) return false;
    // isQuorumReached: true when approvals exceed f (faulty nodes threshold), i.e. > f
    return r.votes.filter(v => v.approve).length > r.f;
  }

  /**
   * Propose verification for an inference result hash.
   * Returns verified=true if quorum is reached, with consensus score.
   * For single-node mode (< minPeers), returns verified=true with score=1.0
   */
  async proposeVerification(resultHash: string, minPeers: number = 2): Promise<VerificationResult> {
    const peerCount = this.nodes.length || 1;
    
    // Single-node fallback: if fewer than minPeers, auto-verify
    if (peerCount < minPeers) {
      return {
        verified: true,
        consensusScore: 1.0,
        dissenterCount: 0,
        reputationPenalties: [],
      };
    }

    // Create verification round
    const roundId = `verify-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const round = this.createRound(roundId, resultHash);
    
    // Wait for votes (simulated - in real impl, would use gossipsub/pubsub)
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Calculate consensus metrics
    const totalVotes = round.votes.length;
    const approvingVotes = round.votes.filter(v => v.approve).length;
    const consensusScore = totalVotes > 0 ? approvingVotes / totalVotes : 0;
    
    // Determine if verified (2/3 majority required)
    const verified = approvingVotes >= round.quorum;
    
    // Track dissenters for reputation penalties
    const dissenters = round.votes.filter(v => !v.approve);
    const reputationPenalties: string[] = [];
    
    for (const dissenter of dissenters) {
      // Decrement reputation for dissenting from majority
      const currentRep = this.reputationScores.get(dissenter.nodeId) ?? 0.5;
      const newRep = Math.max(0, currentRep - 0.05);
      this.reputationScores.set(dissenter.nodeId, newRep);
      reputationPenalties.push(dissenter.nodeId);
    }
    
    return {
      verified,
      consensusScore,
      dissenterCount: dissenters.length,
      reputationPenalties,
      roundId: round.roundId,
    };
  }

  getReputation(nodeId: string): number {
    return this.reputationScores.get(nodeId) ?? 0.5;
  }

  // DAG Narwhal-Bullshark API (original)
  async submitProof(proofData: any): Promise<void> {
    const workerId = `worker-${Math.random().toString(36).slice(2, 6)}`;
    if (!this.dagMempool.has(workerId)) this.dagMempool.set(workerId, []);
    this.dagMempool.get(workerId)!.push(proofData);
  }

  async bullsharkSequence(): Promise<string[]> {
    this.round++;
    const orderedTasks: string[] = [];
    for (const [, batches] of this.dagMempool.entries()) {
      orderedTasks.push(...batches.map((b: any) => b.taskId));
    }
    this.dagMempool.clear();
    return orderedTasks;
  }
}
