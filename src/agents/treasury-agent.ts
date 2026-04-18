/**
 * TreasuryAgent — manages the 70/20/10 payment split and DAO treasury.
 *
 * Responsibilities:
 * - Execute payment splits for completed jobs/bounties
 * - Maintain ledger of splits (in-memory + persistence hook)
 * - Update DAO treasury balances
 * - Flag overdue pending splits
 * - Emit events for each split phase
 */
import { BuckyAgent } from './base.js';

export interface PaymentSplit {
  id: string;
  jobId?: string;
  totalSats: number;
  workerSats: number;     // 70%
  platformSats: number;   // 20%
  daoTreasurySats: number; // 10%
  workerId?: string;
  daoId?: string;
  status: 'pending' | 'processing' | 'settled' | 'failed';
  createdAt: Date;
  settledAt?: Date;
}

export interface TreasuryBalance {
  daoId: string;
  balanceSats: number;
  lastUpdated: Date;
}

export interface TreasuryAgentConfig {
  /** Worker share (default 0.70) */
  workerShare?: number;
  /** Platform share (default 0.20) */
  platformShare?: number;
  /** DAO treasury share (default remainder ~0.10) */
  /** Hook to persist a split record */
  persistSplit?: (split: PaymentSplit) => Promise<void>;
  /** Hook to update a DAO treasury balance */
  updateTreasury?: (daoId: string, deltaSats: number) => Promise<void>;
  /** Hook to notify worker of payment */
  notifyWorker?: (workerId: string, sats: number) => Promise<void>;
}

export class TreasuryAgent extends BuckyAgent {
  private config: Required<TreasuryAgentConfig>;
  private pendingQueue: PaymentSplit[] = [];
  private ledger: PaymentSplit[] = [];
  private treasuries: Map<string, TreasuryBalance> = new Map();

  constructor(id: string, name: string, config: TreasuryAgentConfig = {}) {
    super(id, name, 'treasury');
    this.config = {
      workerShare: config.workerShare ?? 0.70,
      platformShare: config.platformShare ?? 0.20,
      persistSplit: config.persistSplit ?? (async () => {}),
      updateTreasury: config.updateTreasury ?? (async () => {}),
      notifyWorker: config.notifyWorker ?? (async () => {}),
    };
  }

  protected onStart(): void {
    // Process any queued pending splits on startup
    this.drainQueue();
  }

  protected onStop(): void {
    // No interval to clear
  }

  /**
   * Create a payment split for a completed job/bounty.
   * Queues it and processes asynchronously.
   */
  async queueSplit(params: {
    jobId?: string;
    totalSats: number;
    workerId?: string;
    daoId?: string;
  }): Promise<PaymentSplit> {
    const workerSats = Math.floor(params.totalSats * this.config.workerShare);
    const platformSats = Math.floor(params.totalSats * this.config.platformShare);
    const daoTreasurySats = params.totalSats - workerSats - platformSats;

    const split: PaymentSplit = {
      id: crypto.randomUUID(),
      jobId: params.jobId,
      totalSats: params.totalSats,
      workerSats,
      platformSats,
      daoTreasurySats,
      workerId: params.workerId,
      daoId: params.daoId,
      status: 'pending',
      createdAt: new Date(),
    };

    this.pendingQueue.push(split);
    this.emit('split_queued', split);

    if (this.status() === 'working') {
      await this.processSplit(split);
    }

    return split;
  }

  private async drainQueue(): Promise<void> {
    const pending = this.pendingQueue.filter((s) => s.status === 'pending');
    for (const split of pending) {
      await this.processSplit(split);
    }
  }

  private async processSplit(split: PaymentSplit): Promise<void> {
    split.status = 'processing';
    this.setTask(`Processing split ${split.id} (${split.totalSats} sats)`);
    this.emit('split_processing', split);

    try {
      // 1. Persist the split record
      await this.config.persistSplit(split);

      // 2. Update DAO treasury
      if (split.daoId && split.daoTreasurySats > 0) {
        await this.config.updateTreasury(split.daoId, split.daoTreasurySats);
        const existing = this.treasuries.get(split.daoId) ?? {
          daoId: split.daoId, balanceSats: 0, lastUpdated: new Date()
        };
        existing.balanceSats += split.daoTreasurySats;
        existing.lastUpdated = new Date();
        this.treasuries.set(split.daoId, existing);
      }

      // 3. Notify worker
      if (split.workerId && split.workerSats > 0) {
        await this.config.notifyWorker(split.workerId, split.workerSats);
      }

      split.status = 'settled';
      split.settledAt = new Date();
      this.ledger.push(split);
      this.pendingQueue = this.pendingQueue.filter((s) => s.id !== split.id);
      this.recordJobDone(split.totalSats);
      this.clearTask();
      this.emit('split_settled', split);
    } catch (err: any) {
      split.status = 'failed';
      this.recordError(err);
      this.emit('split_failed', { split, error: err.message });
    }
  }

  getLedger(): PaymentSplit[] {
    return [...this.ledger];
  }

  getPendingQueue(): PaymentSplit[] {
    return this.pendingQueue.filter((s) => s.status === 'pending');
  }

  getTreasuryBalance(daoId: string): number {
    return this.treasuries.get(daoId)?.balanceSats ?? 0;
  }

  getSplitBreakdown(totalSats: number): { worker: number; platform: number; daoTreasury: number } {
    const worker = Math.floor(totalSats * this.config.workerShare);
    const platform = Math.floor(totalSats * this.config.platformShare);
    const daoTreasury = totalSats - worker - platform;
    return { worker, platform, daoTreasury };
  }
}
