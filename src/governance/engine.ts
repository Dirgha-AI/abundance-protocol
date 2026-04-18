/**
 * Project Bucky Mesh DAO Governance System
 * 
 * A quadratic voting-based governance engine with anti-whale protections,
 * delegation support, and integrated treasury management.
 */

export interface GovernanceConfig {
  /** Percentage of total supply required to vote for quorum (0-100) */
  quorumPercent: number;
  /** Approval threshold for standard proposals (0-100) */
  standardThreshold: number;
  /** Approval threshold for critical proposals (0-100) */
  criticalThreshold: number;
  /** Duration of voting period in milliseconds */
  votingPeriodMs: number;
  /** Timelock delay after passing before execution in milliseconds */
  timelockMs: number;
  /** Duration of discussion period before voting can start (default: 7 days) */
  discussionPeriodMs?: number;
  /** Total token supply for anti-whale calculations */
  totalSupply: number;
}

export interface ExecutionData {
  type: string;
  params: Record<string, unknown>;
}

export interface Vote {
  /** Quadratic voting power applied (capped at 10% of total supply power) */
  power: number;
  direction: 'for' | 'against';
  timestamp: Date;
  /** Raw token balance used for this vote */
  rawBalance: number;
  /** Addresses that delegated power to this vote */
  delegatedPower?: Map<string, number>;
}

export interface Proposal {
  id: string;
  proposer: string;
  title: string;
  description: string;
  type: 'standard' | 'critical' | 'treasury_spend' | 'parameter_change';
  deposit: number;
  status: 'discussion' | 'voting' | 'passed' | 'rejected' | 'executed' | 'expired';
  votes: Map<string, Vote>;
  createdAt: Date;
  votingStartsAt: Date;
  votingEndsAt: Date;
  executionData?: ExecutionData;
  /** When the proposal passed (for timelock calculation) */
  passedAt?: Date;
  /** When the proposal was executed */
  executedAt?: Date;
  /** Cached tally of for votes */
  totalForPower: number;
  /** Cached tally of against votes */
  totalAgainstPower: number;
}

export interface TreasuryTransaction {
  id: string;
  type: 'deposit' | 'spend';
  amount: number;
  timestamp: Date;
  source?: string;
  proposalId?: string;
  recipient?: string;
  description?: string;
}

export interface TreasuryReport {
  balance: number;
  deposits30d: number;
  spends30d: number;
  runwayMonths: number;
  monthlyBurnRate: number;
}

/**
 * Governance Engine for Project Bucky Mesh
 * 
 * Implements quadratic voting with anti-whale caps (max 10% of total supply power),
 * delegation mechanics, and comprehensive treasury management.
 */
export class GovernanceEngine {
  private config: Required<GovernanceConfig>;
  private proposals: Map<string, Proposal>;
  private treasuryBalance: number;
  private treasuryTransactions: TreasuryTransaction[];
  /** Map of delegator -> delegatee */
  private delegations: Map<string, string>;
  /** Map of voter -> delegators (reverse index for quick lookup) */
  private delegationIndex: Map<string, Set<string>>;
  /** Token balances registry for delegation calculations */
  private tokenBalances: Map<string, number>;
  private proposalCounter: number;
  private _minDeposit: number;
  private _antiWhaleCap: number;
  private _quadraticVoting: boolean;
  private _simplifiedMode: boolean;

