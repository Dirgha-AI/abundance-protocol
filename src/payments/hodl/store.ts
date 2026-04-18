/**
 * HODL Invoice Storage (in-memory with preimage persistence)
 * @module payments/hodl/store
 */
import type { HodlInvoice } from './types.js';

const pendingHodls: Map<string, HodlInvoice> = new Map();
const preimages: Map<string, string> = new Map();

export const hodlStore = {
  set: (hash: string, invoice: HodlInvoice, preimage: string): void => {
    pendingHodls.set(hash, invoice);
    preimages.set(hash, preimage);
  },

  get: (hash: string): HodlInvoice | undefined => pendingHodls.get(hash),

  getPreimage: (hash: string): string | undefined => preimages.get(hash),

  updateStatus: (hash: string, status: HodlInvoice['status']): void => {
    const hodl = pendingHodls.get(hash);
    if (hodl) hodl.status = status;
  },

  delete: (hash: string): void => {
    pendingHodls.delete(hash);
    preimages.delete(hash);
  },

  listPending: (): HodlInvoice[] =>
    Array.from(pendingHodls.values()).filter(
      (h) => h.status === 'pending' || h.status === 'paid'
    ),

  findByInvoice: (invoice: string): string | null => {
    for (const [hash, hodl] of pendingHodls) {
      if (hodl.invoice === invoice) return hash;
    }
    return null;
  },
};
