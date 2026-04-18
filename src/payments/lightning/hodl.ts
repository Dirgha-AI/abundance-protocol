/**
 * HODL Invoice Operations
 * @module payments/lightning/hodl
 */
import { createInvoice as lnCreateInvoice } from 'ln-service';
import type { LNDClient } from './client.js';

export async function createHodlInvoiceCore(
  lnd: LNDClient,
  amountSats: number,
  paymentHash: string,
  memo: string
): Promise<string | null> {
  try {
    const result = await (lnCreateInvoice as any)({
      lnd,
      tokens: amountSats,
      description: memo,
      id: paymentHash,
    });
    return result.request;
  } catch (error) {
    console.error('[Lightning] Failed to create HODL invoice:', error);
    return null;
  }
}

export async function settleHodlInvoiceCore(
  lnd: LNDClient,
  preimage: string
): Promise<boolean> {
  try {
    const lnService = await import('ln-service');
    await (lnService as any).settleInvoice({ lnd, preimage });
    return true;
  } catch (error) {
    console.error('[Lightning] Failed to settle HODL invoice:', error);
    return false;
  }
}

export async function cancelHodlInvoiceCore(
  lnd: LNDClient,
  paymentHash: string
): Promise<boolean> {
  try {
    const lnService = await import('ln-service');
    await (lnService as any).cancelHodlInvoice({ lnd, id: paymentHash });
    return true;
  } catch (error) {
    console.error('[Lightning] Failed to cancel HODL invoice:', error);
    return false;
  }
}