  /**
   * Creates a new GovernanceEngine instance
   * @param config - Governance configuration parameters (full or simplified)
   */
  constructor(config: GovernanceConfig | any) {
    const isSimplified = !('quorumPercent' in config) && ('minDeposit' in config || 'antiWhaleCap' in config || 'votingPeriod' in config || 'quadraticVoting' in config);

    if (isSimplified) {
      this._simplifiedMode = true;
      this._minDeposit = config.minDeposit ?? 1000;
      this._antiWhaleCap = config.antiWhaleCap ?? 0.1;
      this._quadraticVoting = config.quadraticVoting ?? true;
      this.config = {
        quorumPercent: 10,
        standardThreshold: 50,
        criticalThreshold: 75,
        votingPeriodMs: (config.votingPeriod ?? 604800) * 1000,
        timelockMs: 48 * 60 * 60 * 1000,
        discussionPeriodMs: 0,
        totalSupply: config.totalSupply ?? 1000000,
      };
    } else {
      this._simplifiedMode = false;
      this._minDeposit = 1000;
      this._antiWhaleCap = 0.1;
      this._quadraticVoting = true;
      this.config = {
        quorumPercent: config.quorumPercent ?? 10,
        standardThreshold: config.standardThreshold ?? 60,
        criticalThreshold: config.criticalThreshold ?? 75,
        votingPeriodMs: config.votingPeriodMs ?? 7 * 24 * 60 * 60 * 1000,
        timelockMs: config.timelockMs ?? 48 * 60 * 60 * 1000,
        discussionPeriodMs: config.discussionPeriodMs ?? 7 * 24 * 60 * 60 * 1000,
        totalSupply: config.totalSupply,
      };
    }

    this.proposals = new Map();
    this.treasuryBalance = 0;
    this.treasuryTransactions = [];
    this.delegations = new Map();
    this.delegationIndex = new Map();
    this.tokenBalances = new Map();
    this.proposalCounter = 0;
  }

  /**
   * Registers a token balance for an address (required for delegation calculations)
   * @param address - The voter address
   * @param balance - Token balance
   */
  registerBalance(address: string, balance: number): void {
    this.tokenBalances.set(address, balance);
  }

  /**
   * Sets up delegation from one address to another
   * @param delegator - Address delegating their voting power
   * @param delegatee - Address receiving the delegation (null to remove)
   * @throws Error if circular delegation detected or delegator has active votes
   */
  setDelegation(delegator: string, delegatee: string | null): void {
    if (delegatee === null) {
      // Remove existing delegation
      const existing = this.delegations.get(delegator);
      if (existing) {
        this.delegationIndex.get(existing)?.delete(delegator);
        this.delegations.delete(delegator);
      }
      return;
    }

    if (delegator === delegatee) {
      throw new Error('Cannot delegate to self');
    }

    // Check for circular delegation
    let current = delegatee;
    const visited = new Set<string>();
    while (this.delegations.has(current)) {
      if (visited.has(current)) {
        throw new Error('Circular delegation detected');
      }
      visited.add(current);
      current = this.delegations.get(current)!;
      if (current === delegator) {
        throw new Error('Circular delegation detected');
      }
    }

    // Check if delegator has voted in any active proposal
    for (const [id, proposal] of this.proposals) {
      if (proposal.status === 'voting' && proposal.votes.has(delegator)) {
        throw new Error(`Cannot delegate: ${delegator} has already voted in active proposal ${id}`);
      }
    }

    // Remove from old delegatee if exists
    const oldDelegatee = this.delegations.get(delegator);
    if (oldDelegatee) {
      this.delegationIndex.get(oldDelegatee)?.delete(delegator);
    }

    // Set new delegation
    this.delegations.set(delegator, delegatee);
    if (!this.delegationIndex.has(delegatee)) {
      this.delegationIndex.set(delegatee, new Set());
    }
    this.delegationIndex.get(delegatee)!.add(delegator);
  }

