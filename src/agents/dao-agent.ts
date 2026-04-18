/**
 * DAOAgent — orchestrates DAO governance lifecycle.
 *
 * Responsibilities:
 * - Monitor proposal queue (new / voting / expired)
 * - Trigger quorum checks via governance engine
 * - Execute approved proposals (treasury releases, membership changes)
 * - Route Human-in-the-Loop (HITL) gates for large payments
 */
import { BuckyAgent } from './base.js';

export interface Proposal {
  id: string;
  daoId: string;
  title: string;
  type: 'payment' | 'membership' | 'config';
  amountSats?: number;
  votesYes: number;
  votesNo: number;
  quorum: number;
  threshold: number;
  expiresAt: Date;
  status: 'pending' | 'active' | 'passed' | 'rejected' | 'executed';
}

export interface DAOAgentConfig {
  /** Polling interval for proposal queue in ms (default 60s) */
  pollIntervalMs?: number;
  /** Sats threshold above which a HITL gate is triggered */
  hitlThresholdSats?: number;
  /** Callback to fetch pending proposals */
  fetchProposals?: () => Promise<Proposal[]>;
  /** Callback invoked on quorum reached */
  onQuorum?: (proposal: Proposal) => Promise<void>;
  /** Callback invoked when HITL gate fires */
  onHITL?: (proposal: Proposal) => Promise<void>;
}

export class DAOAgent extends BuckyAgent {
  private config: Required<DAOAgentConfig>;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(id: string, name: string, config: DAOAgentConfig = {}) {
    super(id, name, 'dao');
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 60_000,
      hitlThresholdSats: config.hitlThresholdSats ?? 500_000,
      fetchProposals: config.fetchProposals ?? (async () => []),
      onQuorum: config.onQuorum ?? (async () => {}),
      onHITL: config.onHITL ?? (async (p) => {
        console.warn(`[DAOAgent] HITL gate: proposal ${p.id} requires human approval (${p.amountSats} sats)`);
      }),
    };
  }

  protected onStart(): void {
    this.schedulePoll();
  }

  protected onStop(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private schedulePoll(): void {
    this.pollTimer = setTimeout(async () => {
      await this.poll();
      if (this.status() === 'working') this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  async poll(): Promise<void> {
    if (this.status() !== 'working') return;
    this.setTask('Polling proposal queue');
    try {
      const proposals = await this.config.fetchProposals();
      for (const p of proposals) {
        await this.evaluate(p);
      }
      this.clearTask();
    } catch (err: any) {
      this.recordError(err);
    }
  }

  async evaluate(proposal: Proposal): Promise<void> {
    const now = new Date();
    if (proposal.expiresAt < now && proposal.status === 'active') {
      const total = proposal.votesYes + proposal.votesNo;
      const ratio = total > 0 ? proposal.votesYes / total : 0;
      proposal.status = ratio >= proposal.threshold ? 'passed' : 'rejected';
      this.emit('proposal_resolved', { proposal });
    }

    if (proposal.status === 'passed') {
      // HITL gate for large payments
      if (proposal.type === 'payment' && (proposal.amountSats ?? 0) >= this.config.hitlThresholdSats) {
        this.setTask(`HITL gate: proposal ${proposal.id} (${proposal.amountSats} sats)`);
        this.emit('hitl_required', { proposal });
        await this.config.onHITL(proposal);
        return;
      }
      this.setTask(`Executing proposal ${proposal.id}`);
      await this.config.onQuorum(proposal);
      this.recordJobDone(0);
    }
  }

  /** Process a vote and check quorum immediately */
  async vote(proposalId: string, memberId: string, vote: 'yes' | 'no', proposals: Proposal[]): Promise<Proposal | null> {
    const p = proposals.find((x) => x.id === proposalId);
    if (!p || p.status !== 'active') return null;
    if (vote === 'yes') p.votesYes++;
    else p.votesNo++;
    const total = p.votesYes + p.votesNo;
    const ratio = total > 0 ? p.votesYes / total : 0;
    if (ratio >= p.threshold && total >= p.quorum) {
      p.status = 'passed';
      this.emit('quorum_reached', { proposal: p, by: memberId });
      await this.evaluate(p);
    }
    return p;
  }
}
