/**
 * Payment Split Logic (70/20/10)
 * @module payments/lightning/split
 */
import type { LNDClient } from './client.js';
import { payInvoiceCore } from './core.js';

export interface SplitResult {
  worker?: any;
  platform?: any[];
  treasury?: any;
  total: number;
}

export async function executePaymentSplitCore(
  lnd: LNDClient | null,
  taskId: string,
  totalSats: number,
  workerInv: string,
  curatorInvs: string[],
  treasuryInv: string
): Promise<SplitResult | null> {
  if (!lnd) {
    console.log('[Lightning] LND not configured, split unavailable');
    return null;
  }

  console.log(`[Lightning] Executing 70/20/10 Split for Task ${taskId}`);

  const workerAmount = Math.floor(totalSats * 0.7);
  const platformAmount = Math.floor(totalSats * 0.2);
  const treasuryAmount = totalSats - workerAmount - platformAmount;
  const perCurator = curatorInvs.length > 0 ? Math.floor(platformAmount / curatorInvs.length) : 0;

  const result: SplitResult = { total: totalSats, platform: [] };

  console.log(`  -> 70% Worker (${workerAmount} sats): ${workerInv.slice(0, 15)}...`);
  result.worker = await payInvoiceCore(lnd, workerInv);

  for (let i = 0; i < curatorInvs.length; i++) {
    console.log(`  -> ${100 / curatorInvs.length}% Curator (${perCurator} sats): ${curatorInvs[i].slice(0, 15)}...`);
    result.platform!.push(await payInvoiceCore(lnd, curatorInvs[i]));
  }

  console.log(`  -> 10% Treasury (${treasuryAmount} sats): ${treasuryInv.slice(0, 15)}...`);
  result.treasury = await payInvoiceCore(lnd, treasuryInv);

  return result;
}