  /**
   * Creates a new proposal in discussion phase.
   * Accepts either object form {title, description?, deposit, proposer?, threshold?} returning Proposal,
   * or positional args (proposer, title, description, type, deposit, executionData?) returning string ID.
   */
  createProposal(
    proposerOrOpts: string | { title: string; description?: string; deposit: number; proposer?: string; threshold?: number },
    title?: string,
    description?: string,
    type?: Proposal['type'],
    deposit?: number,
    executionData?: ExecutionData
  ): string | Proposal {
    if (typeof proposerOrOpts === 'object') {
      const opts = proposerOrOpts;
      if (opts.deposit < this._minDeposit) {
        throw new Error('Insufficient deposit');
      }
      const now = new Date();
      const id = `prop-${++this.proposalCounter}-${now.getTime()}`;
      const proposal: Proposal & { _threshold?: number } = {
        id,
        proposer: opts.proposer ?? 'unknown',
        title: opts.title,
        description: opts.description ?? '',
        type: 'standard',
        deposit: opts.deposit,
        status: 'discussion',
        votes: new Map(),
        createdAt: now,
        votingStartsAt: new Date(now.getTime() + this.config.discussionPeriodMs),
        votingEndsAt: new Date(now.getTime() + this.config.discussionPeriodMs + this.config.votingPeriodMs),
        totalForPower: 0,
        totalAgainstPower: 0,
      };
      if (opts.threshold !== undefined) {
        (proposal as any)._threshold = opts.threshold;
      }
      this.proposals.set(id, proposal);
      return proposal;
    }

    // Positional args form
    const proposer = proposerOrOpts;
    const dep = deposit ?? 0;
    if (dep < 1000) {
      throw new Error('Minimum deposit is 1000 sats');
    }
    const propType = type ?? 'standard';
    if (!['standard', 'critical', 'treasury_spend', 'parameter_change'].includes(propType)) {
      throw new Error('Invalid proposal type');
    }
    const now = new Date();
    const id = `prop-${++this.proposalCounter}-${now.getTime()}`;
    const proposal: Proposal = {
      id,
      proposer,
      title: title!,
      description: description!,
      type: propType,
      deposit: dep,
      status: 'discussion',
      votes: new Map(),
      createdAt: now,
      votingStartsAt: new Date(now.getTime() + this.config.discussionPeriodMs),
      votingEndsAt: new Date(now.getTime() + this.config.discussionPeriodMs + this.config.votingPeriodMs),
      executionData,
      totalForPower: 0,
      totalAgainstPower: 0,
    };
    this.proposals.set(id, proposal);
    return id;
  }

  /**
   * Transitions a proposal from discussion to voting phase.
   * In simplified mode, timing checks are skipped.
   */
  startVoting(proposalId: string): void {
    const proposal = this.getProposal(proposalId);

    if (proposal.status !== 'discussion') {
      throw new Error(`Cannot start voting: proposal is ${proposal.status}`);
    }

    // Skip discussion period timing check in simplified mode
    if (!this._simplifiedMode) {
      const now = new Date();
      if (now < proposal.votingStartsAt) {
        throw new Error('Discussion period has not elapsed yet');
      }
    }

    proposal.status = 'voting';
  }

  /**
   * Calculates quadratic voting power with anti-whale cap
   * @param balance - Token balance
   * @returns Voting power (sqrt of balance, capped at 10% of total supply power)
   */
  private calculateVotingPower(balance: number): number {
    const rawPower = Math.sqrt(balance);
    const maxPower = Math.sqrt(this.config.totalSupply * 0.1);
    return Math.min(rawPower, maxPower);
  }

