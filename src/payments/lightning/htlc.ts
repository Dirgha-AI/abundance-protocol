import { createHash } from 'crypto';
import { HTLCContract } from './types';

export class HTLCManager {
  private contracts = new Map<string, HTLCContract>();

  create(secret: string, sats: number, expiryBlocks: number): HTLCContract {
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
    this.contracts.set(contract.id, contract);
    return contract;
  }

  settle(id: string, preimage: string): void {
    const contract = this.contracts.get(id);
    if (!contract) throw new Error('HTLC not found');
    const hash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
    if (hash !== contract.paymentHash) throw new Error('Preimage hash mismatch');
    contract.status = 'settled';
    console.log(`[HTLC] Settled ${id}`);
  }

  cancel(id: string): void {
    const contract = this.contracts.get(id);
    if (!contract) throw new Error('HTLC not found');
    contract.status = 'cancelled';
  }

  getContract(id: string): HTLCContract | undefined {
    return this.contracts.get(id);
  }

  listPending(): HTLCContract[] {
    return Array.from(this.contracts.values()).filter((c) => c.status === 'pending');
  }
}
