/**
 * HODL Route Payment (Step 2) - Wait for payment
 * @module payments/hodl/route
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { subscribeToInvoice } = require('ln-service') as any;
import type { LNDClient } from '../lightning/client.js';
import { hodlStore } from './store.js';
import type { RoutePaymentResult } from './types.js';

export async function routePayment(
  lnd: LNDClient | null,
  invoice: string,
  timeoutMs: number = 300000
): Promise<RoutePaymentResult | null> {
  if (!lnd) {
    console.log('[HODL] LND not configured, cannot route payment');
    return null;
  }

  const paymentHash = hodlStore.findByInvoice(invoice);
  if (!paymentHash) {
    console.error('[HODL] Could not find payment hash for invoice');
    return null;
  }

  console.log(`[HODL] Waiting for payment on ${paymentHash.slice(0, 16)}...`);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log('[HODL] Payment timeout');
      resolve({ paid: false });
    }, timeoutMs);

    const sub = subscribeToInvoice({ lnd, id: paymentHash });

    sub.on('invoice_updated', (inv: any) => {
      if (inv.is_held) {
        console.log(`[HODL] HELD for ${paymentHash.slice(0, 16)}...`);
        hodlStore.updateStatus(paymentHash, 'paid');
      }

      if (inv.is_confirmed) {
        clearTimeout(timeout);
        sub.removeAllListeners();
        console.log(`[HODL] SETTLED for ${paymentHash.slice(0, 16)}...`);
        resolve({ paid: true, paymentHash, preimage: inv.secret });
      }

      if (inv.is_canceled) {
        clearTimeout(timeout);
        sub.removeAllListeners();
        console.log(`[HODL] CANCELLED for ${paymentHash.slice(0, 16)}...`);
        hodlStore.updateStatus(paymentHash, 'cancelled');
        resolve({ paid: false, paymentHash });
      }
    });

    sub.on('error', () => {
      clearTimeout(timeout);
      resolve({ paid: false });
    });
  });
}
