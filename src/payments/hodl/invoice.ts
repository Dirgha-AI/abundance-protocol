/**
 * HODL Invoice Creation (Step 1)
 * @module payments/hodl/invoice
 */
import { createInvoice as lnCreateInvoice } from 'ln-service';
import type { LNDClient } from '../lightning/client.js';
import { generatePreimageAndHash } from './crypto.js';
import { hodlStore } from './store.js';
import type { CreateHodlResult } from './types.js';

export async function createHodlInvoice(
  lnd: LNDClient | null,
  sats: number,
  jobId: string
): Promise<CreateHodlResult | null> {
  if (!lnd) {
    console.log('[HODL] LND not configured, cannot create HODL invoice');
    return null;
  }

  const { preimage, paymentHash } = generatePreimageAndHash();

  try {
    const result = await (lnCreateInvoice as any)({
      lnd,
      tokens: sats,
      description: `HODL for job ${jobId}`,
      id: paymentHash,
    });

    hodlStore.set(paymentHash, {
      paymentHash,
      invoice: result.request,
      amountSats: sats,
      jobId,
      status: 'pending',
      createdAt: new Date(),
    }, preimage);

    console.log(`[HODL] Created ${sats} sats (job: ${jobId}) hash: ${paymentHash.slice(0, 16)}...`);

    return { paymentHash, invoice: result.request };
  } catch (error) {
    console.error('[HODL] Failed to create HODL invoice:', error);
    return null;
  }
}
