/**
 * HODL Settlement (Step 3) - Reveal preimage to settle
 * @module payments/hodl/settle
 */
import type { LNDClient } from '../lightning/client.js';
import { hodlStore } from './store.js';

export async function settleHodlInvoice(
  lnd: LNDClient | null,
  paymentHash: string
): Promise<boolean> {
  if (!lnd) {
    console.log('[HODL] LND not configured, cannot settle');
    return false;
  }

  const preimage = hodlStore.getPreimage(paymentHash);
  if (!preimage) {
    console.error('[HODL] No preimage found for', paymentHash.slice(0, 16));
    return false;
  }

  try {
    const lnService = await import('ln-service');
    await (lnService as any).settleInvoice({ lnd, preimage });

    hodlStore.updateStatus(paymentHash, 'settled');
    console.log(`[HODL] Settled ${paymentHash.slice(0, 16)}... 70/20/10 split triggered`);
    return true;
  } catch (error) {
    console.error('[HODL] Failed to settle:', error);
    return false;
  }
}

export async function cancelHodlInvoice(
  lnd: LNDClient | null,
  paymentHash: string
): Promise<boolean> {
  if (!lnd) {
    console.log('[HODL] LND not configured, cannot cancel');
    return false;
  }

  try {
    const lnService2 = await import('ln-service');
    await (lnService2 as any).cancelHodlInvoice({ lnd, id: paymentHash });

    hodlStore.updateStatus(paymentHash, 'cancelled');
    hodlStore.delete(paymentHash);
    console.log(`[HODL] Cancelled ${paymentHash.slice(0, 16)}... Funds returned`);
    return true;
  } catch (error) {
    console.error('[HODL] Failed to cancel:', error);
    return false;
  }
}