  /**
   * Casts a vote with quadratic power calculation.
   * Accepts boolean direction (true=for, false=against) or string ('for'/'against').
   * Optional 5th arg totalVotingPower enables anti-whale balance cap.
   * Returns { votingPower, rawBalance, capped? }.
   */
  castVote(
    proposalId: string,
    voterId: string,
    direction: 'for' | 'against' | boolean,
    tokenBalance: number,
    totalVotingPower?: number
  ): { votingPower: number; rawBalance: number; capped?: boolean } {
    const proposal = this.getProposal(proposalId);

    if (proposal.status !== 'voting') {
      throw new Error(`Proposal is not in voting phase: ${proposal.status}`);
    }

    // Skip timing checks in simplified mode
    if (!this._simplifiedMode) {
      const now = new Date();
      if (now > proposal.votingEndsAt) throw new Error('Voting period has ended');
      if (now < proposal.votingStartsAt) throw new Error('Voting has not started yet');
      if (this.delegations.has(voterId)) {
        throw new Error(`Voter ${voterId} has delegated to ${this.delegations.get(voterId)} and cannot vote directly`);
      }
    }

    // Normalize direction
    const dir: 'for' | 'against' = typeof direction === 'boolean' ? (direction ? 'for' : 'against') : direction;

    // Anti-whale cap: cap balance before computing sqrt
    let effectiveBalance = tokenBalance;
    let capped = false;
    if (totalVotingPower !== undefined && this._antiWhaleCap > 0) {
      const maxBalance = totalVotingPower * this._antiWhaleCap;
      if (effectiveBalance > maxBalance) {
        effectiveBalance = maxBalance;
        capped = true;
      }
    }

    // Calculate voting power
    let power: number;
    if (this._simplifiedMode && this._quadraticVoting) {
      power = Math.sqrt(effectiveBalance);
    } else {
      power = this.calculateVotingPower(effectiveBalance);
      // Also aggregate delegated power in full mode
      const delegatedFrom = new Map<string, number>();
      const delegators = this.delegationIndex.get(voterId);
      if (delegators) {
        for (const delegator of delegators) {
          const delegatorBalance = this.tokenBalances.get(delegator) ?? 0;
          const delegatorPower = this.calculateVotingPower(delegatorBalance);
          power += delegatorPower;
          delegatedFrom.set(delegator, delegatorPower);
        }
      }
    }

    // Remove existing vote from tallies
    const existingVote = proposal.votes.get(voterId);
    if (existingVote) {
      if (existingVote.direction === 'for') proposal.totalForPower -= existingVote.power;
      else proposal.totalAgainstPower -= existingVote.power;
    }

    // Record vote
    const vote: Vote = {
      power,
      direction: dir,
      timestamp: new Date(),
      rawBalance: tokenBalance,
    };
    proposal.votes.set(voterId, vote);

    if (dir === 'for') proposal.totalForPower += power;
    else proposal.totalAgainstPower += power;

    const ret: { votingPower: number; rawBalance: number; capped?: boolean } = { votingPower: power, rawBalance: tokenBalance };
    if (capped) ret.capped = true;
    return ret;
  }

  /**
   * Tallies votes and determines proposal outcome.
   * In simplified mode, timing checks are skipped.
   * Returns { passed, yesPower, noPower, quorumMet?, details? }.
   */
  tallyVotes(proposalId: string): { passed: boolean; yesPower: number; noPower: number; quorumMet?: boolean; details?: string } {
    const proposal = this.getProposal(proposalId);

    if (proposal.status !== 'voting') {
      throw new Error(`Cannot tally: proposal is ${proposal.status}`);
    }

    // Skip timing check in simplified mode
    if (!this._simplifiedMode) {
      const now = new Date();
      if (now < proposal.votingEndsAt) {
        throw new Error('Voting period has not ended yet');
      }
    }

    const yesPower = proposal.totalForPower;
    const noPower = proposal.totalAgainstPower;
    const totalCast = yesPower + noPower;

    // Use per-proposal threshold (fraction) or config threshold (percent)
    const threshold = (proposal as any)._threshold !== undefined
      ? (proposal as any)._threshold
      : this.config.standardThreshold / 100;

    const passed = totalCast > 0 && yesPower / totalCast >= threshold;

    if (passed) {
      proposal.status = 'passed';
      proposal.passedAt = new Date();
    } else {
      proposal.status = 'rejected';
    }

    return { passed, yesPower, noPower };
  }

  /**
   * Executes a passed proposal after timelock period
   * For treasury_spend, automatically processes the spend
   * 
   * @param proposalId - Proposal to execute
   * @throws Error if not passed, timelock active, or execution failed
   */
  executeProposal(proposalId: string): void {
    const proposal = this.getProposal(proposalId);
    const now = new Date();

    if (proposal.status !== 'passed') {
      throw new Error(`Cannot execute: proposal is ${proposal.status}`);
    }

    if (!proposal.passedAt) {
      throw new Error('Proposal missing passed timestamp');
    }

    const timelockEnd = new Date(proposal.passedAt.getTime() + this.config.timelockMs);
    if (now < timelockEnd) {
      throw new Error(`Timelock active until ${timelockEnd.toISOString()}`);
    }

    // Handle treasury spends
    if (proposal.type === 'treasury_spend' && proposal.executionData) {
      const amount = proposal.executionData.params.amount as number;
      const recipient = proposal.executionData.params.recipient as string;
      
      if (amount && recipient) {
        this.recordSpend(proposalId, amount, recipient);
      }
    }

    proposal.status = 'executed';
    proposal.executedAt = now;
  }

