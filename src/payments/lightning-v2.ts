import { createHash } from 'crypto';
import { LightningService } from './lightning.js';
import { LNDService } from './lnd.js';
import { LightningConfig, InvoiceResult, PaymentResult, Transaction } from '../types/index.js';

// ln-service types are not available, using dynamic import
let lnService: unknown = null;
async function loadLnService() {
  if (lnService) return;
  try { lnService = await import('ln-service'); } catch { lnService = null; }
}

export interface PaymentTick {
  streamId: string;
  sent: number;
  total: number;
  timestamp: Date;
  success: boolean;
}

export interface HTLCContract {
  id: string;
  paymentHash: string;
  preimage: string;
  sats: number;
  expiryBlocks: number;
  status: 'pending' | 'settled' | 'cancelled';
}

/**
 * Unified Lightning facade supporting Strike, LND, and HTLC streaming
 */
export class LightningV2 {
  private strikeClient: LightningService | null = null;
  private lndClient: LNDService | null = null;
  private activeStreams: Map<string, boolean> = new Map();
  private htlcStore: Map<string, HTLCContract> = new Map();

  constructor(config: LightningConfig) {
    if (config.type === 'strike') {
      this.strikeClient = new LightningService(config);
    } else if (config.type === 'lnd') {
      const socket = process.env.LND_SOCKET || '';
      const macaroon = process.env.LND_MACAROON || '';
      const cert = process.env.LND_CERT;
      if (socket && macaroon) {
        this.lndClient = new LNDService({ socket, macaroon, cert });
      } else {
        console.warn('LND environment variables not configured');
      }
    }
  }

  /** Create invoice via active client */
  async createInvoice(amount: number, description: string): Promise<InvoiceResult> {
    if (this.strikeClient) {
      const res = await this.strikeClient.createInvoice(amount, description);
      if (!res) return { paymentHash: '', paymentRequest: '', amount: 0, expiresAt: '' };
      return { paymentHash: res.paymentHash, paymentRequest: res.paymentRequest, amount, expiresAt: res.expiresAt ?? '' };
    }
    if (this.lndClient) {
      const res = await this.lndClient.createInvoice(amount, description);
      return {
        paymentHash: res.paymentHash,
        paymentRequest: res.paymentRequest,
        amount,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
    }
    console.warn('No Lightning client configured for createInvoice');
    return { paymentHash: '', paymentRequest: '', amount: 0, expiresAt: '' };
  }

  /** Pay invoice via active client */
  async payInvoice(paymentRequest: string): Promise<PaymentResult> {
    if (this.strikeClient) {
      return this.strikeClient.payInvoice(paymentRequest);
    }
    if (this.lndClient) {
      const res = await this.lndClient.payInvoice(paymentRequest);
      return { success: true, paymentHash: '', error: `feeSats:${res.feeSats}` };
    }
    return { success: false, paymentHash: '' };
  }

  /** Execute payment split across workers and upstream */
  async executePaymentSplit(
    taskId: string,
    totalSats: number,
    workerInvoice: string,
    upstreamInvoices: { invoice: string; amount: number }[],
    treasuryAddress: string
  ): Promise<PaymentResult[]> {
    if (this.strikeClient) {
      return this.strikeClient.executePaymentSplit(taskId, totalSats, workerInvoice, upstreamInvoices.map(u => u.invoice), treasuryAddress);
    }
    if (this.lndClient) {
      const invoices = upstreamInvoices.map(u => u.invoice);
      await this.lndClient.executePaymentSplit(taskId, totalSats, workerInvoice, invoices, treasuryAddress);
      return [];
    }
    return [];
  }

  /** Get balance from active client */
  async getBalance(): Promise<number> {
    if (this.strikeClient) return this.strikeClient.getBalance();
    if (this.lndClient) return this.lndClient.getBalance();
    return 0;
  }

  /** Get transaction history (Strike only) */
  async getTransactionHistory(limit: number): Promise<Transaction[] | undefined> {
    if (this.strikeClient) return this.strikeClient.getTransactionHistory();
    if (this.lndClient) console.warn('Transaction history not available for LND');
    return undefined;
  }

  /** Stream micropayments over time */
  async *streamPayment(
    recipientInvoice: string,
    satPerInterval: number,
    intervalMs: number,
    durationMs: number
  ): AsyncGenerator<PaymentTick> {
    const streamId = 'stream-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    this.activeStreams.set(streamId, true);
    const numTicks = Math.floor(durationMs / intervalMs);

    for (let i = 0; i < numTicks; i++) {
      if (!this.activeStreams.get(streamId)) break;
      const result = await this.payInvoice(recipientInvoice);
      yield {
        streamId,
        sent: satPerInterval,
        total: (i + 1) * satPerInterval,
        timestamp: new Date(),
        success: result.success,
      };
      await new Promise(r => setTimeout(r, intervalMs));
    }
    this.activeStreams.delete(streamId);
  }

  /** Stop an active payment stream */
  stopStream(streamId: string): void {
    this.activeStreams.set(streamId, false);
  }

  /** Create HTLC contract with hashlock */
  async createHTLC(secret: string, sats: number, expiryBlocks: number): Promise<HTLCContract> {
    const preimage = Buffer.from(secret).toString('hex');
    const paymentHash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
    const contract: HTLCContract = {
      id: 'htlc-' + Date.now(),
      paymentHash,
      preimage,
      sats,
      expiryBlocks,
      status: 'pending',
    };
    if (this.lndClient) {
      try {
        await this.lndClient.createInvoice(sats, 'HTLC ' + contract.id);
      } catch (e) {
        console.warn('Hold invoice creation failed:', e);
      }
    }
    this.htlcStore.set(contract.id, contract);
    return contract;
  }

  /** Settle HTLC with preimage revelation */
  async settleHTLC(id: string, preimage: string): Promise<void> {
    const contract = this.htlcStore.get(id);
    if (!contract) throw new Error('HTLC not found');
    const hash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
    if (hash !== contract.paymentHash) throw new Error('Preimage hash mismatch');
    contract.status = 'settled';
    console.log(`HTLC ${id} settled`);
  }

  /** Cancel pending HTLC */
  async cancelHTLC(id: string): Promise<void> {
    const contract = this.htlcStore.get(id);
    if (!contract) throw new Error('HTLC not found');
    contract.status = 'cancelled';
  }

  /** Estimate routing fees to destination */
  async estimateFee(destinationPubkey: string, sats: number): Promise<{ feeSats: number; feePercent: number; route?: string[] }> {
    if (this.lndClient && lnService) {
      try {
        const lnd = (this.lndClient as any).lnd;
        if (lnd) {
          const result = await (lnService as any).queryRoutes({ lnd, destination: destinationPubkey, tokens: sats });
          if (result?.routes?.[0]) {
            const route = result.routes[0];
            const feeSats = route.fee || 0;
            return {
              feeSats,
              feePercent: (feeSats / sats) * 100,
              route: route.hops?.map((h: any) => h.public_key),
            };
          }
        }
      } catch (e) {
        // Fallback to default estimate
      }
    }
    const feeSats = Math.ceil(sats * 0.01);
    return { feeSats, feePercent: 1.0, route: undefined };
  }
}

export default LightningV2;

export { LightningV2 as LightningV2Client };
