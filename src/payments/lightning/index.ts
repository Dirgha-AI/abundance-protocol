import { FeeEstimate } from './types';
import { LightningFeeEstimator } from './fee-estimator';
import { HTLCManager } from './htlc';
import { PaymentStreamManager } from './stream';
import { UnifiedPaymentClient, StrikeClient, LNDPaymentClient } from './client';
import { LightningConfig, InvoiceResult, PaymentResult, Transaction } from '../../types/index';

export class LightningV2 {
  private client: UnifiedPaymentClient | null = null;
  private feeEstimator: LightningFeeEstimator;
  private htlcManager: HTLCManager;
  private streamManager: PaymentStreamManager;

  constructor(config: LightningConfig) {
    this.feeEstimator = new LightningFeeEstimator();
    this.htlcManager = new HTLCManager();
    this.streamManager = new PaymentStreamManager();

    if (config.type === 'strike') {
      this.client = new StrikeClient(config);
    } else if (config.type === 'lnd') {
      this.client = new LNDPaymentClient();
    }
  }

  async createInvoice(amount: number, description: string): Promise<InvoiceResult> {
    if (!this.client) throw new Error('No Lightning client configured');
    return this.client.createInvoice(amount, description);
  }

  async payInvoice(paymentRequest: string): Promise<PaymentResult> {
    if (!this.client) throw new Error('No Lightning client configured');
    return this.client.payInvoice(paymentRequest);
  }

  async estimateFee(sats: number, destination: string): Promise<FeeEstimate> {
    return this.feeEstimator.estimateFee(sats, destination);
  }

  async streamPayment(
    recipientInvoice: string,
    satPerInterval: number,
    intervalMs: number,
    durationMs: number
  ): Promise<AsyncGenerator<{ streamId: string; sent: number; total: number; timestamp: Date; success: boolean }>> {
    return this.streamManager.streamPayment(
      (inv) => this.payInvoice(inv),
      recipientInvoice,
      satPerInterval,
      intervalMs,
      durationMs
    );
  }

  stopStream(streamId: string): void {
    this.streamManager.stopStream(streamId);
  }

  createHTLC(secret: string, sats: number, expiryBlocks: number) {
    return this.htlcManager.create(secret, sats, expiryBlocks);
  }

  settleHTLC(id: string, preimage: string): void {
    this.htlcManager.settle(id, preimage);
  }

  cancelHTLC(id: string): void {
    this.htlcManager.cancel(id);
  }

  async getBalance(): Promise<number> {
    if (!this.client) return 0;
    return this.client.getBalance();
  }
}

export { LightningV2 as LightningV2Client };
export { LightningFeeEstimator, HTLCManager, PaymentStreamManager };
export type { FeeEstimate, PaymentTick, HTLCContract } from './types';

// Re-export LightningService so payments/index.ts can re-export it
export { LightningService } from './service';
