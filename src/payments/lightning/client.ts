import { LightningConfig, InvoiceResult, PaymentResult } from '../../types/index';
import { LNDService } from '../lnd';

export interface UnifiedPaymentClient {
  createInvoice(amount: number, description: string): Promise<InvoiceResult>;
  payInvoice(paymentRequest: string): Promise<PaymentResult>;
  getBalance(): Promise<number>;
}

// ln-service lnd handle type — typed as any for forward compat with ln-service versions
export type LNDClient = any;

export function createLndClient(): LNDClient | null {
  const socket = process.env.LND_SOCKET || process.env.LND_GRPC_HOST || '';
  const macaroon = process.env.LND_MACAROON || process.env.LND_MACAROON_PATH || '';
  if (!socket || !macaroon) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { authenticatedLndGrpc } = require('ln-service');
    return authenticatedLndGrpc({ socket, macaroon }).lnd;
  } catch {
    return null;
  }
}

export function isLndConfigured(): boolean {
  return !!(
    (process.env.LND_SOCKET || process.env.LND_GRPC_HOST) &&
    (process.env.LND_MACAROON || process.env.LND_MACAROON_PATH)
  );
}

export class StrikeClient implements UnifiedPaymentClient {
  private config: LightningConfig;

  constructor(config: LightningConfig) {
    this.config = config;
  }

  async createInvoice(amount: number, description: string): Promise<InvoiceResult> {
    const apiKey = (this.config as any).apiKey || process.env.STRIKE_API_KEY || '';
    const res = await fetch('https://api.strike.me/v1/invoices', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: { amount: (amount / 1e8).toFixed(8), currency: 'BTC' }, description }),
    });
    const data = await res.json() as any;
    return {
      paymentHash: data.invoiceId || '',
      paymentRequest: data.lnInvoice || '',
      amount,
      expiresAt: data.expiresAt || new Date(Date.now() + 3600000).toISOString(),
    };
  }

  async payInvoice(paymentRequest: string): Promise<PaymentResult> {
    return { success: false, paymentHash: '', error: 'Strike pay not implemented' };
  }

  async getBalance(): Promise<number> { return 0; }
}

export class LNDPaymentClient implements UnifiedPaymentClient {
  private client: LNDService | null = null;

  constructor() {
    const socket = process.env.LND_SOCKET || '';
    const macaroon = process.env.LND_MACAROON || '';
    const cert = process.env.LND_CERT;
    if (socket && macaroon) {
      this.client = new LNDService({ socket, macaroon, cert });
    }
  }

  async createInvoice(amount: number, description: string): Promise<InvoiceResult> {
    if (!this.client) throw new Error('LND not configured');
    const res = await this.client.createInvoice(amount, description);
    return {
      paymentHash: res.paymentHash,
      paymentRequest: res.paymentRequest,
      amount,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
  }

  async payInvoice(paymentRequest: string): Promise<PaymentResult> {
    if (!this.client) throw new Error('LND not configured');
    const res = await this.client.payInvoice(paymentRequest);
    return { success: true, paymentHash: '', error: `feeSats:${res.feeSats}` };
  }

  async getBalance(): Promise<number> {
    if (!this.client) return 0;
    return this.client.getBalance();
  }

  async executePaymentSplit(
    taskId: string,
    totalSats: number,
    workerInvoice: string,
    upstreamInvoices: string[],
    treasuryAddress: string
  ): Promise<void> {
    if (!this.client) throw new Error('LND not configured');
    await this.client.executePaymentSplit(taskId, totalSats, workerInvoice, upstreamInvoices, treasuryAddress);
  }
}
