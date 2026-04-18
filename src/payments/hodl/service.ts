/**
 * HODL Service - Main Entry Point
 * @module payments/hodl/service
 */
import { createLndClient } from '../lightning/client.js';
import type { LNDClient } from '../lightning/client.js';
import { createHodlInvoice } from './invoice.js';
import { routePayment } from './route.js';
import { settleHodlInvoice, cancelHodlInvoice } from './settle.js';
import { hodlStore } from './store.js';
import type { CreateHodlResult, RoutePaymentResult, HodlInvoice } from './types.js';

export class HodlService {
  private lnd: LNDClient | null = null;

  constructor() {
    this.lnd = createLndClient();
  }

  isConfigured(): boolean {
    return this.lnd !== null;
  }

  async createHodlInvoice(sats: number, jobId: string): Promise<CreateHodlResult | null> {
    return createHodlInvoice(this.lnd, sats, jobId);
  }

  async routePayment(invoice: string, timeoutMs?: number): Promise<RoutePaymentResult | null> {
    return routePayment(this.lnd, invoice, timeoutMs);
  }

  async settleHodlInvoice(paymentHash: string): Promise<boolean> {
    return settleHodlInvoice(this.lnd, paymentHash);
  }

  async cancelHodlInvoice(paymentHash: string): Promise<boolean> {
    return cancelHodlInvoice(this.lnd, paymentHash);
  }

  getHodlStatus(paymentHash: string): HodlInvoice | undefined {
    return hodlStore.get(paymentHash);
  }

  listPendingHodls(): HodlInvoice[] {
    return hodlStore.listPending();
  }
}

export default HodlService;