  /**
   * Retrieves a proposal by ID
   * @param id - Proposal ID
   * @returns Proposal object
   * @throws Error if not found
   */
  getProposal(id: string): Proposal {
    const proposal = this.proposals.get(id);
    if (!proposal) {
      throw new Error(`Proposal ${id} not found`);
    }
    return proposal;
  }

  /**
   * Returns all proposals currently in voting phase
   * @returns Array of active proposals
   */
  getActiveProposals(): Proposal[] {
    return Array.from(this.proposals.values())
      .filter(p => p.status === 'voting')
      .sort((a, b) => a.votingEndsAt.getTime() - b.votingEndsAt.getTime());
  }

  /**
   * Returns historical proposals sorted by creation date (newest first)
   * @param limit - Maximum number to return
   * @returns Array of proposals
   */
  getProposalHistory(limit: number = 100): Proposal[] {
    return Array.from(this.proposals.values())
      .filter(p => ['passed', 'rejected', 'executed', 'expired'].includes(p.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  /**
   * Records a deposit to the treasury
   * @param amount - Amount in sats
   * @param source - Source identifier
   * @param description - Optional description
   */
  recordDeposit(amount: number, source: string, description?: string): void {
    if (amount <= 0) {
      throw new Error('Deposit amount must be positive');
    }

    this.treasuryBalance += amount;
    this.treasuryTransactions.push({
      id: `dep-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'deposit',
      amount,
      timestamp: new Date(),
      source,
      description
    });
  }

  /**
   * Records a spend from the treasury (internal or via executed proposal)
   * @param proposalId - Associated proposal ID
   * @param amount - Amount in sats
   * @param recipient - Recipient address
   * @throws Error if insufficient balance or proposal not valid
   */
  recordSpend(proposalId: string, amount: number, recipient: string): void {
    if (amount <= 0) {
      throw new Error('Spend amount must be positive');
    }

    if (amount > this.treasuryBalance) {
      throw new Error(`Insufficient treasury balance: ${this.treasuryBalance} < ${amount}`);
    }

    // Verify this is a valid treasury spend proposal if called externally
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.type !== 'treasury_spend') {
      throw new Error('Invalid proposal for treasury spend');
    }

    this.treasuryBalance -= amount;
    this.treasuryTransactions.push({
      id: `spend-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'spend',
      amount,
      timestamp: new Date(),
      proposalId,
      recipient,
      description: `Treasury spend for proposal ${proposalId}`
    });
  }

  /**
   * Generates a comprehensive treasury report
   * @returns TreasuryReport with 30-day statistics and runway
   */
  getTreasuryReport(): TreasuryReport {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    let deposits30d = 0;
    let spends30d = 0;

    for (const tx of this.treasuryTransactions) {
      if (tx.timestamp >= thirtyDaysAgo) {
        if (tx.type === 'deposit') {
          deposits30d += tx.amount;
        } else {
          spends30d += tx.amount;
        }
      }
    }

    // Calculate monthly burn rate based on last 30 days
    const monthlyBurnRate = spends30d;
    const runwayMonths = monthlyBurnRate > 0 
      ? this.treasuryBalance / monthlyBurnRate 
      : Infinity;

    return {
      balance: this.treasuryBalance,
      deposits30d,
      spends30d,
      runwayMonths: runwayMonths === Infinity ? 999 : parseFloat(runwayMonths.toFixed(2)),
      monthlyBurnRate
    };
  }

  /**
   * Gets current delegation status for an address
   * @param address - Address to check
   * @returns Delegatee address or null
   */
  getDelegation(address: string): string | null {
    return this.delegations.get(address) ?? null;
  }

  /**
   * Gets all delegators for a specific delegatee
   * @param delegatee - The delegatee address
   * @returns Array of delegator addresses
   */
  getDelegators(delegatee: string): string[] {
    return Array.from(this.delegationIndex.get(delegatee) ?? []);
  }
}
