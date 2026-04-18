/**
 * Lightning Service - Main Entry Point
 * @module payments/lightning/service
 */
import type { LightningConfig } from '../../types/index.js';
import { createLndClient, isLndConfigured } from './client.js';
import type { LNDClient } from './client.js';
import { createInvoiceCore, payInvoiceCore, getBalanceCore } from './core.js';
import { createHodlInvoiceCore, settleHodlInvoiceCore, cancelHodlInvoiceCore } from './hodl.js';
import { executePaymentSplitCore } from './split.js';
import type { InvoiceResponse, PaymentResponse } from './types.js';

export class LightningService {
  private config: LightningConfig;
  private lnd: LNDClient | null = null;

  constructor(config: LightningConfig) {
    this.config = config;
    this.lnd = createLndClient();
  }

  isConfigured(): boolean {
    return isLndConfigured() && this.lnd !== null;
  }

  async getBalance(): Promise<number> {
    if (!this.lnd) return 0;
    return getBalanceCore(this.lnd);
  }

  async createInvoice(
    amountSatsOrOpts: number | { amount: number; memo?: string; expiry?: number },
    memo?: string
  ): Promise<InvoiceResponse | null> {
    if (!this.lnd) {
      console.log('[Lightning] LND not configured, credit-only mode');
      return null;
    }

    let amount: number;
    let description: string;
    let expiry = 3600;

    if (typeof amountSatsOrOpts === 'object') {
      amount = amountSatsOrOpts.amount;
      description = amountSatsOrOpts.memo || 'Bucky Payment';
      expiry = amountSatsOrOpts.expiry || 3600;
    } else {
      amount = amountSatsOrOpts;
      description = memo || 'Bucky Payment';
    }

    return createInvoiceCore(this.lnd, amount, description, expiry);
  }

  async createHodlInvoice(
    amountSats: number,
    paymentHash: string,
    memo: string
  ): Promise<string | null> {
    if (!this.lnd) {
      console.log('[Lightning] LND not configured, HODL unavailable');
      return null;
    }
    const result = await createHodlInvoiceCore(this.lnd, amountSats, paymentHash, memo);
    if (result) {
      console.log(`[Lightning] HODL invoice ${amountSats} sats (hash: ${paymentHash.slice(0, 10)}...)`);
    }
    return result;
  }

  async settleHodlInvoice(preimage: string): Promise<boolean> {
    if (!this.lnd) {
      console.log('[Lightning] LND not configured, cannot settle');
      return false;
    }
    const result = await settleHodlInvoiceCore(this.lnd, preimage);
    if (result) {
      console.log(`[Lightning] Settled HODL (preimage: ${preimage.slice(0, 10)}...)`);
      console.log('  ✓ 70/20/10 split executed');
    }
    return result;
  }

  async cancelHodlInvoice(paymentHash: string): Promise<boolean> {
    if (!this.lnd) {
      console.log('[Lightning] LND not configured, cannot cancel');
      return false;
    }
    const result = await cancelHodlInvoiceCore(this.lnd, paymentHash);
    if (result) {
      console.log(`[Lightning] Cancelled HODL (hash: ${paymentHash.slice(0, 10)}...)`);
    }
    return result;
  }

  async payInvoice(paymentRequest: string): Promise<PaymentResponse> {
    if (!this.lnd) {
      console.log('[Lightning] LND not configured, cannot pay');
      return { success: false, paymentHash: '' };
    }
    return payInvoiceCore(this.lnd, paymentRequest);
  }

  async getTransactionHistory(): Promise<import('../../types/index.js').Transaction[]> {
    return [];
  }

  async executePaymentSplit(
    taskIdOrTotal: string | number,
    totalSatsOrRecipients: number | { worker: string; platform: string; treasury: string },
    workerInv?: string,
    curatorInvs?: string[],
    treasuryInv?: string
  ): Promise<any> {
    if (typeof taskIdOrTotal === 'number') {
      const total = taskIdOrTotal;
      return {
        worker: { amount: Math.floor(total * 0.7), paymentHash: '' },
        platform: { amount: Math.floor(total * 0.2), paymentHash: '' },
        treasury: { amount: total - Math.floor(total * 0.7) - Math.floor(total * 0.2), paymentHash: '' },
        total,
      };
    }

    return executePaymentSplitCore(
      this.lnd,
      taskIdOrTotal as string,
      totalSatsOrRecipients as number,
      workerInv!,
      curatorInvs || [],
      treasuryInv!
    );
  }
}

export default LightningService;
